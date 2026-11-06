// Builds a small palette of clearly different colours: the background gets one or two
// flat colours, the subject gets the rest of the budget, and near-duplicate shades are
// merged so nobody needs five greens to finish a picture.
import chroma from "chroma-js";
import { type Lab, kmeans } from "./lab";

const MIN_DELTA_E = 16;          // CIEDE2000: closer than this reads as the same pencil
const MIN_COLORS = 2;
const SAME_COLOR_DELTA_E = 5;    // below this, two colours are genuinely indistinguishable
const MAX_PER_HUE_FAMILY = 2;    // e.g. a light and a dark green, never five greens
const MAX_MAIN_HUE_FAMILY = 3;   // the picture's main hue gets light/mid/dark so it keeps its form
const MAX_NEUTRALS = 3;          // black / grey / white
const NEUTRAL_CHROMA = 10;
const CHROMA_CAP = 65;
const NEAR_GRAY_CHROMA = 8;
const BG_SPLIT_DELTA_E = 25;     // only use two background colours if they're this different…
const BG_SPLIT_MIN_SHARE = 0.3;  // …and each covers a real chunk of the background
const BG_MIN_CONTRAST = 15;      // background must stay distinct from every subject colour
const PAPER_WHITE: Lab = [100, 0, 0];

export interface CellSample {
  subject: boolean;
  lab: Lab | null; // null = cell lies entirely outside the image (crop padding)
}

export interface Swatch {
  lab: Lab;          // final, stylised colour
  original: Lab;     // colour before stylising
  kind: "subject" | "background";
  cells: number;
}

type Cluster = { lab: Lab; weight: number };

const deltaE = (p: Lab, q: Lab) => chroma.deltaE(chroma.lab(...p), chroma.lab(...q));

// 30° hue bands; -1 for neutrals (black/grey/white)
function hueFamily([, a, b]: Lab): number {
  if (Math.hypot(a, b) < NEUTRAL_CHROMA) return -1;
  const h = (Math.atan2(b, a) * 180 / Math.PI + 360) % 360;
  return Math.floor(((h + 15) % 360) / 30);
}

function mergePair(list: Cluster[], i: number, j: number) {
  const a = list[i], b = list[j];
  const w = a.weight + b.weight;
  list[i] = {
    lab: [0, 1, 2].map((k) => (a.lab[k] * a.weight + b.lab[k] * b.weight) / w) as Lab,
    weight: w,
  };
  list.splice(j, 1);
}

function closestPair(list: Cluster[], allow: (a: Cluster, b: Cluster) => boolean) {
  let best: { i: number; j: number; d: number } | null = null;
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      if (!allow(list[i], list[j])) continue;
      const d = deltaE(list[i].lab, list[j].lab);
      if (!best || d < best.d) best = { i, j, d };
    }
  }
  return best;
}

// Merge until: within budget, no two colours look alike, and no hue family is overloaded
function simplify(clusters: Cluster[], budget: number): Cluster[] {
  const list = clusters.filter((c) => c.weight > 0).map((c) => ({ ...c }));
  for (;;) {
    const pair = closestPair(list, () => true);
    if (!pair) break;
    // Never flatten a picture to one colour unless it truly is one colour
    if (list.length <= MIN_COLORS && pair.d >= SAME_COLOR_DELTA_E) break;
    if (pair.d < MIN_DELTA_E || list.length > budget) {
      mergePair(list, pair.i, pair.j);
      continue;
    }
    const familyCounts = new Map<number, number>();
    const familyWeight = new Map<number, number>();
    for (const c of list) {
      const fam = hueFamily(c.lab);
      familyCounts.set(fam, (familyCounts.get(fam) ?? 0) + 1);
      familyWeight.set(fam, (familyWeight.get(fam) ?? 0) + c.weight);
    }
    const mainFamily = [...familyWeight].filter(([fam]) => fam !== -1).sort((a, b) => b[1] - a[1])[0]?.[0];
    const limit = (fam: number) =>
      fam === -1 ? MAX_NEUTRALS : fam === mainFamily ? MAX_MAIN_HUE_FAMILY : MAX_PER_HUE_FAMILY;
    const overfull = [...familyCounts].find(([fam, n]) => n > limit(fam));
    if (!overfull) break;
    const fam = overfull[0];
    const inFamily = closestPair(list, (a, b) => hueFamily(a.lab) === fam && hueFamily(b.lab) === fam)!;
    mergePair(list, inFamily.i, inFamily.j);
  }
  return list;
}

