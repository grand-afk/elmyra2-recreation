// Pitch detection (YIN, de Cheveigné & Kawahara 2002) and a magnitude spectrum,
// for the scope's readout and spectrum view. Pure functions, no browser APIs.
import { fft } from './fft';

export interface PitchResult {
  hz: number;
  /** 0..1, where 1 = perfectly periodic. */
  confidence: number;
}

/**
 * Estimate the fundamental of the last part of `buf`.
 * Uses a window of `win` samples and looks for periods between maxHz and minHz.
 */
export function yin(buf: Float32Array, sr: number, minHz = 25, maxHz = 4000, threshold = 0.12): PitchResult | null {
  const tauMax = Math.min(Math.floor(sr / minHz), Math.floor(buf.length / 2));
  const tauMin = Math.max(2, Math.floor(sr / maxHz));
  const win = Math.min(buf.length - tauMax, 2048);
  if (win < 64 || tauMax <= tauMin + 2) return null;
  const off = buf.length - win - tauMax;
  // difference function
  const d = new Float32Array(tauMax + 1);
  for (let tau = 1; tau <= tauMax; tau++) {
    let sum = 0;
    for (let i = 0; i < win; i++) {
      const delta = buf[off + i] - buf[off + i + tau];
      sum += delta * delta;
    }
    d[tau] = sum;
  }
  // cumulative mean normalised difference
  const cmnd = new Float32Array(tauMax + 1);
  cmnd[0] = 1;
  let running = 0;
  for (let tau = 1; tau <= tauMax; tau++) {
    running += d[tau];
    cmnd[tau] = running > 0 ? (d[tau] * tau) / running : 1;
  }
  // first dip under the threshold, then walk to its local minimum
  let tau = -1;
  for (let t = tauMin; t < tauMax; t++) {
    if (cmnd[t] < threshold) {
      while (t + 1 < tauMax && cmnd[t + 1] < cmnd[t]) t++;
      tau = t;
      break;
    }
  }
  if (tau < 0) {
    // no clear dip: take the global minimum but report low confidence
    let best = tauMin;
    for (let t = tauMin; t < tauMax; t++) if (cmnd[t] < cmnd[best]) best = t;
    tau = best;
  }
  // parabolic interpolation on the raw difference for sub-sample accuracy
  let exact = tau;
  if (tau > 1 && tau < tauMax) {
    const a = d[tau - 1];
    const b = d[tau];
    const c = d[tau + 1];
    const den = a - 2 * b + c;
    if (den !== 0) exact = tau + (0.5 * (a - c)) / den;
  }
  const hz = sr / exact;
  const confidence = Math.max(0, Math.min(1, 1 - cmnd[tau]));
  return Number.isFinite(hz) ? { hz, confidence } : null;
}

/** Magnitude spectrum in dBFS of the last `n` samples (n a power of two), Hann-windowed. */
export function spectrumDb(buf: Float32Array, n: number): Float32Array {
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  const start = Math.max(0, buf.length - n);
  let wsum = 0;
  for (let i = 0; i < n; i++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
    wsum += w;
    re[i] = (buf[start + i] ?? 0) * w;
  }
  fft(re, im, false);
  const out = new Float32Array(n / 2);
  for (let k = 0; k < n / 2; k++) {
    const mag = (2 * Math.hypot(re[k], im[k])) / wsum;
    out[k] = 20 * Math.log10(mag + 1e-9);
  }
  return out;
}
