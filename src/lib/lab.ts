// Fast sRGB → CIE Lab (D65) for per-pixel work. chroma-js is used for the
// final, small-scale steps (CIEDE2000, hex, naming) where speed doesn't matter.
export type Lab = [number, number, number];

const LINEAR = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  LINEAR[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function f(t: number): number {
  return t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
}

export function rgbToLab(r: number, g: number, b: number): Lab {
  const R = LINEAR[r], G = LINEAR[g], B = LINEAR[b];
  const fx = f((R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047);
  const fy = f(R * 0.2126 + G * 0.7152 + B * 0.0722);
  const fz = f((R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

// Converts RGBA pixel data to a packed Lab array [L0, a0, b0, L1, ...]
export function rgbaToLab(data: Uint8ClampedArray): Float32Array {
  const out = new Float32Array((data.length / 4) * 3);
  for (let i = 0, j = 0; i < data.length; i += 4, j += 3) {
    const [L, a, b] = rgbToLab(data[i], data[i + 1], data[i + 2]);
    out[j] = L;
    out[j + 1] = a;
    out[j + 2] = b;
  }
  return out;
}

// Squared Euclidean distance (ΔE76²) — fine for clustering, not for final matching
export function dist2(p: Lab, q: Lab): number {
  const dL = p[0] - q[0], da = p[1] - q[1], db = p[2] - q[2];
  return dL * dL + da * da + db * db;
}

// k-means in Lab. Seeds with the mean, then repeatedly the point farthest from every
// existing centre — deterministic, and small distinct accents (an eye, a beak) get a seed.
export function kmeans(points: Lab[], k: number, weights?: number[], iterations = 10) {
  const n = points.length;
  const w = (i: number) => (weights ? weights[i] : 1);
  const centers: Lab[] = [];
  const assign = new Int32Array(n);
  if (n === 0 || k <= 0) return { centers, assign, counts: [] as number[] };

  let sL = 0, sa = 0, sb = 0, total = 0;
  for (let i = 0; i < n; i++) {
    sL += points[i][0] * w(i); sa += points[i][1] * w(i); sb += points[i][2] * w(i); total += w(i);
  }
  centers.push([sL / total, sa / total, sb / total]);

  const minD = new Float64Array(n).fill(Infinity);
  while (centers.length < Math.min(k, n)) {
    const last = centers[centers.length - 1];
    let best = -1, bestD = 1; // ignore points within ΔE 1 of an existing centre
    for (let i = 0; i < n; i++) {
      const d = dist2(points[i], last);
      if (d < minD[i]) minD[i] = d;
      if (minD[i] > bestD) { bestD = minD[i]; best = i; }
    }
    if (best < 0) break;
    centers.push([...points[best]]);
  }

  let counts: number[] = [];
  for (let it = 0; it < iterations; it++) {
    const sums = centers.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < n; i++) {
      let bi = 0, bd = Infinity;
      for (let c = 0; c < centers.length; c++) {
        const d = dist2(points[i], centers[c]);
        if (d < bd) { bd = d; bi = c; }
      }
      assign[i] = bi;
      const s = sums[bi];
      s[0] += points[i][0] * w(i); s[1] += points[i][1] * w(i); s[2] += points[i][2] * w(i); s[3] += w(i);
    }
    counts = sums.map((s) => s[3]);
    sums.forEach((s, c) => {
      if (s[3] > 0) centers[c] = [s[0] / s[3], s[1] / s[3], s[2] / s[3]];
    });
  }
  return { centers, assign, counts };
}
