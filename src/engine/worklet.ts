// AudioWorklet wrapper around ElmyraCore. Bundled by Vite as a separate file.

import { ElmyraCore } from './core';
import type { FromWorklet, ToWorklet } from './params';

declare const sampleRate: number;
declare function registerProcessor(name: string, ctor: unknown): void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}

const SCOPE_EVERY_BLOCKS = 8; // ~21 ms at 48 kHz
const REC_CHUNK = 16384;

const now: () => number =
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? () => performance.now()
    : () => Date.now();

class ElmyraProcessor extends AudioWorkletProcessor {
  private core = new ElmyraCore(sampleRate);
  private mono = new Float32Array(128);
  private blocks = 0;
  private tapLen = 4096;
  private recording = false;
  private rec = new Float32Array(REC_CHUNK);
  private recPos = 0;
  // load measurement
  private busyMs = 0;
  private statFrames = 0;

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent<ToWorklet>) => this.onMessage(e.data);
  }

  private post(msg: FromWorklet, transfer: Transferable[] = []) {
    this.port.postMessage(msg, transfer);
  }

  private onMessage(m: ToWorklet) {
    if (m.t === 'param') this.core.setParam(m.i, m.v);
    else if (m.t === 'tap') {
      this.core.activeTap = m.id;
      this.tapLen = Math.max(256, Math.min(this.core.tapRing.length, m.len | 0));
    }
    else if (m.t === 'rec') {
      if (m.on) {
        this.recPos = 0;
        this.recording = true;
      } else if (this.recording) {
        this.recording = false;
        this.flushRec();
        this.post({ t: 'recdone' });
      }
    }
  }

  private flushRec() {
    if (this.recPos === 0) return;
    const chunk = this.rec.slice(0, this.recPos);
    this.post({ t: 'rec', data: chunk }, [chunk.buffer]);
    this.recPos = 0;
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]) {
    const out = outputs[0];
    const frames = out[0]?.length ?? 128;
    if (this.mono.length !== frames) this.mono = new Float32Array(frames);
    const t0 = now();
    this.core.process(this.mono, frames);
    for (const ch of out) ch.set(this.mono);

    if (this.recording) {
      for (let i = 0; i < frames; i++) {
        this.rec[this.recPos++] = this.mono[i];
        if (this.recPos === REC_CHUNK) {
          const chunk = this.rec;
          this.post({ t: 'rec', data: chunk }, [chunk.buffer]);
          this.rec = new Float32Array(REC_CHUNK);
          this.recPos = 0;
        }
      }
    }

    this.blocks++;
    const tap = this.core.activeTap;
    if (tap && this.blocks % SCOPE_EVERY_BLOCKS === 0) {
      const data = new Float32Array(this.tapLen);
      this.core.readTap(data);
      this.post({ t: 'scope', id: tap, data }, [data.buffer]);
    }

    this.busyMs += now() - t0;
    this.statFrames += frames;
    if (this.statFrames >= sampleRate / 2) {
      const budgetMs = (this.statFrames / sampleRate) * 1000;
      this.post({
        t: 'stats',
        load: this.busyMs / budgetMs,
        memBytes: this.core.stats().memBytes + this.rec.byteLength,
        perModule: {},
      });
      this.busyMs = 0;
      this.statFrames = 0;
    }
    return true;
  }
}

registerProcessor('elmyra', ElmyraProcessor);
