// Draws the scramble animation on its own thread, so image processing on the
// main thread can never freeze it mid-animation. One long-lived worker serves the
// app: it boots at startup and idles between runs, so showing the scramble never
// waits on a worker spinning up (which left the old grid frozen on screen).
import { CANVAS_ACCENT, CANVAS_ACCENT_MUTED, CANVAS_CELL_OFF, CANVAS_SCRAMBLE_GRID } from "./colors";
import { strokeCell } from "./canvasFit";

const TICK_MS = 60;          // throttled ticks, not per-frame
const MIN_TICK_MS = 16;      // fastest the finish burst gets (~one frame)
const ACTIVE_FRACTION = 0.2; // ~20% of cells lit at any moment

export type ScrambleMessage =
  // A freshly mounted canvas replaces any previous one
  | { type: "canvas"; canvas: OffscreenCanvas }
  // Grid size changes resize the bitmap in place instead of remounting
  | { type: "resize"; n: number; cellPx: number }
  | { type: "active"; active: boolean }
  // Ticks speed up over durationMs, then the worker posts "done".
  // finishing: false cancels a burst in progress (a new run started).
  | { type: "finish"; finishing: boolean; durationMs: number };

let ctx: OffscreenCanvasRenderingContext2D | null = null;
let n = 0;
let cellPx = 0;
let cells: string[] = [];
let indices: number[] = [];

let active = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let finishStart: number | null = null;
let finishDurationMs = 0;

function randomActiveColor(): string {
  // 15% full accent, 85% muted — sparse bright hits among softer glow
  return Math.random() < 0.15 ? CANVAS_ACCENT : CANVAS_ACCENT_MUTED;
}

function draw() {
  if (!ctx || n === 0) return;
  const total = n * n;
  ctx.clearRect(0, 0, cellPx * n, cellPx * n);
  ctx.strokeStyle = CANVAS_SCRAMBLE_GRID;
  for (let i = 0; i < total; i++) {
    const x = (i % n) * cellPx;
    const y = Math.floor(i / n) * cellPx;
    ctx.fillStyle = cells[i];
    ctx.fillRect(x, y, cellPx, cellPx);
    strokeCell(ctx, x, y, cellPx);
  }
}

// Fisher-Yates shuffle to pick a fresh random active set each tick
function pickActiveIndices(): number[] {
  const total = indices.length;
  for (let i = total - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  return indices.slice(0, Math.round(total * ACTIVE_FRACTION));
}

function tick() {
  cells.fill(CANVAS_CELL_OFF);
  for (const i of pickActiveIndices()) cells[i] = randomActiveColor();
  draw();
}

// Same pace as always until finishing, then the delay collapses on an ease-in curve
function nextDelay(): number | null {
  if (finishStart === null) return TICK_MS;
  const p = (performance.now() - finishStart) / finishDurationMs;
  if (p >= 1) return null;
  return Math.max(MIN_TICK_MS, TICK_MS * (1 - p * p));
}

function loop() {
  timer = null;
  if (!active) return;
  tick();
  const delay = nextDelay();
  if (delay === null) {
    self.postMessage("done");
    return;
  }
  timer = setTimeout(loop, delay);
}

function restartLoop() {
  if (timer !== null) clearTimeout(timer);
  // First frame is drawn right away, so the board never sits blank
  loop();
}

self.onmessage = ({ data }: MessageEvent<ScrambleMessage>) => {
  switch (data.type) {
    case "canvas":
      ctx = data.canvas.getContext("2d");
      if (ctx && n > 0) {
        ctx.canvas.width = ctx.canvas.height = cellPx * n;
      }
      if (active) restartLoop();
      break;
    case "resize": {
      const changed = data.n !== n || data.cellPx !== cellPx;
      n = data.n;
      cellPx = data.cellPx;
      if (!changed) break;
      cells = new Array<string>(n * n).fill(CANVAS_CELL_OFF);
      indices = Array.from({ length: n * n }, (_, i) => i);
      if (ctx) ctx.canvas.width = ctx.canvas.height = cellPx * n;
      // Redraw immediately so a resize mid-run doesn't leave a blank frame
      if (active) tick();
      break;
    }
    case "active":
      if (data.active === active) break;
      active = data.active;
      finishStart = null;
      if (active) restartLoop();
      else if (timer !== null) { clearTimeout(timer); timer = null; }
      break;
    case "finish": {
      finishStart = data.finishing ? performance.now() : null;
      finishDurationMs = data.durationMs;
      // Cancelling after a burst already ended picks the normal loop back up
      if (!data.finishing && active && timer === null) restartLoop();
      break;
    }
  }
};
