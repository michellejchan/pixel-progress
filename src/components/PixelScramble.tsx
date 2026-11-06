import { useLayoutEffect, useRef } from "react";
import { styleGridCanvas } from "../lib/canvasFit";
import type { ScrambleMessage } from "../lib/scramble.worker";

// Length of the speed-up burst that plays once the result is ready
export const SCRAMBLE_FINISH_MS = 500;

// Booted once at startup and kept warm, so the scramble starts on its very first frame
const worker = new Worker(
  new URL("../lib/scramble.worker.ts", import.meta.url),
  { type: "module" },
);

function send(msg: ScrambleMessage, transfer: Transferable[] = []) {
  worker.postMessage(msg, transfer);
}

interface Props {
  size: number;
  n?: number; // grid dimension
  active: boolean; // animating; the canvas stays mounted either way
  finishing?: boolean; // speed up, then call onDone
  onDone?: () => void;
}

export function PixelScramble({ size, n = 20, active, finishing = false, onDone }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const onDoneRef = useRef(onDone);
  useLayoutEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);

  // A canvas can only be handed to a worker once, so it's created here rather than in JSX.
  // It lives as long as the component; size changes are messages, not remounts.
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const canvas = document.createElement("canvas");
    canvas.className = "pixel-canvas";
    host.appendChild(canvas);
    canvasRef.current = canvas;
    const offscreen = canvas.transferControlToOffscreen();
    send({ type: "canvas", canvas: offscreen }, [offscreen]);
    worker.onmessage = () => onDoneRef.current?.();

    return () => {
      send({ type: "active", active: false });
      worker.onmessage = null;
      canvas.remove();
      canvasRef.current = null;
    };
  }, []);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { cellPx } = styleGridCanvas(canvas, size, n);
    send({ type: "resize", n, cellPx });
  }, [size, n]);

  useLayoutEffect(() => {
    send({ type: "active", active });
  }, [active]);

  useLayoutEffect(() => {
    send({ type: "finish", finishing, durationMs: SCRAMBLE_FINISH_MS });
  }, [finishing]);

  return <div ref={hostRef} />;
}
