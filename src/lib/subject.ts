// Finds the main subject of a photo so the grid can crop to it and flatten the background.
// Two signals, combined:
//  - U²-Netp saliency (segment.ts): great at "what's the thing in this photo", but can miss
//    low-contrast parts of it (a sunflower's dark centre, a dandelion's white fluff)
//  - a colour heuristic: learn the background's colours from the image border, flood-fill
//    inward through anything that looks like background, and call the rest the subject.
//    Catches those parts, but gets fooled when the subject's colour runs off the frame.
import { type Lab, dist2, kmeans, rgbaToLab } from "./lab";
import type { Saliency } from "./segment";

export interface SubjectAnalysis {
  w: number;
  h: number;
  mask: Uint8Array;      // 1 = subject, at analysis resolution (w × h)
  hasSubject: boolean;   // false → no clear subject; treat the whole image as subject
  alphaMode: boolean;    // mask came from PNG transparency
  // Subject bounds, normalised 0–1 against the image
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

const BORDER_FRACTION = 0.04;
const BORDER_BOTTOM_WEIGHT = 0.5; // subjects often run off the bottom edge
const BG_CLUSTER_MIN_SHARE = 0.12;
const BG_NEAR = 20;   // ΔE76: plainly background-coloured
const BG_STEP = 6;    // ΔE76: smooth continuation (gradients, soft light)
const BG_FAR = 40;    // ΔE76: never follow a gradient further than this from the background
const CENTRE_BOX = 0.3;            // middle 30% of each axis
const CENTRE_MAX_BG_SHARE = 0.25;  // a "background" colour covering more of the centre than this is subject
const BG_MAX_TEXTURE = 5;          // mean ΔL between neighbours; flat/blurred backgrounds sit well below
const BG_MAX_TEXTURE_RATIO = 0.75; // …and well below the subject's own detail
const MIN_SUBJECT = 0.02;
const ML_MIN_PEAK = 0.3;    // below this the model isn't seeing any salient object
const ML_THRESHOLD = 0.5;
const ML_CORE = 0.8;               // "definitely the subject"
const ML_CONFIDENCE_MARGIN = 0.15; // drop core regions whose mean score trails the best region by more
const ML_EDGE_GROW_PX = 2;         // at analysis resolution (~128px)
const HEURISTIC_MIN_AGREEMENT = 0.5;
const MAX_SUBJECT = 0.9;

export function analyzeSubject(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  saliency: Saliency | null,
): SubjectAnalysis {
  const N = w * h;

  let transparent = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] < 128) transparent++;
  if (transparent > N * 0.02) {
    const mask = new Uint8Array(N);
    for (let i = 0; i < N; i++) mask[i] = data[i * 4 + 3] >= 128 ? 1 : 0;
    return finish(cleanMask(mask, w, h), w, h, true);
  }

  const heuristic = heuristicSubject(data, w, h);
  if (!saliency || saliency.peak < ML_MIN_PEAK) return heuristic;

  const mask = confidentRegions(saliency.prob, w, h);
  if (mask.reduce((s, v) => s + v, 0) < N * MIN_SUBJECT) return heuristic;
  // Plus the parts of the heuristic's subject that are attached to the model's — but only
  // if the heuristic agrees with the model about what the subject is. On green-on-green
  // photos it can call the subject itself background and keep only shadows.
  if (heuristic.hasSubject && agreement(heuristic.mask, saliency.prob) >= HEURISTIC_MIN_AGREEMENT) {
    const { label, sizes } = labelComponents(heuristic.mask, w, h);
    const attached = new Uint8Array(sizes.length);
    for (let i = 0; i < N; i++) if (label[i] >= 0 && touches(mask, i, w, h)) attached[label[i]] = 1;
    for (let i = 0; i < N; i++) if (label[i] >= 0 && attached[label[i]]) mask[i] = 1;
  }
  return finish(fillHoles(cleanMask(mask, w, h), w, h), w, h, false);
}

// The model often gives secondary objects a middling score (the leaves around a frog), and
// at a plain 0.5 cut-off they can merge with the real subject. So start from the confident
// core only, keep the core regions that are about as confident as the best one, and let them
// grow a couple of pixels into the middling zone to recover soft edges.
function confidentRegions(prob: Float32Array, w: number, h: number): Uint8Array {
  const N = w * h;
  const core = new Uint8Array(N);
  let coreArea = 0;
  for (let i = 0; i < N; i++) { core[i] = prob[i] >= ML_CORE ? 1 : 0; coreArea += core[i]; }
  if (coreArea < N * MIN_SUBJECT) {
    // No strong core — the model is unsure everywhere, so take its broad answer
    for (let i = 0; i < N; i++) core[i] = prob[i] >= ML_THRESHOLD ? 1 : 0;
    return core;
  }

  const { label, sizes } = labelComponents(core, w, h);
  const sum = new Float64Array(sizes.length);
  for (let i = 0; i < N; i++) if (label[i] >= 0) sum[label[i]] += prob[i];
  const mean = sizes.map((n, k) => sum[k] / n);
  const best = Math.max(0, ...mean.filter((_, k) => sizes[k] >= N * 0.005));
  const out = new Uint8Array(N);
  let frontier: number[] = [];
  for (let i = 0; i < N; i++) {
    if (label[i] >= 0 && mean[label[i]] >= best - ML_CONFIDENCE_MARGIN) { out[i] = 1; frontier.push(i); }
  }

  for (let step = 0; step < ML_EDGE_GROW_PX; step++) {
    const next: number[] = [];
    for (const p of frontier) {
      const x = p % w, y = (p - x) / w;
      for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1]) {
        if (q >= 0 && !out[q] && prob[q] >= ML_THRESHOLD) { out[q] = 1; next.push(q); }
      }
    }
    frontier = next;
  }
  return out;
}