// Gentle pop (the old contrast/saturation pre-boost), capped so nothing gets garish
function stylize([L, a, b]: Lab): Lab {
  const L2 = Math.min(100, Math.max(0, 50 + (L - 50) * 1.08));
  let c = Math.hypot(a, b) * 1.1;
  if (c < NEAR_GRAY_CHROMA) return [L2, 0, 0];
  c = Math.min(c, CHROMA_CAP);
  const h = Math.atan2(b, a);
  return [L2, c * Math.cos(h), c * Math.sin(h)];
}

function backgroundClusters(labs: Lab[], budget: number, alphaMode: boolean): Cluster[] {
  if (alphaMode || labs.length === 0) return [{ lab: PAPER_WHITE, weight: Math.max(1, labs.length) }];
  const { centers, counts } = kmeans(labs, 2);
  const total = counts.reduce((s, c) => s + c, 0);
  const order = counts.map((_, i) => i).sort((p, q) => counts[q] - counts[p]);
  if (
    budget >= 4 && centers.length === 2 &&
    deltaE(centers[0], centers[1]) >= BG_SPLIT_DELTA_E &&
    Math.min(...counts) / total >= BG_SPLIT_MIN_SHARE
  ) {
    return order.map((i) => ({ lab: centers[i], weight: counts[i] }));
  }
  return [{ lab: centers[order[0]], weight: total }];
}

// Nudge the background lighter/darker until it can't be confused with the subject
function separateBackground(bg: Lab, subject: Lab[]): Lab {
  if (subject.length === 0) return bg;
  const meanL = subject.reduce((s, c) => s + c[0], 0) / subject.length;
  const dir = bg[0] >= meanL ? 1 : -1;
  const out: Lab = [...bg];
  while (Math.min(...subject.map((c) => deltaE(out, c))) < BG_MIN_CONTRAST) {
    const next = out[0] + dir * 4;
    if (next < 4 || next > 98) break;
    out[0] = next;
  }
  return out;
}

export function buildPalette(samples: CellSample[], budget: number, alphaMode: boolean) {
  let subjectIdx = samples.flatMap((s, i) => (s.subject && s.lab ? [i] : []));
  // A subject too small to claim any cell — treat everything as subject rather than show nothing
  const treatAllAsSubject = subjectIdx.length === 0;
  if (treatAllAsSubject) subjectIdx = samples.flatMap((s, i) => (s.lab ? [i] : []));
  const isSubject = (i: number) => (treatAllAsSubject ? samples[i].lab !== null : samples[i].subject);
  const bgIdx = samples.flatMap((_, i) => (isSubject(i) ? [] : [i]));

  const bg = bgIdx.length
    ? backgroundClusters(bgIdx.flatMap((i) => (samples[i].lab ? [samples[i].lab!] : [])), budget, alphaMode)
    : [];

  // Over-seed the subject so small distinct accents get a cluster, then merge down to budget
  const subjectBudget = Math.max(1, budget - bg.length);
  const subjectLabs = subjectIdx.map((i) => samples[i].lab!);
  const { centers, counts } = kmeans(subjectLabs, subjectBudget + 3);
  const subject = simplify(centers.map((lab, i) => ({ lab, weight: counts[i] })), subjectBudget);

  const subjectFinal = subject.map((c) => stylize(c.lab));
  const bgFinal = bg.map((c) => separateBackground(alphaMode ? c.lab : stylize(c.lab), subjectFinal));

  const swatches: Swatch[] = [
    ...subject.map((c, i) => ({ lab: subjectFinal[i], original: c.lab, kind: "subject" as const, cells: 0 })),
    ...bg.map((c, i) => ({ lab: bgFinal[i], original: c.lab, kind: "background" as const, cells: 0 })),
  ];

  const nearest = (lab: Lab, kind: Swatch["kind"]) => {
    let best = -1, bestD = Infinity;
    swatches.forEach((s, k) => {
      if (s.kind !== kind) return;
      const d = deltaE(lab, s.original);
      if (d < bestD) { bestD = d; best = k; }
    });
    return best;
  };

  const cellSwatch = samples.map((s, i) => {
    const kind = isSubject(i) ? "subject" : "background";
    const k = s.lab ? nearest(s.lab, kind) : swatches.findIndex((sw) => sw.kind === "background");
    swatches[k].cells++;
    return k;
  });

  return { swatches, cellSwatch };
}
