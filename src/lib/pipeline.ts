import chroma from "chroma-js";
import quantize from "quantize";
import { nearestColorName } from "./colorNames";
import type { PaletteColor, PixelCell } from "../types";
import { DIFFICULTY_GRID, DIFFICULTY_PALETTE_SIZE } from "../types";

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

// ─── 02. Smart crop ───────────────────────────────────────────────────────────

export async function smartCropDataUrl(dataUrl: string, targetN: number): Promise<string> {
  // Use smartcrop.js to detect the salient region, then crop to a square
  const { default: smartcrop } = await import("smartcrop");
  const img = await loadHtmlImage(dataUrl);
  // Request a square crop at a reasonable preview size
  const size = Math.max(targetN * 8, 128);
  const result = await smartcrop.crop(img, { width: size, height: size });
  const crop = result.topCrop;

  const canvas = document.createElement("canvas");
  canvas.width = crop.width;
  canvas.height = crop.height;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height);
  return canvas.toDataURL("image/jpeg", 0.95);
}

function loadHtmlImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.src = dataUrl;
  });
}

// ─── Contrast pre-boost (unsharp mask) ───────────────────────────────────────

export function contrastBoost(dataUrl: string): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d")!;
      ctx.filter = "contrast(1.15) saturate(1.1)";
      ctx.drawImage(img, 0, 0);
      resolve(canvas.toDataURL("image/jpeg", 0.95));
    };
    img.src = dataUrl;
  });
}

// ─── Cap source size before pipeline ─────────────────────────────────────────

export function capResolution(dataUrl: string, maxPx = 800): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const { naturalWidth: w, naturalHeight: h } = img;
      if (w <= maxPx && h <= maxPx) {
        resolve(dataUrl);
        return;
      }
      const ratio = Math.min(maxPx / w, maxPx / h);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(w * ratio);
      canvas.height = Math.round(h * ratio);
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", 0.95));
    };
    img.src = dataUrl;
  });
}

// ─── 02. Multi-step downsample to N×N ────────────────────────────────────────

export function downsampleToN(dataUrl: string, n: number): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let currentCanvas = document.createElement("canvas");
      currentCanvas.width = img.width;
      currentCanvas.height = img.height;
      const initCtx = currentCanvas.getContext("2d")!;
      initCtx.drawImage(img, 0, 0);

      // Halve repeatedly until we're close to n, then do final resize
      while (currentCanvas.width > n * 2 || currentCanvas.height > n * 2) {
        const next = document.createElement("canvas");
        next.width = Math.max(n, Math.floor(currentCanvas.width / 2));
        next.height = Math.max(n, Math.floor(currentCanvas.height / 2));
        const ctx = next.getContext("2d")!;
        ctx.drawImage(currentCanvas, 0, 0, next.width, next.height);
        currentCanvas = next;
      }

      // Final resize to exactly n×n
      const final = document.createElement("canvas");
      final.width = n;
      final.height = n;
      const ctx = final.getContext("2d")!;
      ctx.drawImage(currentCanvas, 0, 0, n, n);
      resolve(final.toDataURL("image/png"));
    };
    img.src = dataUrl;
  });
}

// ─── 03. Color quantization (MMCQ via quantize.js) ───────────────────────────

type RGB = [number, number, number];

function getPixels(dataUrl: string, n: number): Promise<RGB[]> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = n;
      canvas.height = n;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0, n, n);
      const data = ctx.getImageData(0, 0, n, n).data;
      const pixels: RGB[] = [];
      for (let i = 0; i < data.length; i += 4) {
        pixels.push([data[i], data[i + 1], data[i + 2]]);
      }
      resolve(pixels);
    };
    img.src = dataUrl;
  });
}

export async function quantizeColors(
  downsampledDataUrl: string,
  n: number,
  paletteSize: number
): Promise<string[]> {
  const pixels = await getPixels(downsampledDataUrl, n);
  const colorMap = quantize(pixels, paletteSize);
  if (!colorMap) return [];
  const palette: RGB[] = colorMap.palette();
  return palette.map(([r, g, b]) => chroma(r, g, b).hex());
}

// ─── 04. Harmony pass ────────────────────────────────────────────────────────

const CHROMA_CAP = 65;
const MIN_DELTA_E = 12;

