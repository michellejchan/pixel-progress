// Sizes a grid canvas so every cell is a whole number of device pixels.
// Accounts for the canvas border (box-sizing: border-box) and devicePixelRatio,
// so the bitmap is never resampled by the browser — no uneven cells or flickering lines.
// Doesn't touch the context, so the canvas can still be transferred to a worker afterwards.
export function sizeGridCanvas(canvas: HTMLCanvasElement, size: number, n: number) {
  const fit = styleGridCanvas(canvas, size, n);
  if (canvas.width !== fit.bitmapPx) canvas.width = fit.bitmapPx;
  if (canvas.height !== fit.bitmapPx) canvas.height = fit.bitmapPx;
  return fit;
}

// Sets only the CSS size. For a canvas already transferred to a worker, whose
// bitmap size can only be set from the worker side.
export function styleGridCanvas(canvas: HTMLCanvasElement, size: number, n: number) {
  const style = getComputedStyle(canvas);
  const border = parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth);
  const dpr = window.devicePixelRatio || 1;
  const cellPx = Math.max(1, Math.floor(((size - border) * dpr) / n));
  const bitmapPx = cellPx * n;

  const cssPx = `${bitmapPx / dpr + border}px`;
  canvas.style.width = cssPx;
  canvas.style.height = cssPx;

  return { cellPx, bitmapPx, dpr };
}

export function fitGridCanvas(canvas: HTMLCanvasElement, size: number, n: number) {
  const fit = sizeGridCanvas(canvas, size, n);
  return { ctx: canvas.getContext("2d")!, ...fit };
}

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

// Crisp 1-device-pixel cell outline. Each cell's right/bottom edge lands on the
// next cell's first pixel and gets painted over by its fill, so lines never double up.
export function strokeCell(ctx: Ctx2D, x: number, y: number, cellPx: number) {
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, cellPx, cellPx);
}