// Share of the model's confident core that the heuristic also calls subject
function agreement(heuristicMask: Uint8Array, prob: Float32Array): number {
  let core = 0, both = 0;
  for (let i = 0; i < prob.length; i++) {
    if (prob[i] >= ML_CORE) { core++; both += heuristicMask[i]; }
  }
  return core ? both / core : 0;
}

function touches(mask: Uint8Array, i: number, w: number, h: number): boolean {
  const x = i % w, y = (i - x) / w;
  return !!(mask[i] || (x > 0 && mask[i - 1]) || (x < w - 1 && mask[i + 1]) || (y > 0 && mask[i - w]) || (y < h - 1 && mask[i + w]));
}

function heuristicSubject(data: Uint8ClampedArray, w: number, h: number): SubjectAnalysis {
  const N = w * h;
  const lab = rgbaToLab(data);
  const px = (i: number): Lab => [lab[i * 3], lab[i * 3 + 1], lab[i * 3 + 2]];

  // 1. Background colours = the dominant clusters around the border
  const t = Math.max(2, Math.round(Math.min(w, h) * BORDER_FRACTION));
  const ring: number[] = [];
  const borderPts: Lab[] = [];
  const borderW: number[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x >= t && x < w - t && y >= t && y < h - t) continue;
      const i = y * w + x;
      ring.push(i);
      borderPts.push(px(i));
      borderW.push(y >= h - t ? BORDER_BOTTOM_WEIGHT : 1);
    }
  }
  const { centers, counts } = kmeans(borderPts, 4, borderW);
  const totalW = counts.reduce((s, c) => s + c, 0);

  // Close-ups run off the frame, so the subject's own colour shows up on the border too.
  // A border colour that also fills the middle of the photo is subject, not background.
  const centre: Lab[] = [];
  for (let y = Math.floor(h * (0.5 - CENTRE_BOX / 2)); y < h * (0.5 + CENTRE_BOX / 2); y++) {
    for (let x = Math.floor(w * (0.5 - CENTRE_BOX / 2)); x < w * (0.5 + CENTRE_BOX / 2); x++) centre.push(px(y * w + x));
  }
  const centreShare = (c: Lab) => centre.filter((p) => dist2(p, c) < BG_NEAR * BG_NEAR).length / centre.length;
  const bgCenters = centers.filter((c, k) => counts[k] / totalW >= BG_CLUSTER_MIN_SHARE && centreShare(c) < CENTRE_MAX_BG_SHARE);
  if (bgCenters.length === 0) return noSubject(w, h);

  const dBg = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const p = px(i);
    dBg[i] = Math.sqrt(Math.min(...bgCenters.map((c) => dist2(p, c))));
  }

  // 2. Flood-fill background inward from the border
  const isBg = new Uint8Array(N);
  const queue = new Int32Array(N);
  let head = 0, tail = 0;
  for (const i of ring) {
    if (dBg[i] < BG_NEAR && !isBg[i]) { isBg[i] = 1; queue[tail++] = i; }
  }
  while (head < tail) {
    const p = queue[head++];
    const x = p % w, y = (p - x) / w;
    const pLab = px(p);
    for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1]) {
      if (q < 0 || isBg[q]) continue;
      const near = dBg[q] < BG_NEAR;
      const smooth = dBg[q] < BG_FAR && dist2(pLab, px(q)) < BG_STEP * BG_STEP;
      if (near || smooth) { isBg[q] = 1; queue[tail++] = q; }
    }
  }

  // Anything the background couldn't reach is subject (enclosed holes included)
  const mask = new Uint8Array(N);
  for (let i = 0; i < N; i++) mask[i] = isBg[i] ? 0 : 1;
  const cleaned = cleanMask(mask, w, h);
  if (backgroundLooksLikeSubject(cleaned, lab, w, h)) return noSubject(w, h);
  return finish(cleaned, w, h, false);
}

