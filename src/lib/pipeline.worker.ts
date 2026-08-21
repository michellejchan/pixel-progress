import quantize from "quantize";
import chroma from "chroma-js";
import { nearestColorName } from "./colorNames";
import type { PaletteColor, PixelCell } from "../types";

type RGB = [number, number, number];

const CHROMA_CAP = 65;
const MIN_DELTA_E = 12;

function harmonyPass(hexColors: string[]): string[] {
  let colors = hexColors.map((h) => chroma(h));

  colors = colors.map((c) => {
    const [l, ch, h] = c.lch();
    if (ch > CHROMA_CAP) return chroma.lch(l, CHROMA_CAP, h);
    return c;
  });

  colors = colors.map((c) => {
    const [l, ch, h] = c.lch();
    if (ch < 8) return chroma.lch(l, 0, h);
    return c;
  });

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

  for (let i = 0; i < colors.length; i++) {
    for (let j = i + 1; j < colors.length; j++) {
      const de = chroma.deltaE(colors[i].hex(), colors[j].hex());
      if (de < MIN_DELTA_E) {
        const [l, ch, h] = colors[j].lch();
        colors[j] = chroma.lch(l, ch, (h + 15) % 360);
      }
    }
  }

  return colors.map((c) => c.hex());
}

function buildPaletteColors(
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

export type WorkerInput = {
  pixels: RGB[];
  n: number;
  paletteSize: number;
  paletteId: string;
  gridId: string;
};

export type WorkerOutput = {
  paletteColors: PaletteColor[];
  cells: PixelCell[];
};

// DOM lib types window.postMessage with a required targetOrigin; cast to the worker signature
const workerPost = (data: WorkerOutput) =>
  (self as unknown as { postMessage(d: WorkerOutput): void }).postMessage(data);

self.onmessage = ({ data }: MessageEvent<WorkerInput>) => {
  const { pixels, n, paletteSize, paletteId, gridId } = data;

  const colorMap = quantize(pixels, paletteSize + 1);
  const originalHexes: string[] = colorMap
    ? (colorMap.palette() as RGB[]).map(([r, g, b]) => chroma(r, g, b).hex())
    : [];

  const finalHexes = harmonyPass(originalHexes);
  const paletteColors = buildPaletteColors(originalHexes, finalHexes, paletteId);

  const cells: PixelCell[] = pixels.map((pixel, i) => {
    const pixelHex = chroma(pixel[0], pixel[1], pixel[2]).hex();
    let bestIdx = 0;
    let bestDe = Infinity;
    for (let k = 0; k < paletteColors.length; k++) {
      const de = chroma.deltaE(pixelHex, paletteColors[k].finalHex);
      if (de < bestDe) {
        bestDe = de;
        bestIdx = k;
      }
    }
    const pc = paletteColors[bestIdx];
    return {
      id: crypto.randomUUID(),
      gridId,
      row: Math.floor(i / n),
      col: i % n,
      paletteColorId: pc.id,
      colorCode: pc.code,
    };
  });

  workerPost({ paletteColors, cells });
};
