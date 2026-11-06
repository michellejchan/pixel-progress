import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { PaletteColor, PixelCell } from "../types";
import textureUrl from "../assets/colored_pencil_texture_1024.jpg";
import { CANVAS_CELL_OFF, CANVAS_GRID_LINE, CANVAS_LABEL_TEXT } from "../lib/colors";
import { fitGridCanvas, strokeCell } from "../lib/canvasFit";

// The texture is a 1024px copy of the 8000×5333 original — plenty for the grid.
// Decode it off the main thread and bake the grayscale filter in once,
// so each grid redraw is a single cheap drawImage of a small canvas.
const TEXTURE_PX = 1024;

let cachedTexture: HTMLCanvasElement | null = null;

const texturePromise: Promise<HTMLCanvasElement | null> = (async () => {
  try {
    const blob = await fetch(textureUrl).then((r) => r.blob());
    const bitmap = await createImageBitmap(blob, {
      resizeWidth: TEXTURE_PX,
      resizeHeight: TEXTURE_PX,
      resizeQuality: "medium",
    });
    const baked = document.createElement("canvas");
    baked.width = TEXTURE_PX;
    baked.height = TEXTURE_PX;
    const ctx = baked.getContext("2d")!;
    ctx.filter = "grayscale(1)";
    ctx.drawImage(bitmap, 0, 0, TEXTURE_PX, TEXTURE_PX);
    bitmap.close();
    cachedTexture = baked;
    return baked;
  } catch (e) {
    console.error("Texture failed to load", e);
    return null;
  }
})();

interface Props {
  n: number;
  cells: PixelCell[];
  paletteColors: PaletteColor[];
  view: "color" | "code";
  size?: number; // canvas size in px
}

export function PixelGrid({ n, cells, paletteColors, view, size = 360 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [textureReady, setTextureReady] = useState(cachedTexture !== null);

  // Texture preloads at app start; if it isn't ready yet, redraw once when it lands
  useEffect(() => {
    if (textureReady) return;
    let cancelled = false;
    texturePromise.then((tex) => { if (tex && !cancelled) setTextureReady(true); });
    return () => { cancelled = true; };
  }, [textureReady]);

  // Runs before browser paint — eliminates flicker when cells or size change
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || cells.length === 0) return;
    const { ctx, cellPx, bitmapPx, dpr } = fitGridCanvas(canvas, size, n);

    const colorById: Record<string, PaletteColor> = {};
    for (const pc of paletteColors) colorById[pc.id] = pc;

    ctx.clearRect(0, 0, bitmapPx, bitmapPx);
    ctx.strokeStyle = CANVAS_GRID_LINE;

    for (const cell of cells) {
      const pc = colorById[cell.paletteColorId];
      if (!pc) continue;
      const x = cell.col * cellPx;
      const y = cell.row * cellPx;

      if (view === "color") {
        ctx.fillStyle = pc.finalHex;
        ctx.fillRect(x, y, cellPx, cellPx);
      } else {
        // Blank worksheet view: empty cells with just the colour number
        ctx.fillStyle = CANVAS_CELL_OFF;
        ctx.fillRect(x, y, cellPx, cellPx);
        const fontSize = Math.max(7 * dpr, Math.min(14 * dpr, cellPx * 0.45));
        ctx.font = `bold ${fontSize}px 'IBM Plex Mono', monospace`;
        ctx.fillStyle = CANVAS_LABEL_TEXT;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(cell.colorCode), x + cellPx / 2, y + cellPx / 2);
      }

      strokeCell(ctx, x, y, cellPx);
    }

    if (cachedTexture) {
      ctx.save();
      ctx.globalCompositeOperation = "multiply";
      ctx.globalAlpha = 0.55;
      ctx.drawImage(cachedTexture, 0, 0, bitmapPx, bitmapPx);
      ctx.restore();
    }
  }, [cells, paletteColors, view, n, size, textureReady]);

  return <canvas ref={canvasRef} className="pixel-canvas" />;
}
