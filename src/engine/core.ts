// The DSP core. Pure TypeScript with no browser APIs, so it runs in the AudioWorklet,
// in Node for tests and offline renders, and later in an OfflineAudioContext.
//
// Signal order follows the manual v2.4:
//   voices -> mix saturation -> main filter -> delay -> (+ ext in) -> OUCH -> master
// Filter arrives in milestone 4; no external input yet.

import { NUM_VOICES, PARAM_INDEX, PARAMS, defaultValues, type TapId } from './params';
import {
  TABLE_SIZE,
  WAVES_PER_PAGE,
  buildBank,
  levelFor,
  tableOffset,
  type WavetableBank,
} from './wavetables';
import { EDOS, TUNE_OCTAVES, quantiseTune, type Tuning } from './tuning';

const TWO_PI = Math.PI * 2;
const A0 = 27.5;

const P = PARAM_INDEX;

/** One-pole smoothing coefficient for a time constant in seconds. */
const coef = (seconds: number, sr: number) => Math.exp(-1 / Math.max(1e-6, seconds * sr));

/** PolyBLEP residual for band-limited saw and square. */
function polyBlep(t: number, dt: number): number {
  if (t < dt) {
    const x = t / dt;
    return x + x - x * x - 1;
  }
  if (t > 1 - dt) {
    const x = (t - 1) / dt;
    return x * x + x + x + 1;
  }
  return 0;
}

class Voice {
  phaseA = 0;
  phaseB = 0;
  subPhase = 0; // runs at f/4; saw sub uses 2x of it
  env = 0;
  /** Current pitch in octaves above A0 (smoothed in the log domain). */
  pitch = 0;
  hz = 0;
  wave = 0;
  mod = 0;
  out = 0;
}

export interface CoreStats {
  memBytes: number;
}

export class ElmyraCore {
  readonly sr: number;
  readonly params: Float32Array;
  private bank: WavetableBank;
  private voices: Voice[] = [];
  private smoothCoef: number;
  private tuneCoef: number;

  // Delay
  private dBuf: Float32Array;
  private dWrite = 0;
  private dTime: number; // samples, smoothed
  private dLp = 0;
  private dDc = 0;
  private dDcIn = 0;
  private dMix = 0;
  private dFb = 0;

  // OUCH
  private bite = 0;
  private choke = 1;
  private svfLow = 0;
  private svfBand = 0;

  // Output
  private master = 0;
  private dcIn = 0;
  private dcOut = 0;

  // Scope tap
  activeTap: TapId | null = null;
  /** ~680 ms at 48 kHz: enough for the longest scope timebase (50 ms/div x 10). */
  readonly tapRing: Float32Array = new Float32Array(32768);
  tapWrite = 0;

  constructor(sampleRate: number) {
    this.sr = sampleRate;
    this.params = defaultValues();
    this.bank = buildBank();
    for (let i = 0; i < NUM_VOICES; i++) this.voices.push(new Voice());
    this.smoothCoef = coef(0.01, sampleRate);
    this.tuneCoef = coef(0.03, sampleRate);
    this.dBuf = new Float32Array(Math.ceil(sampleRate * 2) + 4);
    this.dTime = this.delaySamples(this.params[P['delay.time']]);
    this.master = this.params[P.master];
    for (let i = 0; i < NUM_VOICES; i++) {
      const v = this.voices[i];
      v.pitch = this.params[P[`v${i + 1}.tune`]] * TUNE_OCTAVES;
      v.wave = this.params[P[`v${i + 1}.wave`]];
      v.mod = this.params[P[`v${i + 1}.mod`]];
    }
  }

  setParam(index: number, value: number) {
    if (index >= 0 && index < this.params.length && Number.isFinite(value)) this.params[index] = value;
  }

  setParamById(id: string, value: number) {
    this.setParam(P[id], value);
  }

  stats(): CoreStats {
    return { memBytes: this.bank.bytes + this.dBuf.byteLength + this.tapRing.byteLength };
  }

  /** TUNE knob → Hz. Seven octaves from A0 (27.5 Hz) to A7 (3520 Hz). */
  static tuneToHz(tune: number) {
    return A0 * Math.pow(2, tune * TUNE_OCTAVES);
  }

