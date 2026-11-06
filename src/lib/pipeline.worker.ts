// The whole image → grid pipeline, off the main thread:
// find subject → crop tight → sample each cell's dominant colour → build a small palette.
import chroma from "chroma-js";
import { nearestColorName } from "./colorNames";
import { type Lab, rgbaToLab } from "./lab";
import { analyzeSubject, type SubjectAnalysis } from "./subject";
import { segmentSubject, warmUpSegmenter, type Saliency } from "./segment";
import { buildPalette, type CellSample } from "./palette";
import type { PaletteColor, PixelCell } from "../types";

const ANALYSIS_MAX_PX = 128;

export type WorkerInput = { kind: "warmup" } | {
  kind: "run";
  requestId: number;
  imageKey: number;
  bitmap: ImageBitmap;
  n: number;
  paletteSize: number;
  paletteId: string;
  gridId: string;
};

export type WorkerOutput =
  | { requestId: number; paletteColors: PaletteColor[]; cells: PixelCell[]; preview: Blob }
  | { requestId: number; error: string };

// Per-image work that doesn't depend on the level — reused when only the level changes
type Prepared = {
  imageKey: number;
  bitmap: ImageBitmap;
  w: number;
  h: number;
  lab: Float32Array;
  analysis: SubjectAnalysis;
};
let prepared: Prepared | null = null;

function pixels(bitmap: ImageBitmap, w: number, h: number): Uint8ClampedArray {
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h).data;
}

async function prepare(imageKey: number, bitmap: ImageBitmap): Promise<Prepared> {
  if (prepared?.imageKey === imageKey) {
    bitmap.close();
    return prepared;
  }
  prepared?.bitmap.close();
  prepared = null;
  const { width: w, height: h } = bitmap;
  const scale = Math.min(1, ANALYSIS_MAX_PX / Math.max(w, h));
  const aw = Math.max(1, Math.round(w * scale)), ah = Math.max(1, Math.round(h * scale));
  let saliency: Saliency | null = null;
  try {
    saliency = await segmentSubject(bitmap, aw, ah);
  } catch (e) {
    console.warn("Subject model failed, using colour heuristic only", e);
  }
  const analysis = analyzeSubject(pixels(bitmap, aw, ah), aw, ah, saliency);
  prepared = { imageKey, bitmap, w, h, lab: rgbaToLab(pixels(bitmap, w, h)), analysis };
  return prepared;
}

// Square crop around the subject. Small grids get less padding — every cell counts.
function computeCrop({ w, h, analysis }: Prepared, n: number) {
  if (!analysis.hasSubject) {
    const side = Math.min(w, h);
    return { x: (w - side) / 2, y: (h - side) / 2, side };
  }
  const { x0, y0, x1, y1 } = analysis.bbox;
  const bw = (x1 - x0) * w, bh = (y1 - y0) * h;
  const pad = n <= 7 ? 0.04 : 0.08;
  const side = Math.max(bw, bh) * (1 + 2 * pad);
  const clampAxis = (center: number, extent: number) =>
    side <= extent ? Math.min(Math.max(center - side / 2, 0), extent - side) : center - side / 2;
  return {
    x: clampAxis(((x0 + x1) / 2) * w, w),
    y: clampAxis(((y0 + y1) / 2) * h, h),
    side,
  };
}

