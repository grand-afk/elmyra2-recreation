// Band-limited wavetables: 4 pages x 8 waves, each with one table per octave ("mip level")
// so high notes never alias. Built with an inverse FFT, which takes a few ms at startup.
//
// The spectra are original designs, voiced to cover similar ground to the hardware pages
// (basic, organ, formant, metallic). They are a starting point for tuning by ear.

export const TABLE_SIZE = 2048;
export const WAVES_PER_PAGE = 8;
export const NUM_PAGES = 4;
export const MAX_HARMONICS = TABLE_SIZE / 2; // 1024
export const NUM_LEVELS = 11; // level k keeps harmonics up to 1024 >> k

/** Spectrum generator: amplitude of harmonic h (1-based), sign encodes phase. */
type Spectrum = (h: number) => number;

const pulse = (duty: number): Spectrum => (h) => (2 / (h * Math.PI)) * Math.sin(Math.PI * h * duty);

// Deterministic pseudo-random for the metallic page.
const hash = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};
const isPrime = (n: number) => {
  if (n < 2) return false;
  for (let d = 2; d * d <= n; d++) if (n % d === 0) return false;
  return true;
};
const drawbar = (bars: Record<number, number>): Spectrum => (h) => bars[h] ?? 0;
const formant = (centre: number, width: number): Spectrum => (h) =>
  (1 / h) * (0.15 + Math.exp(-((h - centre) ** 2) / (2 * width * width)) * 3);

export const PAGES: { name: string; waves: Spectrum[] }[] = [
  {
    name: 'Basic',
    waves: [
      (h) => (h === 1 ? 1 : 0), // sine
      (h) => (h % 2 ? ((h - 1) / 2) % 2 ? -1 / (h * h) : 1 / (h * h) : 0), // triangle
      (h) => 1 / h ** 1.6, // soft saw
      (h) => 1 / h, // saw
      (h) => (h % 2 ? 1 / h : 0), // square
      pulse(0.25),
      pulse(0.125),
      pulse(0.05),
    ],
  },
  {
    name: 'Organ',
    waves: [
      drawbar({ 1: 1, 2: 0.5 }),
      drawbar({ 1: 1, 3: 0.6, 5: 0.3 }),
      drawbar({ 1: 0.8, 2: 0.8, 4: 0.6, 8: 0.4 }),
      drawbar({ 1: 1, 2: 0.7, 3: 0.7, 4: 0.5, 6: 0.4, 8: 0.3 }),
      drawbar({ 1: 0.6, 3: 1, 6: 0.5, 9: 0.3 }),
      drawbar({ 1: 0.5, 2: 0.5, 3: 0.5, 4: 0.5, 5: 0.5, 6: 0.5, 8: 0.5, 10: 0.4, 12: 0.3, 16: 0.2 }),
      drawbar({ 2: 1, 4: 0.6, 8: 0.4, 16: 0.3 }),
      drawbar({ 1: 0.4, 5: 0.8, 7: 0.6, 11: 0.5, 13: 0.4 }),
    ],
  },
  {
    name: 'Formant',
    waves: [2, 3.5, 5, 7, 9.5, 13, 18, 26].map((c, i) => formant(c, 1.2 + i * 0.6)),
  },
  {
    name: 'Metallic',
    waves: [
      (h) => (isPrime(h) ? 1 / Math.sqrt(h) : h === 1 ? 1 : 0),
      (h) => (h % 3 === 1 ? 1 / h : 0),
      (h) => (h === 1 ? 1 : h % 4 === 0 ? 0.9 / Math.sqrt(h) : 0),
      (h) => (hash(h) > 0.6 ? 1 / h ** 0.8 : 0) + (h === 1 ? 0.6 : 0),
      (h) => (hash(h * 3) > 0.75 ? (hash(h * 7) - 0.5) * 2 / h ** 0.6 : 0) + (h === 1 ? 0.5 : 0),
      (h) => (h >= 5 && h <= 15 ? 0.7 : h === 1 ? 1 : 0),
      (h) => (h % 2 ? 0 : 1 / h ** 0.7) + (h === 1 ? 0.7 : 0),
      (h) => (hash(h * 11) > 0.5 ? (h % 2 ? 1 : -1) / h ** 0.5 : 0),
    ],
  },
];

/** In-place iterative radix-2 FFT (complex). Inverse when `inv` is true (unscaled). */
function fft(re: Float64Array, im: Float64Array, inv: boolean) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inv ? 2 : -2) * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ar = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const ai = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k + len / 2] = re[i + k] - ar;
        im[i + k + len / 2] = im[i + k] - ai;
        re[i + k] += ar;
        im[i + k] += ai;
        const t = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = t;
      }
    }
  }
}

/** Build one table holding harmonics 1..maxHarm of a spectrum, normalised to peak 1. */
function buildTable(spec: Spectrum, maxHarm: number, out: Float32Array, offset: number) {
  const n = TABLE_SIZE;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  // x[k] = sum a_h sin(2π h k / n)  ⇔  X[h] = -i a_h n/2, X[n-h] = +i a_h n/2
  for (let h = 1; h <= maxHarm && h < n / 2; h++) {
    const a = spec(h);
    if (!a) continue;
    im[h] = (-a * n) / 2;
    im[n - h] = (a * n) / 2;
  }
  if (!im.some((x) => x !== 0)) {
    // Nothing left under this level's harmonic limit (e.g. a spectrum without a fundamental
    // at the top octave): fall back to a sine so very high notes never go silent.
    im[1] = -n / 2;
    im[n - 1] = n / 2;
  }
  fft(re, im, true);
  let peak = 0;
  for (let k = 0; k < n; k++) peak = Math.max(peak, Math.abs(re[k] / n));
  const g = peak > 0 ? 1 / peak : 0;
  for (let k = 0; k < n; k++) out[offset + k] = (re[k] / n) * g;
}

export interface WavetableBank {
  /** [page][wave][level][sample] flattened. */
  data: Float32Array;
  bytes: number;
}

export function buildBank(): WavetableBank {
  const data = new Float32Array(NUM_PAGES * WAVES_PER_PAGE * NUM_LEVELS * TABLE_SIZE);
  for (let p = 0; p < NUM_PAGES; p++)
    for (let w = 0; w < WAVES_PER_PAGE; w++)
      for (let l = 0; l < NUM_LEVELS; l++)
        buildTable(PAGES[p].waves[w], Math.max(1, MAX_HARMONICS >> l), data, tableOffset(p, w, l));
  return { data, bytes: data.byteLength };
}

export const tableOffset = (page: number, wave: number, level: number) =>
  ((page * WAVES_PER_PAGE + wave) * NUM_LEVELS + level) * TABLE_SIZE;

/** Mip level that keeps every harmonic below Nyquist for a given frequency. */
export function levelFor(freq: number, sampleRate: number): number {
  const allowed = sampleRate / 2 / Math.max(freq, 1);
  if (allowed >= MAX_HARMONICS) return 0;
  const l = Math.ceil(Math.log2(MAX_HARMONICS / allowed));
  return l >= NUM_LEVELS ? NUM_LEVELS - 1 : l;
}