// Background regions that don't touch the image edge are enclosed by the subject —
// the inside of a guitar body, the gap between a cookie's arms — so they're subject too
function fillHoles(mask: Uint8Array, w: number, h: number): Uint8Array {
  const N = w * h;
  const outside = new Uint8Array(N);
  const stack: number[] = [];
  for (let x = 0; x < w; x++) stack.push(x, (h - 1) * w + x);
  for (let y = 0; y < h; y++) stack.push(y * w, y * w + w - 1);
  while (stack.length) {
    const p = stack.pop()!;
    if (mask[p] || outside[p]) continue;
    outside[p] = 1;
    const x = p % w, y = (p - x) / w;
    if (x > 0) stack.push(p - 1);
    if (x < w - 1) stack.push(p + 1);
    if (y > 0) stack.push(p - w);
    if (y < h - 1) stack.push(p + w);
  }
  const out = new Uint8Array(N);
  for (let i = 0; i < N; i++) out[i] = outside[i] ? 0 : 1;
  return out;
}

// Real backgrounds are smooth or blurred; if the "background" is as detailed as the
// subject (feathers, fur, foliage), we've split the subject in two — don't flatten it.
function backgroundLooksLikeSubject(mask: Uint8Array, lab: Float32Array, w: number, h: number): boolean {
  let subjectSum = 0, subjectN = 0, bgSum = 0, bgN = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const m = mask[i];
      // Interior pixels only — the silhouette edge itself is high-contrast by definition
      if (mask[i - 1] !== m || mask[i + 1] !== m || mask[i - w] !== m || mask[i + w] !== m) continue;
      const g = Math.abs(lab[i * 3] - lab[(i + 1) * 3]) + Math.abs(lab[i * 3] - lab[(i + w) * 3]);
      if (m) { subjectSum += g; subjectN++; } else { bgSum += g; bgN++; }
    }
  }
  if (bgN === 0 || subjectN === 0) return false;
  const bgTexture = bgSum / bgN, subjectTexture = subjectSum / subjectN;
  return bgTexture > BG_MAX_TEXTURE && bgTexture > subjectTexture * BG_MAX_TEXTURE_RATIO;
}

// Drop specks: keep only connected regions that are a meaningful size
function cleanMask(mask: Uint8Array, w: number, h: number): Uint8Array {
  const N = w * h;
  const { label, sizes } = labelComponents(mask, w, h);
  const largest = Math.max(0, ...sizes);
  const keepMin = Math.max(N * 0.01, largest * 0.15);
  const out = new Uint8Array(N);
  for (let i = 0; i < N; i++) out[i] = label[i] >= 0 && sizes[label[i]] >= keepMin ? 1 : 0;
  return out;
}

// 4-connected regions of a mask: label per pixel (-1 = not in mask) and size per label
function labelComponents(mask: Uint8Array, w: number, h: number) {
  const N = w * h;
  const label = new Int32Array(N).fill(-1);
  const sizes: number[] = [];
  const stack: number[] = [];
  for (let s = 0; s < N; s++) {
    if (!mask[s] || label[s] >= 0) continue;
    const id = sizes.length;
    let size = 0;
    label[s] = id;
    stack.push(s);
    while (stack.length) {
      const p = stack.pop()!;
      size++;
      const x = p % w, y = (p - x) / w;
      for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1]) {
        if (q >= 0 && mask[q] && label[q] < 0) { label[q] = id; stack.push(q); }
      }
    }
    sizes.push(size);
  }
  return { label, sizes };
}

function finish(mask: Uint8Array, w: number, h: number, alphaMode: boolean): SubjectAnalysis {
  const area = mask.reduce((s, v) => s + v, 0) / (w * h);
  if (area < MIN_SUBJECT || (!alphaMode && area > MAX_SUBJECT)) return noSubject(w, h);

  // Bounds from the 1st–99th percentile of subject pixels, so stray bits don't widen the crop
  const cols = new Float64Array(w), rows = new Float64Array(h);
  let total = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (mask[y * w + x]) { cols[x]++; rows[y]++; total++; }
    }
  }
  const [x0, x1] = percentileRange(cols, total);
  const [y0, y1] = percentileRange(rows, total);
  return { w, h, mask, hasSubject: true, alphaMode, bbox: { x0: x0 / w, y0: y0 / h, x1: (x1 + 1) / w, y1: (y1 + 1) / h } };
}

function percentileRange(hist: Float64Array, total: number): [number, number] {
  let acc = 0, lo = 0, hi = hist.length - 1;
  for (let i = 0; i < hist.length; i++) { acc += hist[i]; if (acc >= total * 0.01) { lo = i; break; } }
  acc = 0;
  for (let i = hist.length - 1; i >= 0; i--) { acc += hist[i]; if (acc >= total * 0.01) { hi = i; break; } }
  return [lo, hi];
}

function noSubject(w: number, h: number): SubjectAnalysis {
  return { w, h, mask: new Uint8Array(w * h).fill(1), hasSubject: false, alphaMode: false, bbox: { x0: 0, y0: 0, x1: 1, y1: 1 } };
}