// Each cell takes its most common colour (not the average, which muddies edges).
// A cell counts as subject if enough of it is subject — lower bar on small grids so thin
// parts of the silhouette survive.
function sampleCells(p: Prepared, crop: { x: number; y: number; side: number }, n: number): CellSample[] {
  const { w, h, lab, analysis } = p;
  const cellSrc = crop.side / n;
  const m = Math.min(8, Math.max(3, Math.round(cellSrc)));
  const subjectThreshold = n <= 7 ? 0.35 : 0.45;
  const out: CellSample[] = [];

  for (let cy = 0; cy < n; cy++) {
    for (let cx = 0; cx < n; cx++) {
      const bins = new Map<number, { count: number; L: number; a: number; b: number; subject: number }>();
      let subjectHits = 0, total = 0;
      for (let sy = 0; sy < m; sy++) {
        for (let sx = 0; sx < m; sx++) {
          total++;
          const x = Math.floor(crop.x + (cx + (sx + 0.5) / m) * cellSrc);
          const y = Math.floor(crop.y + (cy + (sy + 0.5) / m) * cellSrc);
          if (x < 0 || y < 0 || x >= w || y >= h) continue; // crop padding = background
          const isSubject = analysis.mask[
            Math.min(analysis.h - 1, Math.floor((y * analysis.h) / h)) * analysis.w +
            Math.min(analysis.w - 1, Math.floor((x * analysis.w) / w))
          ];
          subjectHits += isSubject;
          const i = (y * w + x) * 3;
          const L = lab[i], a = lab[i + 1], b = lab[i + 2];
          const key = Math.floor(L / 10) * 10000 + Math.floor((a + 128) / 14) * 100 + Math.floor((b + 128) / 14);
          const bin = bins.get(key) ?? { count: 0, L: 0, a: 0, b: 0, subject: 0 };
          bin.count++; bin.L += L; bin.a += a; bin.b += b; bin.subject += isSubject;
          bins.set(key, bin);
        }
      }
      const subject = subjectHits / total >= subjectThreshold;
      // Dominant colour among the samples of this cell's own class
      let best: { count: number; L: number; a: number; b: number } | null = null;
      for (const bin of bins.values()) {
        const count = subject ? bin.subject : bin.count - bin.subject;
        if (count > 0 && (!best || count > best.count)) best = { count, L: bin.L / bin.count, a: bin.a / bin.count, b: bin.b / bin.count };
      }
      out.push({ subject, lab: best ? ([best.L, best.a, best.b] as Lab) : null });
    }
  }
  return out;
}

async function renderPreview(p: Prepared, crop: { x: number; y: number; side: number }, fill: string) {
  const size = 256;
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = fill;
  ctx.fillRect(0, 0, size, size);
  const s = size / crop.side;
  ctx.drawImage(p.bitmap, -crop.x * s, -crop.y * s, p.w * s, p.h * s);
  return canvas.convertToBlob({ type: "image/jpeg", quality: 0.9 });
}

// DOM lib types window.postMessage with a required targetOrigin; cast to the worker signature
const workerPost = (data: WorkerOutput) =>
  (self as unknown as { postMessage(d: WorkerOutput): void }).postMessage(data);

self.onmessage = async ({ data }: MessageEvent<WorkerInput>) => {
  if (data.kind === "warmup") {
    warmUpSegmenter();
    return;
  }
  const { requestId, imageKey, bitmap, n, paletteSize, paletteId, gridId } = data;
  try {
    const p = await prepare(imageKey, bitmap);
    const crop = computeCrop(p, n);
    const samples = sampleCells(p, crop, n);
    const { swatches, cellSwatch } = buildPalette(samples, paletteSize, p.analysis.alphaMode);

    // Most-used colour gets code 1
    const order = swatches.map((_, i) => i).filter((i) => swatches[i].cells > 0)
      .sort((a, b) => swatches[b].cells - swatches[a].cells);
    const paletteColors: PaletteColor[] = order.map((k, idx) => {
      const finalHex = chroma.lab(...swatches[k].lab).hex();
      const [l, c, h] = chroma(finalHex).lch();
      return {
        id: crypto.randomUUID(),
        paletteId,
        code: idx + 1,
        label: nearestColorName(finalHex),
        originalHex: chroma.lab(...swatches[k].original).hex(),
        finalHex,
        lchL: l,
        lchC: c,
        lchH: Number.isNaN(h) ? 0 : h,
      };
    });
    const colorBySwatch = new Map(order.map((k, idx) => [k, paletteColors[idx]]));

    const cells: PixelCell[] = cellSwatch.map((k, i) => {
      const pc = colorBySwatch.get(k)!;
      return {
        id: crypto.randomUUID(),
        gridId,
        row: Math.floor(i / n),
        col: i % n,
        paletteColorId: pc.id,
        colorCode: pc.code,
      };
    });

    const bgSwatch = swatches.find((s) => s.kind === "background");
    const preview = await renderPreview(p, crop, bgSwatch ? chroma.lab(...bgSwatch.lab).hex() : "#ffffff");
    workerPost({ requestId, paletteColors, cells, preview });
  } catch (e) {
    workerPost({ requestId, error: e instanceof Error ? e.message : String(e) });
  }
};