export function harmonyPass(hexColors: string[]): string[] {
  let colors = hexColors.map((h) => chroma(h));

  // 1. Saturation cap in LCH
  colors = colors.map((c) => {
    const [l, ch, h] = c.lch();
    if (ch > CHROMA_CAP) return chroma.lch(l, CHROMA_CAP, h);
    return c;
  });

  // 2. Desaturate near-grays
  colors = colors.map((c) => {
    const [l, ch, h] = c.lch();
    if (ch < 8) return chroma.lch(l, 0, h);
    return c;
  });

  // 3. Lightness spread — ensure at least one dark (L<30) and one light (L>70)
  const lightnesses = colors.map((c) => c.lch()[0]);
  const minL = Math.min(...lightnesses);
  const maxL = Math.max(...lightnesses);
  if (minL > 30) {
    const darkestIdx = lightnesses.indexOf(minL);
    const [, ch, h] = colors[darkestIdx].lch();
    colors[darkestIdx] = chroma.lch(Math.max(15, minL - 20), ch, h);
  }
  if (maxL < 70) {
    const lightestIdx = lightnesses.indexOf(maxL);
    const [, ch, h] = colors[lightestIdx].lch();
    colors[lightestIdx] = chroma.lch(Math.min(90, maxL + 20), ch, h);
  }

  // 4. Minimum perceptual distance — merge/drift colors that are too similar
  for (let i = 0; i < colors.length; i++) {
    for (let j = i + 1; j < colors.length; j++) {
      const de = chroma.deltaE(colors[i].hex(), colors[j].hex());
      if (de < MIN_DELTA_E) {
        // Drift j's hue slightly
        const [l, ch, h] = colors[j].lch();
        colors[j] = chroma.lch(l, ch, (h + 15) % 360);
      }
    }
  }

  return colors.map((c) => c.hex());
}

// ─── 05. Map pixels to palette ────────────────────────────────────────────────

function deltaE(hexA: string, hexB: string): number {
  return chroma.deltaE(hexA, hexB);
}

export async function mapPixelsToPalette(
  downsampledDataUrl: string,
  n: number,
  paletteColors: PaletteColor[]
): Promise<PixelCell[]> {
  const pixels = await getPixels(downsampledDataUrl, n);
  const cells: PixelCell[] = [];

  for (let i = 0; i < pixels.length; i++) {
    const pixelHex = chroma(pixels[i][0], pixels[i][1], pixels[i][2]).hex();
    let bestIdx = 0;
    let bestDe = Infinity;
    for (let k = 0; k < paletteColors.length; k++) {
      const de = deltaE(pixelHex, paletteColors[k].finalHex);
      if (de < bestDe) {
        bestDe = de;
        bestIdx = k;
      }
    }
    const pc = paletteColors[bestIdx];
    cells.push({
      id: crypto.randomUUID(),
      gridId: "", // filled in by caller
      row: Math.floor(i / n),
      col: i % n,
      paletteColorId: pc.id,
      colorCode: pc.code,
    });
  }
  return cells;
}

// ─── 06. Assign color codes + names ──────────────────────────────────────────

export function buildPaletteColors(
  originalHexes: string[],
  finalHexes: string[],
  paletteId: string
): PaletteColor[] {
  return finalHexes.map((finalHex, i) => {
    const [l, c, h] = chroma(finalHex).lch();
    return {
      id: crypto.randomUUID(),
      paletteId,
      code: i + 1,
      label: nearestColorName(finalHex),
      originalHex: originalHexes[i],
      finalHex,
      lchL: l,
      lchC: c,
      lchH: h,
    };
  });
}

// ─── Full pipeline entry point ────────────────────────────────────────────────

export interface PipelineResult {
  downsampledDataUrl: string;
  paletteColors: PaletteColor[];
  cells: PixelCell[];
}

export async function runPipeline(
  dataUrl: string,
  difficultyLevel: number,
  paletteId: string,
  gridId: string
): Promise<PipelineResult> {
  const n = DIFFICULTY_GRID[difficultyLevel];
  const paletteSize = DIFFICULTY_PALETTE_SIZE[difficultyLevel];

  // Cap → boost → smart crop → downsample
  const capped = await capResolution(dataUrl);
  const boosted = await contrastBoost(capped);
  const cropped = await smartCropDataUrl(boosted, n);
  const downsampled = await downsampleToN(cropped, n);

  // Quantize
  const originalHexes = await quantizeColors(downsampled, n, paletteSize);

  // Harmony pass
  const finalHexes = harmonyPass(originalHexes);

  // Build palette colors
  const paletteColors = buildPaletteColors(originalHexes, finalHexes, paletteId);

  // Map pixels
  const rawCells = await mapPixelsToPalette(downsampled, n, paletteColors);
  const cells = rawCells.map((c) => ({ ...c, gridId }));

  return { downsampledDataUrl: downsampled, paletteColors, cells };
}