  /** ENV knob → envelope time constant: 3 ms .. ~6 s, exponential. */
  static envSeconds(env: number) {
    return 0.003 * Math.pow(2000, env);
  }

  /** Delay TIME knob → samples, 5 ms .. 1.6 s with a squared curve for fine short times. */
  private delaySamples(t: number) {
    return (0.005 + 1.595 * t * t) * this.sr;
  }

  /** Read one wavetable sample with linear interpolation in phase and wave position. */
  private readTable(page: number, wavePos: number, level: number, phase: number) {
    const d = this.bank.data;
    const wp = wavePos * (WAVES_PER_PAGE - 1);
    let w0 = Math.floor(wp);
    if (w0 >= WAVES_PER_PAGE - 1) w0 = WAVES_PER_PAGE - 2;
    const wf = wp - w0;
    const x = phase * TABLE_SIZE;
    const i0 = Math.floor(x);
    const f = x - i0;
    const i1 = (i0 + 1) & (TABLE_SIZE - 1);
    const o0 = tableOffset(page, w0, level);
    const o1 = tableOffset(page, w0 + 1, level);
    const a = d[o0 + i0] + (d[o0 + i1] - d[o0 + i0]) * f;
    const b = d[o1 + i0] + (d[o1 + i1] - d[o1 + i0]) * f;
    return a + (b - a) * wf;
  }

