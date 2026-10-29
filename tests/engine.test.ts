import { describe, expect, it } from 'vitest';
import { ElmyraCore } from '../src/engine/core';
import { buildBank, levelFor, MAX_HARMONICS, NUM_LEVELS, TABLE_SIZE } from '../src/engine/wavetables';
import { encodeWav } from '../src/audio/wav';

const SR = 48000;

function render(core: ElmyraCore, seconds: number) {
  const out = new Float32Array(Math.round(seconds * SR));
  for (let i = 0; i < out.length; i += 128) core.process(out.subarray(i, i + 128), Math.min(128, out.length - i));
  return out;
}

const rms = (a: Float32Array) => Math.sqrt(a.reduce((s, x) => s + x * x, 0) / a.length);
const maxStep = (a: Float32Array) => {
  let m = 0;
  for (let i = 1; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - a[i - 1]));
  return m;
};

describe('wavetables', () => {
  it('builds finite tables normalised to peak 1', () => {
    const bank = buildBank();
    let bad = 0;
    for (let t = 0; t < bank.data.length / TABLE_SIZE; t++) {
      let peak = 0;
      for (let k = 0; k < TABLE_SIZE; k++) {
        const s = bank.data[t * TABLE_SIZE + k];
        if (!Number.isFinite(s)) bad++;
        peak = Math.max(peak, Math.abs(s));
      }
      expect(peak).toBeCloseTo(1, 4);
    }
    expect(bad).toBe(0);
  });

  it('picks a mip level that keeps harmonics under Nyquist', () => {
    for (const f of [27.5, 110, 440, 1760, 3520, 8000]) {
      const l = levelFor(f, SR);
      expect(l).toBeLessThan(NUM_LEVELS);
      const harmonics = MAX_HARMONICS >> l;
      expect(harmonics * f).toBeLessThanOrEqual(SR / 2 + 1e-6);
    }
  });
});

describe('core', () => {
  it('is silent with no touch', () => {
    const core = new ElmyraCore(SR);
    const out = render(core, 0.5);
    expect(rms(out)).toBeLessThan(1e-4);
  });

  it('plays a clean drone: finite, bounded, audible, no clicks', () => {
    const core = new ElmyraCore(SR);
    core.setParamById('v1.wave', 0); // sine
    core.setParamById('v1.mod', 0);
    core.setParamById('v1.gate', 1);
    const out = render(core, 3);
    expect(out.every(Number.isFinite)).toBe(true);
    expect(out.every((x) => Math.abs(x) <= 1)).toBe(true);
    expect(rms(out.subarray(SR))).toBeGreaterThan(0.01);
    expect(maxStep(out)).toBeLessThan(0.05);
  });

  it('drone mode holds the envelope open without touch', () => {
    const core = new ElmyraCore(SR);
    core.setParamById('v2.drone', 1);
    const out = render(core, 1);
    expect(rms(out.subarray(SR / 2))).toBeGreaterThan(0.01);
  });

  it('releases to silence after the pad is let go', () => {
    const core = new ElmyraCore(SR);
    core.setParamById('v1.env', 0.1);
    core.setParamById('delay.mix', 0);
    core.setParamById('v1.gate', 1);
    render(core, 0.5);
    core.setParamById('v1.gate', 0);
    render(core, 1);
    expect(rms(render(core, 0.2))).toBeLessThan(1e-3);
  });

  it('stays bounded with feedback at maximum, BITE high and TIME moving', () => {
    const core = new ElmyraCore(SR);
    core.setParamById('v1.gate', 1);
    core.setParamById('v1.wave', 0.9);
    core.setParamById('delay.fdbk', 1);
    core.setParamById('delay.mix', 0.8);
    core.setParamById('ouch.bite', 1);
    core.setParamById('ouch.choke', 0.4);
    for (let i = 0; i < 10; i++) {
      core.setParamById('delay.time', i % 2 ? 0.1 : 0.9);
      const out = render(core, 0.3);
      expect(out.every((x) => Number.isFinite(x) && Math.abs(x) <= 1)).toBe(true);
    }
  });

  it('SUBOSC adds energy an octave below', () => {
    const core = new ElmyraCore(SR);
    core.setParamById('v1.wave', 0);
    core.setParamById('v1.tune', 0.5);
    core.setParamById('v1.modp', 1);
    core.setParamById('v1.mod', 0.5);
    core.setParamById('delay.mix', 0);
    core.setParamById('v1.gate', 1);
    const out = render(core, 1).subarray(SR / 2);
    const f = ElmyraCore.tuneToHz(0.5) / 2;
    // Goertzel at f
    const w = (2 * Math.PI * f) / SR;
    let s1 = 0;
    let s2 = 0;
    for (const x of out) {
      const s = x + 2 * Math.cos(w) * s1 - s2;
      s2 = s1;
      s1 = s;
    }
    const power = s1 * s1 + s2 * s2 - 2 * Math.cos(w) * s1 * s2;
    expect(Math.sqrt(power) / out.length).toBeGreaterThan(0.005);
  });

  it('feeds the selected scope tap', () => {
    const core = new ElmyraCore(SR);
    core.activeTap = 'T1';
    core.setParamById('v1.gate', 1);
    render(core, 0.2);
    const buf = new Float32Array(core.tapRing.length);
    core.readTap(buf);
    expect(rms(buf)).toBeGreaterThan(0.01);
  });
});

describe('wav', () => {
  it('writes a valid 24-bit mono header and data', async () => {
    const blob = encodeWav([new Float32Array([0, 1, -1, 0.5])], SR);
    const v = new DataView(await blob.arrayBuffer());
    expect(v.byteLength).toBe(44 + 12);
    expect(v.getUint16(22, true)).toBe(1);
    expect(v.getUint32(24, true)).toBe(SR);
    expect(v.getUint16(34, true)).toBe(24);
    // sample 1 = +1 → 0x7fffff
    expect(v.getUint8(47) | (v.getUint8(48) << 8) | (v.getUint8(49) << 16)).toBe(0x7fffff);
  });
});
