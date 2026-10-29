// Parameter table shared by the UI thread and the audio worklet.
// Every value is a number; knobs are normalised 0..1, states are small integers.

export type ParamKind = 'knob' | 'state';

export interface ParamDef {
  id: string;
  label: string;
  kind: ParamKind;
  def: number;
  /** Milestone in which the parameter starts doing something (UI dims it before then). */
  milestone: number;
  /** For states: number of discrete values. */
  steps?: number;
}

export const NUM_VOICES = 4;

/** The milestone this build implements. Anything tagged later is drawn but dimmed. */
export const BUILD_MILESTONE = 2;

/** MODP programs in hardware order (manual v2.4). `milestone` = when the DSP exists here. */
export const MODP_PROGRAMS = [
  { name: 'DETUNE', color: '#ff3b3b', milestone: 1 },
  { name: 'SUBOSC', color: '#3bd16f', milestone: 1 },
  { name: 'CHORD', color: '#7fffd4', milestone: 3 },
  { name: 'DUAL', color: '#b6ff3b', milestone: 3 },
  { name: 'HARDSYNC', color: '#ff9a2e', milestone: 3 },
  { name: 'SHAPER', color: '#b05cff', milestone: 3 },
  { name: 'SATURATOR', color: '#3b7bff', milestone: 3 },
  { name: 'BITMANGLER', color: '#3be6ff', milestone: 3 },
  { name: 'SRR', color: '#ffe53b', milestone: 3 },
  { name: 'NOISE', color: '#f2f2f2', milestone: 3 },
  { name: 'DJ', color: '#ff6fd8', milestone: 3 },
] as const;

export const SAT_NAMES = ['none', 'soft', 'hard', 'dirty'] as const;

export const AVAILABLE_MODP = MODP_PROGRAMS.map((p, i) => ({ ...p, index: i })).filter((p) => p.milestone <= BUILD_MILESTONE);

const voiceParams = (v: number): ParamDef[] => [
  { id: `v${v}.tune`, label: `Voice ${v} TUNE`, kind: 'knob', def: [0.28, 0.42, 0.5, 0.57][v - 1], milestone: 1 },
  { id: `v${v}.mod`, label: `Voice ${v} MOD`, kind: 'knob', def: 0.15, milestone: 1 },
  { id: `v${v}.wave`, label: `Voice ${v} WAVE`, kind: 'knob', def: 0.4, milestone: 1 },
  { id: `v${v}.env`, label: `Voice ${v} ENV`, kind: 'knob', def: 0.35, milestone: 1 },
  { id: `v${v}.page`, label: `Voice ${v} wavetable page`, kind: 'state', def: 0, steps: 4, milestone: 1 },
  { id: `v${v}.drone`, label: `Voice ${v} drone`, kind: 'state', def: 0, steps: 2, milestone: 1 },
  { id: `v${v}.gate`, label: `Voice ${v} touch`, kind: 'state', def: 0, milestone: 1 },
  { id: `v${v}.modp`, label: `Voice ${v} MODP program`, kind: 'state', def: 0, steps: MODP_PROGRAMS.length, milestone: 1 },
  { id: `v${v}.oct`, label: `Voice ${v} high octave`, kind: 'state', def: 0, steps: 2, milestone: 2 },
  { id: `v${v}.chrm`, label: `Voice ${v} chromatic`, kind: 'state', def: 0, steps: 2, milestone: 2 },
  { id: `v${v}.mute`, label: `Voice ${v} mute`, kind: 'state', def: 0, steps: 2, milestone: 2 },
  /** Pitch set by the keyboard drawer, in octaves above A0; -1 = follow the TUNE knob. */
  { id: `v${v}.note`, label: `Voice ${v} drawer note`, kind: 'state', def: -1, milestone: 2 },
];

