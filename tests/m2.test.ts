import { describe, expect, it } from 'vitest';
import { ElmyraCore } from '../src/engine/core';
import { A0, describePitch, noteToOctaves, quantiseTune, octavesToHz } from '../src/engine/tuning';
import { yin } from '../src/dsp/pitch';

const SR = 48000;
const render = (core: ElmyraCore, seconds: number) => {
  const out = new Float32Array(Math.round(seconds * SR));
  for (let i = 0; i < out.length; i += 128) core.process(out.subarray(i, i + 128), Math.min(128, out.length - i));
  return out;
};
const cents = (a: number, b: number) => 1200 * Math.log2(a / b);
const rms = (a: Float32Array) => Math.sqrt(a.reduce((s, x) => s + x * x, 0) / a.length);

function cleanCore() {
  const core = new ElmyraCore(SR);
  core.setParamById('delay.mix', 0);
  for (let v = 1; v <= 4; v++) {
    core.setParamById(`v${v}.wave`, 0);
    core.setParamById(`v${v}.mod`, 0);
  }
  return core;
}

describe('tuning', () => {
  it('quantises TUNE to 12-EDO semitones from A0', () => {
    const t = { edo: 12, scale: 0 };
    expect(quantiseTune(0, t)).toBe(0);
    expect(quantiseTune(12 / 84, t)).toBeCloseTo(1); // one octave up = A1
    expect(octavesToHz(quantiseTune(48 / 84, t))).toBeCloseTo(440, 6); // A4
  });

  it('keeps knob travel per step constant across EDOs', () => {
    expect(quantiseTune(17 / 84, { edo: 17, scale: 0 })).toBeCloseTo(1); // 17 steps = 1 octave
    expect(quantiseTune(7 / 84, { edo: 7, scale: 0 })).toBeCloseTo(1);
  });

  it('snaps to scale notes', () => {
    const major = { edo: 12, scale: 1 };
    // A + 1 semitone (A#) is not in A major: snaps to A or B
    const o = quantiseTune(1 / 84, major) * 12;
    expect([0, 2]).toContain(Math.round(o));
  });

  it('names notes and cents', () => {
    expect(describePitch(Math.log2(440 / A0), 12).name).toBe('A4');
    expect(describePitch(Math.log2(261.6256 / A0), 12).name).toBe('C4');
    expect(Math.abs(describePitch(Math.log2(441 / A0), 12).cents - 3.93)).toBeLessThan(0.05);
  });
});

describe('YIN pitch detector', () => {
  it('measures a sine to well under 1 cent', () => {
    for (const f of [55, 110.3, 233.08, 440, 987.77]) {
      const buf = Float32Array.from({ length: 8192 }, (_, i) => Math.sin((2 * Math.PI * f * i) / SR));
      const r = yin(buf, SR)!;
      expect(Math.abs(cents(r.hz, f))).toBeLessThan(0.2);
      expect(r.confidence).toBeGreaterThan(0.9);
    }
  });
});

describe('milestone 2 acceptance: 4-voice chord in 17-EDO within 1 cent', () => {
  const t = { edo: 17, scale: 0 };
  const chord = [0, 5, 10, 14].map((s) => 2 * 17 + s); // drawer note indices
  it('each voice sounds its 17-EDO note to within 1 cent', () => {
    for (let i = 0; i < 4; i++) {
      const core = cleanCore();
      core.setParamById('chrm.edo', 4);
      chord.forEach((n, v) => core.setParamById(`v${v + 1}.note`, noteToOctaves(n, t)));
      core.setParamById(`v${i + 1}.gate`, 1); // solo this voice
      const out = render(core, 0.8);
      const r = yin(out.subarray(out.length - 8192), SR)!;
      const expected = octavesToHz(noteToOctaves(chord[i], t));
      expect(Math.abs(cents(r.hz, expected))).toBeLessThan(1);
    }
  });

  it('all four together are reported exactly by the engine', () => {
    const core = cleanCore();
    chord.forEach((n, v) => {
      core.setParamById(`v${v + 1}.note`, noteToOctaves(n, t));
      core.setParamById(`v${v + 1}.gate`, 1);
    });
    render(core, 0.3);
    const hz = new Float32Array(4);
    core.voiceHz(hz);
    chord.forEach((n, v) => expect(Math.abs(cents(hz[v], octavesToHz(noteToOctaves(n, t))))).toBeLessThan(0.01));
  });
});

describe('codes', () => {
  it('CHRM quantises the knob', () => {
    const core = cleanCore();
    core.setParamById('v1.chrm', 1);
    core.setParamById('v1.tune', 0.5 + 0.3 / 84); // a bit off a semitone
    core.setParamById('v1.gate', 1);
    render(core, 0.2);
    const hz = new Float32Array(4);
    core.voiceHz(hz);
    expect(Math.abs(cents(hz[0], octavesToHz(42 / 12)))).toBeLessThan(0.01);
  });

  it('octave code raises a voice by one octave', () => {
    const a = cleanCore();
    const b = cleanCore();
    b.setParamById('v1.oct', 1);
    render(a, 0.6);
    render(b, 0.6);
    const ha = new Float32Array(4);
    const hb = new Float32Array(4);
    a.voiceHz(ha);
    b.voiceHz(hb);
    expect(Math.abs(cents(hb[0], ha[0] * 2))).toBeLessThan(0.1);
  });

  it('tune follow stacks voices on voice 1', () => {
    const core = cleanCore();
    core.setParamById('tune.follow', 3);
    render(core, 0.6);
    const hz = new Float32Array(4);
    core.voiceHz(hz);
    expect(Math.abs(cents(hz[1], hz[0]))).toBeLessThan(0.1);
    expect(Math.abs(cents(hz[3], hz[0]))).toBeLessThan(0.1);
  });

  it('mute silences a voice', () => {
    const core = cleanCore();
    core.setParamById('v1.drone', 1);
    core.setParamById('v1.mute', 1);
    expect(rms(render(core, 0.3))).toBeLessThan(1e-4);
  });

  it('saturation modes stay bounded and "none" is quietest', () => {
    const levels = [0, 1, 2, 3].map((sat) => {
      const core = cleanCore();
      core.setParamById('mix.sat', sat);
      for (let v = 1; v <= 4; v++) core.setParamById(`v${v}.drone`, 1);
      const out = render(core, 0.5);
      expect(out.every((x) => Number.isFinite(x) && Math.abs(x) <= 1)).toBe(true);
      return rms(out.subarray(SR / 4));
    });
    expect(levels[0]).toBeLessThan(levels[1]);
  });
});
