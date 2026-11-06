import { useEffect, useRef } from "react";

const COLS = 60;
const ROWS = 22;
// Monospace cells are taller than wide; world units are measured in rows
const ASPECT = 1.75;
const W = COLS / ASPECT;
const H = ROWS;
const STEP_MS = 1000 / 30;
const MARGIN = 3;

const SEG_COUNT = 11;
const SEG_SPACING = 0.7;
const BODY_RADII = [0.7, 0.9, 0.95, 0.92, 0.85, 0.74, 0.62, 0.5, 0.4, 0.32, 0.26];
const BODY_RAMP = " .:-=+*#%@";
const FIN_RAMP = " .,~";

// Colour pattern along the spine, head first: o = orange, c = cream, k = ink
const PATTERNS = ["ccoooccoocc", "oooccooocco", "cokccoockcc"];

type Tone = "o" | "c" | "k" | "f" | "w" | "e";

interface Vec { x: number; y: number }

interface Fish {
  segs: Vec[];
  angle: number;
  speed: number;
  target: Vec;
  phase: number;
  pattern: string;
}

function randomTarget(): Vec {
  return {
    x: MARGIN + Math.random() * (W - MARGIN * 2),
    y: MARGIN + Math.random() * (H - MARGIN * 2),
  };
}

function makeFish(i: number): Fish {
  const angle = Math.random() * Math.PI * 2;
  const head = { x: W * (0.25 + 0.25 * i), y: H * (0.3 + 0.2 * (i % 2)) };
  const segs = Array.from({ length: SEG_COUNT }, (_, s) => ({
    x: head.x - Math.cos(angle) * s * SEG_SPACING,
    y: head.y - Math.sin(angle) * s * SEG_SPACING,
  }));
  return {
    segs,
    angle,
    speed: 0.07 + Math.random() * 0.03,
    target: randomTarget(),
    phase: Math.random() * Math.PI * 2,
    pattern: PATTERNS[i % PATTERNS.length],
  };
}

function step(fish: Fish, t: number) {
  const head = fish.segs[0];
  const dx = fish.target.x - head.x;
  const dy = fish.target.y - head.y;
  if (dx * dx + dy * dy < 4) fish.target = randomTarget();

  let diff = Math.atan2(dy, dx) - fish.angle;
  diff = Math.atan2(Math.sin(diff), Math.cos(diff));
  fish.angle += Math.max(-0.045, Math.min(0.045, diff * 0.06));

  const speed = fish.speed * (1 + 0.25 * Math.sin(t * 1.3 + fish.phase));
  head.x = Math.max(1, Math.min(W - 1, head.x + Math.cos(fish.angle) * speed));
  head.y = Math.max(1, Math.min(H - 1, head.y + Math.sin(fish.angle) * speed));

  // Follow-the-leader spine
  for (let s = 1; s < fish.segs.length; s++) {
    const prev = fish.segs[s - 1];
    const cur = fish.segs[s];
    const ax = cur.x - prev.x;
    const ay = cur.y - prev.y;
    const len = Math.hypot(ax, ay) || 1;
    cur.x = prev.x + (ax / len) * SEG_SPACING;
    cur.y = prev.y + (ay / len) * SEG_SPACING;
  }
}

interface Stamp { x: number; y: number; r: number; tone: Tone; fin: boolean }

