// Main-thread side: owns the AudioContext, the parameter store and the message traffic.

import workletUrl from './worklet.ts?worker&url';
import { PARAMS, PARAM_INDEX, defaultValues, type FromWorklet, type TapId, type ToWorklet } from './params';
import { encodeWav } from '../audio/wav';

type Listener = () => void;

export interface Stats {
  load: number;
  memBytes: number;
  recBytes: number;
  underruns: number | null;
}

class Store {
  values = defaultValues();
  private listeners = new Map<string, Set<Listener>>();
  private any = new Set<Listener>();

  get(id: string) {
    return this.values[PARAM_INDEX[id]];
  }
  set(id: string, v: number) {
    const i = PARAM_INDEX[id];
    if (i === undefined) return;
    const def = PARAMS[i];
    const clamped = def.kind === 'knob' ? Math.min(1, Math.max(0, v)) : v;
    if (this.values[i] === clamped) return;
    this.values[i] = clamped;
    this.listeners.get(id)?.forEach((l) => l());
    this.any.forEach((l) => l());
  }
  subscribe(id: string, l: Listener) {
    let s = this.listeners.get(id);
    if (!s) this.listeners.set(id, (s = new Set()));
    s.add(l);
    return () => s!.delete(l);
  }
  subscribeAll(l: Listener) {
    this.any.add(l);
    return () => this.any.delete(l);
  }
}

class Emitter<T> {
  private ls = new Set<(v: T) => void>();
  on(l: (v: T) => void) {
    this.ls.add(l);
    return () => {
      this.ls.delete(l);
    };
  }
  emit(v: T) {
    this.ls.forEach((l) => l(v));
  }
}

export class EngineClient {
  readonly store = new Store();
  readonly scope = new Emitter<{ id: TapId; data: Float32Array }>();
  readonly statsEvent = new Emitter<Stats>();
  readonly recEvent = new Emitter<{ recording: boolean; seconds: number }>();
  /** Latest per-voice envelope levels from the audio thread (read each animation frame). */
  readonly envLevels = new Float32Array(4);
  ctx: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private recChunks: Float32Array[] = [];
  private recResolve: ((b: Blob) => void) | null = null;
  recording = false;
  private stats: Stats = { load: 0, memBytes: 0, recBytes: 0, underruns: null };

  constructor() {
    for (const p of PARAMS) this.store.subscribe(p.id, () => this.send({ t: 'param', i: PARAM_INDEX[p.id], v: this.store.get(p.id) }));
  }

  get started() {
    return this.ctx?.state === 'running';
  }
  get sampleRate() {
    return this.ctx?.sampleRate ?? 48000;
  }

  /** Must be called from a user gesture (iOS requirement). */
  async start() {
    if (!this.ctx) {
      const ctx = new AudioContext({ latencyHint: 'interactive' });
      this.ctx = ctx;
      await ctx.audioWorklet.addModule(workletUrl);
      const node = new AudioWorkletNode(ctx, 'elmyra', { numberOfInputs: 0, outputChannelCount: [2] });
      node.port.onmessage = (e: MessageEvent<FromWorklet>) => this.onMessage(e.data);
      node.connect(ctx.destination);
      this.node = node;
      // Push every current value (the worklet starts from defaults).
      PARAMS.forEach((_, i) => this.send({ t: 'param', i, v: this.store.values[i] }));
      ctx.addEventListener('statechange', () => this.statsEvent.emit(this.stats));
    }
    if (this.ctx.state !== 'running') await this.ctx.resume();
  }

  private send(m: ToWorklet) {
    this.node?.port.postMessage(m);
  }

  /** Attach the scope to a tap; `len` = samples to send per frame. */
  setTap(id: TapId | null, len = 4096) {
    this.send({ t: 'tap', id, len });
  }

  private onMessage(m: FromWorklet) {
    switch (m.t) {
      case 'scope':
        this.scope.emit(m);
        break;
      case 'rec':
        this.recChunks.push(m.data);
        this.stats.recBytes += m.data.byteLength;
        this.recEvent.emit({ recording: this.recording, seconds: this.recSeconds() });
        break;
      case 'env':
        this.envLevels.set(m.levels);
        break;
      case 'recdone': {
        const blob = encodeWav(this.recChunks, this.sampleRate);
        this.recChunks = [];
        this.stats.recBytes = 0;
        this.recResolve?.(blob);
        this.recResolve = null;
        break;
      }
      case 'stats': {
        const ps = (this.ctx as AudioContext & { playbackStats?: { underrunEvents?: number } })?.playbackStats;
        this.stats = {
          load: m.load,
          memBytes: m.memBytes,
          recBytes: this.stats.recBytes,
          underruns: typeof ps?.underrunEvents === 'number' ? ps.underrunEvents : null,
        };
        this.statsEvent.emit(this.stats);
        break;
      }
    }
  }

  private recSeconds() {
    return this.recChunks.reduce((n, c) => n + c.length, 0) / this.sampleRate;
  }

  startRecording() {
    if (this.recording || !this.node) return;
    this.recChunks = [];
    this.recording = true;
    this.send({ t: 'rec', on: true });
    this.recEvent.emit({ recording: true, seconds: 0 });
  }

  stopRecording(): Promise<Blob> | null {
    if (!this.recording) return null;
    this.recording = false;
    const p = new Promise<Blob>((r) => (this.recResolve = r));
    this.send({ t: 'rec', on: false });
    this.recEvent.emit({ recording: false, seconds: this.recSeconds() });
    return p;
  }

  getStats() {
    return this.stats;
  }
}

export const engine = new EngineClient();