  /** Render `frames` samples of mono output into `out`. Optional per-sample tap/record hooks. */
  process(out: Float32Array, frames = out.length) {
    const p = this.params;
    const sr = this.sr;
    const sc = this.smoothCoef;
    const tc = this.tuneCoef;

    // Per-block (control-rate) values
    const masterT = p[P.master] * p[P.master];
    const dTimeT = this.delaySamples(p[P['delay.time']]);
    const dFbT = p[P['delay.fdbk']] * 2; // 100% at the middle of the knob, as on the hardware
    const dMixT = p[P['delay.mix']];
    const biteT = p[P['ouch.bite']];
    const chokeT = p[P['ouch.choke']];
    const tapVoice = Math.min(NUM_VOICES - 1, Math.max(0, Math.round(p[P['tap.voice']])));
    const tap = this.activeTap;
    const dLen = this.dBuf.length;
    // delay feedback colour, codes 321-324 (323 default)
    const lpHz = [1200, 2600, 5000, 11000][Math.round(p[P['delay.color']])] ?? 5000;
    const lpC = 1 - Math.exp((-TWO_PI * lpHz) / sr);
    const timeSlew = coef(0.12, sr); // tape-like when TIME moves

    const vp = this.voices.map((_, i) => {
      const b = `v${i + 1}.`;
      return {
        page: Math.round(p[P[b + 'page']]) & 3,
        drone: p[P[b + 'drone']] > 0.5,
        gate: Math.min(1, Math.max(0, p[P[b + 'gate']])),
        modp: Math.round(p[P[b + 'modp']]),
        tune: p[P[b + 'tune']],
        oct: p[P[b + 'oct']] > 0.5 ? 1 : 0,
        chrm: p[P[b + 'chrm']] > 0.5,
        note: p[P[b + 'note']],
        mute: p[P[b + 'mute']] > 0.5,
        wave: p[P[b + 'wave']],
        mod: p[P[b + 'mod']],
        envCoef: coef(ElmyraCore.envSeconds(p[P[b + 'env']]), sr),
      };
    });

    // Target pitch per voice (octaves above A0), then tune follow (codes 2221-2224).
    const tuning: Tuning = { edo: EDOS[Math.round(p[P['chrm.edo']])] ?? 12, scale: Math.round(p[P['chrm.scale']]) };
    const follow = Math.round(p[P['tune.follow']]);
    const targets = vp.map((c) => {
      if (c.note >= 0) return { o: c.note, fast: true };
      if (c.chrm) return { o: quantiseTune(c.tune, tuning) + c.oct, fast: true };
      return { o: c.tune * TUNE_OCTAVES + c.oct, fast: false };
    });
    for (let i = 1; i <= follow && i < NUM_VOICES; i++) targets[i] = targets[0];
    const fastC = coef(0.004, sr);
    const sat = Math.round(p[P['mix.sat']]);

    for (let n = 0; n < frames; n++) {
      // ---- voices -------------------------------------------------------
      let mix = 0;
      for (let i = 0; i < NUM_VOICES; i++) {
        const v = this.voices[i];
        const c = vp[i];
        const tg = targets[i];
        v.pitch = tg.o + (v.pitch - tg.o) * (tg.fast ? fastC : tc);
        v.wave = c.wave + (v.wave - c.wave) * sc;
        v.mod = c.mod + (v.mod - c.mod) * sc;
        const target = c.drone ? 1 : c.gate;
        v.env = target + (v.env - target) * c.envCoef;
        if ((v.env < 1e-5 && target === 0) || c.mute) {
          v.out = 0;
          continue; // silent voice: skip oscillator cost
        }
        const f = A0 * Math.pow(2, v.pitch);
        v.hz = f;
        let s: number;
        if (c.modp === 1) {
          // SUBOSC: saw one octave down, square two octaves down, faded in by MOD
          const lvl = levelFor(f, sr);
          v.phaseA += f / sr;
          v.phaseA -= Math.floor(v.phaseA);
          const main = this.readTable(c.page, v.wave, lvl, v.phaseA);
          const dt = f / 4 / sr;
          v.subPhase += dt;
          v.subPhase -= Math.floor(v.subPhase);
          const sawPh = (v.subPhase * 2) % 1;
          const saw = 2 * sawPh - 1 - polyBlep(sawPh, dt * 2);
          let sq = v.subPhase < 0.5 ? 1 : -1;
          sq += polyBlep(v.subPhase, dt) - polyBlep((v.subPhase + 0.5) % 1, dt);
          const sawAmt = Math.min(1, v.mod * 2) * 0.7;
          const sqAmt = Math.max(0, v.mod * 2 - 1) * 0.6;
          s = (main + saw * sawAmt + sq * sqAmt) / (1 + sawAmt * 0.6 + sqAmt * 0.6);
        } else {
          // DETUNE (default): two oscillators spread up to ±50 cents by MOD
          const cents = v.mod * v.mod * 50;
          const r = Math.pow(2, cents / 1200);
          const fa = f * r;
          const fb = f / r;
          v.phaseA += fa / sr;
          v.phaseA -= Math.floor(v.phaseA);
          v.phaseB += fb / sr;
          v.phaseB -= Math.floor(v.phaseB);
          s =
            0.5 * this.readTable(c.page, v.wave, levelFor(fa, sr), v.phaseA) +
            0.5 * this.readTable(c.page, v.wave, levelFor(fb, sr), v.phaseB);
        }
        v.out = s * v.env * 0.35;
        mix += v.out;
      }

      // ---- mix saturation (codes 121-124; 122 default) ------------------
      // Lower settings are quieter overall, as the manual notes.
      let x: number;
      if (sat === 0) x = mix * 0.5;
      else if (sat === 1) x = Math.tanh(mix * 2) / Math.SQRT2;
      else if (sat === 2) {
        // hard: cubic soft knee into a flat clip
        const d = mix * 4;
        x = (d >= 1 ? 1 : d <= -1 ? -1 : 1.5 * d - 0.5 * d * d * d) * 0.75;
      } else {
        // dirty: asymmetric drive with crossover grit
        const d = mix * 7 + 0.35;
        x = (Math.tanh(d) - Math.tanh(0.35)) * 0.7 + Math.sign(mix) * Math.min(0.08, Math.abs(mix) * 0.4);
      }
      if (tap === 'T1') this.pushTap(this.voices[tapVoice].out);

      // ---- main filter: bypassed until milestone 4 -----------------------

      // ---- delay ---------------------------------------------------------
      this.dTime = dTimeT + (this.dTime - dTimeT) * timeSlew;
      this.dFb = dFbT + (this.dFb - dFbT) * sc;
      this.dMix = dMixT + (this.dMix - dMixT) * sc;
      let rp = this.dWrite - this.dTime;
      if (rp < 0) rp += dLen;
      const r0 = Math.floor(rp);
      const fr = rp - r0;
      const ym1 = this.dBuf[(r0 - 1 + dLen) % dLen];
      const y0 = this.dBuf[r0 % dLen];
      const y1 = this.dBuf[(r0 + 1) % dLen];
      const y2 = this.dBuf[(r0 + 2) % dLen];
      // 4-point Hermite interpolation
      const c1 = 0.5 * (y1 - ym1);
      const c2 = ym1 - 2.5 * y0 + 2 * y1 - 0.5 * y2;
      const c3 = 0.5 * (y2 - ym1) + 1.5 * (y0 - y1);
      const wet = ((c3 * fr + c2) * fr + c1) * fr + y0;
      // feedback path: colour low-pass, DC block, soft clip so >100% blooms instead of exploding
      this.dLp += (wet - this.dLp) * lpC;
      const dc = this.dLp - this.dDcIn + 0.995 * this.dDc;
      this.dDcIn = this.dLp;
      this.dDc = dc;
      this.dBuf[this.dWrite] = Math.tanh(x + dc * this.dFb);
      this.dWrite = (this.dWrite + 1) % dLen;
      const m = this.dMix;
      x = x * Math.cos(m * Math.PI * 0.5) + wet * Math.sin(m * Math.PI * 0.5);
      if (tap === 'T4') this.pushTap(x);

      // ---- OUCH: BITE waveshaper then CHOKE filter -----------------------
      this.bite = biteT + (this.bite - biteT) * sc;
      this.choke = chokeT + (this.choke - chokeT) * sc;
      if (this.bite > 1e-4) {
        const b = this.bite;
        const g = 1 + 24 * b * b;
        const bias = 0.25 * b;
        const diode = Math.tanh(g * x + bias) - Math.tanh(bias); // asymmetric clip
        const fold = Math.sin(g * x * 1.3) * 0.8; // folding grit at high BITE
        const shaped = diode * (1 - b * 0.5) + fold * b * 0.5;
        const wetAmt = Math.min(1, b * 4);
        x = x + (shaped / Math.sqrt(g) * 1.6 - x) * wetAmt;
      }
      if (this.choke < 0.995) {
        // State-variable low-pass, 40 Hz .. 18 kHz, fixed moderate resonance
        const fc = 40 * Math.pow(2, this.choke * 8.8);
        const fq = 2 * Math.sin(Math.PI * Math.min(fc, sr / 6) / sr);
        const q = 0.7;
        const high = x - this.svfLow - q * this.svfBand;
        this.svfBand += fq * high;
        this.svfLow += fq * this.svfBand;
        const lp = this.svfLow;
        const bypass = Math.max(0, (this.choke - 0.95) / 0.045);
        x = lp + (x - lp) * bypass;
      } else {
        this.svfLow = x;
        this.svfBand = 0;
      }

      // ---- master --------------------------------------------------------
      this.master = masterT + (this.master - masterT) * sc;
      let y = x * this.master;
      const dcy = y - this.dcIn + 0.9995 * this.dcOut;
      this.dcIn = y;
      this.dcOut = dcy;
      y = dcy > 1 ? 1 : dcy < -1 ? -1 : dcy;
      if (tap === 'T6') this.pushTap(y);
      out[n] = y;
    }
    this.framesRendered += frames;
  }

  private pushTap(s: number) {
    this.tapRing[this.tapWrite] = s;
    this.tapWrite = (this.tapWrite + 1) & (this.tapRing.length - 1);
  }

  /** Current envelope level of each voice (0..1); drives the LEDs between the touch plates. */
  envLevels(dst: Float32Array) {
    for (let i = 0; i < NUM_VOICES; i++) dst[i] = this.voices[i].env;
  }

  /** Current oscillator frequency of each voice in Hz (exact, for the scope's T1 readout). */
  voiceHz(dst: Float32Array) {
    for (let i = 0; i < NUM_VOICES; i++) dst[i] = A0 * Math.pow(2, this.voices[i].pitch);
  }

  /** Total samples rendered so far (lets the scope lock its display to a pitch). */
  framesRendered = 0;

  /** Copy the most recent `dst.length` tap samples into `dst`, oldest first. */
  readTap(dst: Float32Array) {
    const n = this.tapRing.length;
    const len = Math.min(dst.length, n);
    const start = this.tapWrite - len;
    for (let i = 0; i < len; i++) dst[i] = this.tapRing[(start + i + n) & (n - 1)];
  }
}

export const PARAM_COUNT = PARAMS.length;