export const PARAMS: ParamDef[] = [
  { id: 'master', label: 'Master volume', kind: 'knob', def: 0.7, milestone: 1 },
  ...[1, 2, 3, 4].flatMap(voiceParams),
  { id: 'filter.cutoff', label: 'CUTOFF', kind: 'knob', def: 1, milestone: 4 },
  { id: 'filter.reso', label: 'RESO', kind: 'knob', def: 0, milestone: 4 },
  { id: 'delay.time', label: 'Delay TIME', kind: 'knob', def: 0.45, milestone: 1 },
  { id: 'delay.fdbk', label: 'Delay FDBK', kind: 'knob', def: 0.35, milestone: 1 },
  { id: 'delay.mix', label: 'Delay MIX', kind: 'knob', def: 0.3, milestone: 1 },
  /** Delay feedback colour (codes 321-324): very dark, dark, default, bright. */
  { id: 'delay.color', label: 'Delay colour', kind: 'state', def: 2, steps: 4, milestone: 2 },
  { id: 'ouch.bite', label: 'BITE', kind: 'knob', def: 0, milestone: 1 },
  { id: 'ouch.choke', label: 'CHOKE', kind: 'knob', def: 1, milestone: 1 },
  { id: 'lfo1.freq', label: 'LFO1 FREQ', kind: 'knob', def: 0.3, milestone: 3 },
  { id: 'lfo2.freq', label: 'LFO2 FREQ', kind: 'knob', def: 0.3, milestone: 3 },
  { id: 'lfo2.wav', label: 'LFO2 WAV', kind: 'knob', def: 0, milestone: 3 },
  { id: 'att.out1', label: 'ATT OUT1', kind: 'knob', def: 0.5, milestone: 3 },
  { id: 'att.out2', label: 'ATT OUT2', kind: 'knob', def: 0.5, milestone: 3 },
  { id: 'add.in1', label: 'ADD IN1', kind: 'knob', def: 0.5, milestone: 3 },
  { id: 'add.in2', label: 'ADD IN2', kind: 'knob', def: 0.5, milestone: 3 },
  /** CHRM tuning: index into EDOS (0 = 12-EDO) and SCALES. */
  { id: 'chrm.edo', label: 'CHRM EDO', kind: 'state', def: 0, steps: 5, milestone: 2 },
  { id: 'chrm.scale', label: 'CHRM scale', kind: 'state', def: 0, steps: 5, milestone: 2 },
  /** Tune follow (codes 2221-2224): 0 off, 1 = 1→2, 2 = 1→2&3, 3 = 1→2&3&4. */
  { id: 'tune.follow', label: 'Tune follow', kind: 'state', def: 0, steps: 4, milestone: 2 },
  /** Mix saturation (codes 121-124): 0 none, 1 soft (default), 2 hard, 3 dirty. */
  { id: 'mix.sat', label: 'Mix saturation', kind: 'state', def: 1, steps: 4, milestone: 2 },
  /** Which voice tap T1 listens to (0..3). */
  { id: 'tap.voice', label: 'T1 voice', kind: 'state', def: 0, steps: 4, milestone: 1 },
];

export const PARAM_INDEX: Record<string, number> = Object.fromEntries(PARAMS.map((p, i) => [p.id, i]));

export const paramDef = (id: string): ParamDef => {
  const i = PARAM_INDEX[id];
  if (i === undefined) throw new Error(`Unknown param ${id}`);
  return PARAMS[i];
};

export const defaultValues = (): Float32Array => Float32Array.from(PARAMS.map((p) => p.def));

/** Scope tap points available in this build. */
export const TAPS = [
  { id: 'T1', label: 'T1 · voice output', view: 'triggered' },
  { id: 'T4', label: 'T4 · after delay', view: 'triggered' },
  { id: 'T6', label: 'T6 · master out', view: 'triggered' },
] as const;
export type TapId = (typeof TAPS)[number]['id'];

// Messages between the UI thread and the worklet.
export type ToWorklet =
  | { t: 'param'; i: number; v: number }
  | { t: 'tap'; id: TapId | null; len: number }
  | { t: 'rec'; on: boolean };

export type FromWorklet =
  | { t: 'scope'; id: TapId; data: Float32Array; end: number }
  | { t: 'rec'; data: Float32Array }
  | { t: 'recdone' }
  | { t: 'env'; levels: Float32Array; hz: Float32Array }
  | { t: 'stats'; load: number; memBytes: number; perModule: Record<string, number> };
