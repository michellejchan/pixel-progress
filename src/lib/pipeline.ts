import type { PaletteColor, PixelCell } from "../types";
import { DIFFICULTY_GRID, DIFFICULTY_PALETTE_SIZE } from "../types";
import type { WorkerInput, WorkerOutput } from "./pipeline.worker";

// Plenty for a 23×23 grid; keeps per-pixel work in the worker fast
const SOURCE_MAX_PX = 512;

// ─── 01. Ingest & validate ────────────────────────────────────────────────────

export async function loadImageDataUrl(file: File): Promise<string> {
  if (file.type === "image/heic" || file.name.toLowerCase().endsWith(".heic")) {
    const heic2any = (await import("heic2any")).default;
    const blob = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.9 });
    const converted = Array.isArray(blob) ? blob[0] : blob;
    return blobToDataUrl(converted);
  }
  return blobToDataUrl(file);
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export function getImageDimensions(dataUrl: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.src = dataUrl;
  });
}

// ─── 02–06. Subject → crop → cells → palette (all in pipeline.worker.ts) ────

export interface PipelineResult {
  croppedDataUrl: string;
  paletteColors: PaletteColor[];
  cells: PixelCell[];
}

// One long-lived worker so the subject analysis is reused when only the level changes
let worker: Worker | null = null;
let nextRequestId = 0;
const pending = new Map<number, { resolve: (r: WorkerOutput) => void; reject: (e: Error) => void }>();

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("./pipeline.worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = ({ data }: MessageEvent<WorkerOutput>) => {
    pending.get(data.requestId)?.resolve(data);
    pending.delete(data.requestId);
  };
  worker.onerror = (e) => {
    for (const p of pending.values()) p.reject(new Error(e.message || "Worker failed"));
    pending.clear();
    worker?.terminate();
    worker = null;
  };
  return worker;
}

// Starts loading the subject model as soon as there's an image, before a level is picked
export function warmUpPipeline() {
  getWorker().postMessage({ kind: "warmup" } satisfies WorkerInput);
}

let lastDataUrl: string | null = null;
let imageKey = 0;

async function loadSourceBitmap(dataUrl: string): Promise<ImageBitmap> {
  const blob = await fetch(dataUrl).then((r) => r.blob());
  const full = await createImageBitmap(blob);
  const scale = Math.min(1, SOURCE_MAX_PX / Math.max(full.width, full.height));
  if (scale === 1) return full;
  const resized = await createImageBitmap(full, {
    resizeWidth: Math.round(full.width * scale),
    resizeHeight: Math.round(full.height * scale),
    resizeQuality: "high",
  });
  full.close();
  return resized;
}

export async function runPipeline(
  dataUrl: string,
  difficultyLevel: number,
  paletteId: string,
  gridId: string
): Promise<PipelineResult> {
  if (dataUrl !== lastDataUrl) {
    lastDataUrl = dataUrl;
    imageKey++;
  }
  const bitmap = await loadSourceBitmap(dataUrl);
  const requestId = ++nextRequestId;
  const w = getWorker();
  const result = await new Promise<WorkerOutput>((resolve, reject) => {
    pending.set(requestId, { resolve, reject });
    const input: WorkerInput = {
      kind: "run",
      requestId,
      imageKey,
      bitmap,
      n: DIFFICULTY_GRID[difficultyLevel],
      paletteSize: DIFFICULTY_PALETTE_SIZE[difficultyLevel],
      paletteId,
      gridId,
    };
    w.postMessage(input, [bitmap]);
  });
  if ("error" in result) throw new Error(result.error);

  return {
    croppedDataUrl: await blobToDataUrl(result.preview),
    paletteColors: result.paletteColors,
    cells: result.cells,
  };
}
