// Subject cutout with U²-Netp (salient object detection, Apache-2.0; ONNX export from rembg).
// Runs inside the pipeline worker. The runtime + model (~8 MB gzipped) load lazily on first
// use and are cached by the browser after that.
import type { InferenceSession } from "onnxruntime-web/wasm";
import wasmUrl from "onnxruntime-web/ort-wasm-simd-threaded.wasm?url";

const MODEL_URL = new URL(`${import.meta.env.BASE_URL}models/u2netp.onnx`, self.location.origin).href;
const INPUT_PX = 320;
const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];

type Ort = typeof import("onnxruntime-web/wasm");
let loading: Promise<{ ort: Ort; session: InferenceSession }> | null = null;

function load() {
  loading ??= (async () => {
    const ort = await import("onnxruntime-web/wasm");
    ort.env.wasm.wasmPaths = { wasm: wasmUrl };
    ort.env.wasm.numThreads = 1; // threads need cross-origin isolation, which this site doesn't set
    const session = await ort.InferenceSession.create(MODEL_URL, { executionProviders: ["wasm"] });
    return { ort, session };
  })().catch((e) => {
    loading = null; // allow a retry on the next image
    throw e;
  });
  return loading;
}

// Start downloading/compiling early so the first real run doesn't wait
export function warmUpSegmenter() {
  load().catch((e) => console.warn("Subject model unavailable, using fallback", e));
}

export interface Saliency {
  prob: Float32Array; // 0–1 per pixel at w × h, min–max normalised like rembg
  peak: number;       // raw model confidence before normalising
}

export async function segmentSubject(bitmap: ImageBitmap, w: number, h: number): Promise<Saliency> {
  const { ort, session } = await load();

  // The model expects a 320×320 square; stretch like rembg does, then normalise per channel
  const canvas = new OffscreenCanvas(INPUT_PX, INPUT_PX);
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, INPUT_PX, INPUT_PX);
  const rgba = ctx.getImageData(0, 0, INPUT_PX, INPUT_PX).data;
  let maxVal = 1e-6;
  for (let i = 0; i < rgba.length; i += 4) maxVal = Math.max(maxVal, rgba[i], rgba[i + 1], rgba[i + 2]);
  const plane = INPUT_PX * INPUT_PX;
  const input = new Float32Array(3 * plane);
  for (let p = 0; p < plane; p++) {
    for (let c = 0; c < 3; c++) input[c * plane + p] = (rgba[p * 4 + c] / maxVal - MEAN[c]) / STD[c];
  }

  const feeds = { [session.inputNames[0]]: new ort.Tensor("float32", input, [1, 3, INPUT_PX, INPUT_PX]) };
  const results = await session.run(feeds);
  const raw = results[session.outputNames[0]].data as Float32Array;

  let lo = Infinity, hi = -Infinity;
  for (const v of raw) { if (v < lo) lo = v; if (v > hi) hi = v; }
  const range = Math.max(hi - lo, 1e-6);

  // Bilinear resample 320×320 → w × h
  const prob = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const fy = Math.min(INPUT_PX - 1, Math.max(0, ((y + 0.5) * INPUT_PX) / h - 0.5));
    const y0 = Math.floor(fy), y1 = Math.min(INPUT_PX - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = Math.min(INPUT_PX - 1, Math.max(0, ((x + 0.5) * INPUT_PX) / w - 0.5));
      const x0 = Math.floor(fx), x1 = Math.min(INPUT_PX - 1, x0 + 1), tx = fx - x0;
      const top = raw[y0 * INPUT_PX + x0] * (1 - tx) + raw[y0 * INPUT_PX + x1] * tx;
      const bottom = raw[y1 * INPUT_PX + x0] * (1 - tx) + raw[y1 * INPUT_PX + x1] * tx;
      prob[y * w + x] = (top * (1 - ty) + bottom * ty - lo) / range;
    }
  }
  return { prob, peak: hi };
}