// Spine with a swimming wiggle, plus pectoral and tail fins
function stamps(fish: Fish, t: number): Stamp[] {
  const out: Stamp[] = [];
  const pts = fish.segs.map((p, s) => {
    const next = fish.segs[Math.max(0, s - 1)];
    const prev = fish.segs[Math.min(fish.segs.length - 1, s + 1)];
    const a = Math.atan2(next.y - prev.y, next.x - prev.x);
    const wiggle = Math.sin(t * 7 + fish.phase - s * 0.7) * 0.22 * (s / SEG_COUNT);
    return { x: p.x - Math.sin(a) * wiggle, y: p.y + Math.cos(a) * wiggle, a };
  });

  pts.forEach((p, s) => {
    out.push({ x: p.x, y: p.y, r: BODY_RADII[s], tone: fish.pattern[s] as Tone, fin: false });
  });

  const flap = 0.25 * Math.sin(t * 5 + fish.phase);
  const pec = pts[2];
  for (const side of [-1, 1]) {
    const spread = 1.35 + flap * side;
    out.push({
      x: pec.x - Math.cos(pec.a) * 0.5 - Math.sin(pec.a) * spread * side,
      y: pec.y - Math.sin(pec.a) * 0.5 + Math.cos(pec.a) * spread * side,
      r: 0.55, tone: "f", fin: true,
    });
  }

  const tail = pts[SEG_COUNT - 1];
  const sway = Math.sin(t * 7 + fish.phase - SEG_COUNT * 0.7) * 0.35;
  for (const side of [-1, 0, 1]) {
    const back = side === 0 ? 0.9 : 1.1;
    const spread = side * 0.75 + sway;
    out.push({
      x: tail.x - Math.cos(tail.a) * back - Math.sin(tail.a) * spread,
      y: tail.y - Math.sin(tail.a) * back + Math.cos(tail.a) * spread,
      r: side === 0 ? 0.5 : 0.6, tone: "f", fin: true,
    });
  }

  // Eyes sit just behind the snout on either side
  const head = pts[0];
  for (const side of [-1, 1]) {
    out.push({
      x: head.x + Math.cos(head.a) * 0.2 - Math.sin(head.a) * 0.55 * side,
      y: head.y + Math.sin(head.a) * 0.2 + Math.cos(head.a) * 0.55 * side,
      r: 0.28, tone: "e", fin: false,
    });
  }
  return out;
}

function render(fishes: Fish[], t: number): string {
  const all = fishes.flatMap((f) => stamps(f, t));
  let html = "";
  for (let row = 0; row < ROWS; row++) {
    let runTone: Tone | null = null;
    let run = "";
    const flush = () => {
      if (!run) return;
      html += runTone ? `<span class="koi-${runTone}">${run}</span>` : run;
      run = "";
    };
    for (let col = 0; col < COLS; col++) {
      const px = (col + 0.5) / ASPECT;
      const py = row + 0.5;
      let best = 0;
      let bestStamp: Stamp | null = null;
      for (const st of all) {
        const d = Math.hypot(px - st.x, py - st.y) / st.r;
        if (d >= 1) continue;
        // Eyes always win where they land; otherwise body beats fins
        const score = st.tone === "e" ? 3 : (1 - d) + (st.fin ? 0 : 1);
        if (score > best) { best = score; bestStamp = st; }
      }

      let ch = " ";
      let tone: Tone | null = null;
      if (bestStamp) {
        const density = 1 - Math.hypot(px - bestStamp.x, py - bestStamp.y) / bestStamp.r;
        if (bestStamp.tone === "e") {
          ch = "o";
        } else if (bestStamp.fin) {
          ch = FIN_RAMP[1 + Math.min(FIN_RAMP.length - 2, Math.floor(density * (FIN_RAMP.length - 1)))];
        } else {
          ch = BODY_RAMP[1 + Math.min(BODY_RAMP.length - 2, Math.floor(density * (BODY_RAMP.length - 1) * 1.4))];
        }
        tone = bestStamp.tone;
      } else {
        const v = Math.sin(col * 0.55 + t * 0.7) + Math.sin(row * 1.1 - t * 0.45) + Math.sin((col + row * 2) * 0.23 + t * 0.3);
        if (v > 2.35) { ch = "~"; tone = "w"; }
      }

      if (tone !== runTone) { flush(); runTone = tone; }
      run += ch;
    }
    flush();
    if (row < ROWS - 1) html += "\n";
  }
  return html;
}

export function KoiPond() {
  const preRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    const fishes = [0, 1, 2].map(makeFish);
    // Settle the spines so the first frame doesn't show stiff, straight fish
    for (let i = 0; i < 60; i++) fishes.forEach((f) => step(f, i * STEP_MS / 1000));

    const pre = preRef.current;
    if (!pre) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      pre.innerHTML = render(fishes, 0);
      return;
    }

    let raf = 0;
    let last = performance.now();
    let acc = 0;
    let t = 2;
    const tick = (now: number) => {
      acc += Math.min(now - last, 250);
      last = now;
      let stepped = false;
      while (acc >= STEP_MS) {
        acc -= STEP_MS;
        t += STEP_MS / 1000;
        fishes.forEach((f) => step(f, t));
        stepped = true;
      }
      if (stepped) pre.innerHTML = render(fishes, t);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return <pre ref={preRef} className="koi-pond" aria-hidden="true" />;
}
