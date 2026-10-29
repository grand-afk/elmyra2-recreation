// Offline render of a demo patch through the same DSP core the browser uses.
// Usage: npm run render  → out/demo.wav, and prints real-time factor.
import { mkdirSync, writeFileSync } from 'node:fs';
import { ElmyraCore } from '../src/engine/core';
import { encodeWav } from '../src/audio/wav';

const SR = 48000;
const seconds = 20;
const core = new ElmyraCore(SR);

// Four-voice drone: two voices held in drone mode, two touched and released.
core.setParamById('v1.drone', 1);
core.setParamById('v1.wave', 0.55);
core.setParamById('v1.mod', 0.5);
core.setParamById('v2.drone', 1);
core.setParamById('v2.page', 2);
core.setParamById('v2.modp', 1);
core.setParamById('v2.mod', 0.7);
core.setParamById('delay.time', 0.55);
core.setParamById('delay.fdbk', 0.45);
core.setParamById('delay.mix', 0.35);

const out = new Float32Array(SR * seconds);
const t0 = performance.now();
for (let i = 0; i < out.length; i += 128) {
  const t = i / SR;
  core.setParamById('v3.gate', t > 4 && t < 9 ? 1 : 0);
  core.setParamById('v4.gate', t > 7 && t < 14 ? 0.8 : 0);
  core.setParamById('ouch.bite', t > 12 ? Math.min(1, (t - 12) / 6) : 0);
  core.setParamById('ouch.choke', t > 12 ? 1 - Math.min(0.6, (t - 12) / 10) : 1);
  core.process(out.subarray(i, i + 128), 128);
}
const ms = performance.now() - t0;
mkdirSync('out', { recursive: true });
const wav = encodeWav([out], SR);
writeFileSync('out/demo.wav', Buffer.from(await wav.arrayBuffer()));
console.log(`Rendered ${seconds}s in ${ms.toFixed(0)} ms → ${((seconds * 1000) / ms).toFixed(1)}x real time`);
console.log(`DSP load at real time ≈ ${((ms / (seconds * 1000)) * 100).toFixed(1)}%`);
