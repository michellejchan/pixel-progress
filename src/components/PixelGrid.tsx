import { useEffect, useRef } from "react";
import type { PaletteColor, PixelCell } from "../types";

interface Props {
  n: number;
  cells: PixelCell[];
  paletteColors: PaletteColor[];
  view: "color" | "code";
  size?: number; // canvas size in px
}

export function PixelGrid({ n, cells, paletteColors, view, size = 360 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
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
        // light tint background
        ctx.fillStyle = mixWithWhite(pc.finalHex, 0.25);
        ctx.fillRect(x, y, cellPx, cellPx);
        // code number
        const fontSize = Math.max(7, Math.min(14, cellPx * 0.45));
        ctx.font = `bold ${fontSize}px sans-serif`;
        ctx.fillStyle = "#222";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(cell.colorCode), x + cellPx / 2, y + cellPx / 2);
      }

      // Grid lines
      ctx.strokeStyle = "rgba(0,0,0,0.15)";
      ctx.lineWidth = 0.5;
      ctx.strokeRect(x, y, cellPx, cellPx);
    }
  }, [cells, paletteColors, view, n, size]);

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

function mixWithWhite(hex: string, amount: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const mr = Math.round(r * amount + 255 * (1 - amount));
  const mg = Math.round(g * amount + 255 * (1 - amount));
  const mb = Math.round(b * amount + 255 * (1 - amount));
  return `rgb(${mr},${mg},${mb})`;
}
