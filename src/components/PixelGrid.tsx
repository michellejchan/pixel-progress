import { useEffect, useLayoutEffect, useRef } from "react";
import type { PaletteColor, PixelCell } from "../types";
import textureUrl from "../assets/colored_pencil_texture.jpg";
import { CANVAS_GRID_LINE, CANVAS_LABEL_TEXT } from "../lib/colors";

let cachedTexture: HTMLImageElement | null = null;

function loadTexture(): Promise<HTMLImageElement> {
  if (cachedTexture) return Promise.resolve(cachedTexture);
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => { cachedTexture = img; resolve(img); };
    img.src = textureUrl;
  });
}

interface Props {
  n: number;
  cells: PixelCell[];
  paletteColors: PaletteColor[];
  view: "color" | "code";
  size?: number; // canvas size in px
}

export function PixelGrid({ n, cells, paletteColors, view, size = 360 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Runs before browser paint — eliminates flicker when cells or size change
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || cells.length === 0) return;
    const ctx = canvas.getContext("2d")!;
    const cellPx = size / n;

    const colorById: Record<string, PaletteColor> = {};
    for (const pc of paletteColors) colorById[pc.id] = pc;

    ctx.clearRect(0, 0, size, size);

    for (const cell of cells) {
      const pc = colorById[cell.paletteColorId];
      if (!pc) continue;
      const x = cell.col * cellPx;
      const y = cell.row * cellPx;

      if (view === "color") {
        ctx.fillStyle = pc.finalHex;
        ctx.fillRect(x, y, cellPx, cellPx);
      } else {
        ctx.fillStyle = mixWithDark(pc.finalHex, 0.35);
        ctx.fillRect(x, y, cellPx, cellPx);
        const fontSize = Math.max(7, Math.min(14, cellPx * 0.45));
        ctx.font = `bold ${fontSize}px 'IBM Plex Mono', monospace`;
        ctx.fillStyle = CANVAS_LABEL_TEXT;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(cell.colorCode), x + cellPx / 2, y + cellPx / 2);
      }

      ctx.strokeStyle = CANVAS_GRID_LINE;
      ctx.lineWidth = 0.5;
      ctx.strokeRect(x, y, cellPx, cellPx);
    }

    // Apply texture synchronously if already cached — no extra paint needed
    if (cachedTexture) {
      ctx.save();
      ctx.filter = "grayscale(1)";
      ctx.globalCompositeOperation = "multiply";
      ctx.globalAlpha = 0.55;
      ctx.drawImage(cachedTexture, 0, 0, size, size);
      ctx.restore();
    }
  }, [cells, paletteColors, view, n, size]);

  // First-load only: fetch texture then apply it; subsequent renders use the cache above
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || cells.length === 0 || cachedTexture) return;
    loadTexture().then((tex) => {
      const ctx = canvas.getContext("2d")!;
      ctx.save();
      ctx.filter = "grayscale(1)";
      ctx.globalCompositeOperation = "multiply";
      ctx.globalAlpha = 0.55;
      ctx.drawImage(tex, 0, 0, size, size);
      ctx.restore();
    });
  }, [cells, size]);

  return (
    <canvas
      ref={canvasRef}
      width={size}
      height={size}
      className="pixel-canvas"
      style={{ width: size, height: size }}
    />
  );
}

function mixWithDark(hex: string, amount: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const mr = Math.round(r * amount + 27 * (1 - amount));
  const mg = Math.round(g * amount + 27 * (1 - amount));
  const mb = Math.round(b * amount + 27 * (1 - amount));
  return `rgb(${mr},${mg},${mb})`;
}
