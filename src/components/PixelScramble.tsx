import { useLayoutEffect, useRef } from "react";
import { CANVAS_ACCENT, CANVAS_ACCENT_MUTED, CANVAS_CELL_OFF, CANVAS_SCRAMBLE_GRID } from "../lib/colors";

const TICK_MS = 60;        // throttled ticks, not per-frame
const ACTIVE_FRACTION = 0.2; // ~20% of cells lit at any moment

function randomActiveColor(): string {
  // 15% full accent, 85% muted — sparse bright hits among softer glow
  return Math.random() < 0.15 ? CANVAS_ACCENT : CANVAS_ACCENT_MUTED;
}

interface Props {
  size: number;
  n?: number; // grid dimension
}

export function PixelScramble({ size, n = 20 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    const cellPx = size / n;
    const total = n * n;
    const activeCount = Math.round(total * ACTIVE_FRACTION);

    // All cells start dark
    const cells = new Array<string>(total).fill(CANVAS_CELL_OFF);

    function draw() {
      ctx.clearRect(0, 0, size, size);
      for (let i = 0; i < total; i++) {
        const row = Math.floor(i / n);
        const col = i % n;
        const x = col * cellPx;
        const y = row * cellPx;
        ctx.fillStyle = cells[i];
        ctx.fillRect(x, y, cellPx, cellPx);
        ctx.strokeStyle = CANVAS_SCRAMBLE_GRID;
        ctx.lineWidth = 0.5;
        ctx.strokeRect(x, y, cellPx, cellPx);
      }
    }

    // Fisher-Yates shuffle to pick a fresh random active set each tick
    const indices = Array.from({ length: total }, (_, i) => i);
    function pickActiveIndices(): number[] {
      for (let i = total - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [indices[i], indices[j]] = [indices[j], indices[i]];
      }
      return indices.slice(0, activeCount);
    }

    draw();

    const id = setInterval(() => {
      cells.fill(CANVAS_CELL_OFF);
      for (const i of pickActiveIndices()) {
        cells[i] = randomActiveColor();
      }
      draw();
    }, TICK_MS);

    return () => clearInterval(id);
  }, [size, n]);

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
