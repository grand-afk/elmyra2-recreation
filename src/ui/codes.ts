// Numeric codes, entered as on the hardware: hold MODP (or CHRM), tap PG buttons 1-4 as digits,
// release. A recognised code flashes the REC and PLAY LEDs. Codes for later milestones are
// recognised and listed, but only report when they will arrive.
import { engine } from '../engine/client';
import { BUILD_MILESTONE, NUM_VOICES, SAT_NAMES } from '../engine/params';
import { EDOS, SCALES } from '../engine/tuning';
import { ui } from './uiState';

export type Bank = 'MODP' | 'CHRM';

export interface CodeDef {
  bank: Bank;
  code: string;
  group: string;
  label: string;
  milestone: number;
  apply?: () => void;
  /** True when this code's setting is currently in force (for the palette). */
  active?: () => boolean;
  /** True for the factory default setting. */
  isDefault?: boolean;
}

const set = (id: string, v: number) => engine.store.set(id, v);
const get = (id: string) => engine.store.get(id);
const voices = Array.from({ length: NUM_VOICES }, (_, i) => i + 1);

const later = (bank: Bank, codes: string[], group: string, label: (c: string) => string, milestone: number): CodeDef[] =>
  codes.map((code) => ({ bank, code, group, label: label(code), milestone }));

export const CODES: CodeDef[] = [
  // ---- CHRM bank (implemented) --------------------------------------------
  ...SCALES.slice(1).map((s, i): CodeDef => ({
    bank: 'CHRM',
    code: `1${i + 1}`,
    group: 'Scale',
    label: `${s.name} (12-EDO, from A0)`,
    milestone: 2,
    apply: () => {
      set('chrm.edo', 0);
      set('chrm.scale', i + 1);
    },
    active: () => get('chrm.edo') === 0 && get('chrm.scale') === i + 1,
  })),
  ...[
    ['1111', 0],
    ['111', 1],
    ['112', 2],
    ['113', 3],
    ['114', 4],
  ].map(([code, e]): CodeDef => ({
    bank: 'CHRM',
    code: code as string,
    group: 'Tuning',
    label: `${EDOS[e as number]}-EDO${e === 0 ? ' chromatic' : ''}`,
    milestone: 2,
    isDefault: e === 0,
    apply: () => {
      set('chrm.edo', e as number);
      set('chrm.scale', 0);
    },
    active: () => get('chrm.edo') === e && get('chrm.scale') === 0,
  })),
  ...['off', '1 → 2', '1 → 2 & 3', '1 → 2 & 3 & 4'].map((l, i): CodeDef => ({
    bank: 'CHRM',
    code: `222${i + 1}`,
    group: 'Tune follow',
    label: l,
    milestone: 2,
    isDefault: i === 0,
    apply: () => set('tune.follow', i),
    active: () => get('tune.follow') === i,
  })),

  // ---- MODP bank (implemented) --------------------------------------------
  ...voices.map((v): CodeDef => ({
    bank: 'MODP',
    code: `${v}${v}`,
    group: 'Octave',
    label: `Voice ${v}: toggle low / high start octave`,
    milestone: 2,
    apply: () => set(`v${v}.oct`, get(`v${v}.oct`) > 0.5 ? 0 : 1),
    active: () => get(`v${v}.oct`) > 0.5,
  })),
  ...SAT_NAMES.map((n, i): CodeDef => ({
    bank: 'MODP',
    code: `12${i + 1}`,
    group: 'Mix saturation',
    label: n,
    milestone: 2,
    isDefault: i === 1,
    apply: () => set('mix.sat', i),
    active: () => get('mix.sat') === i,
  })),
  ...['very dark', 'dark', 'default', 'bright'].map((n, i): CodeDef => ({
    bank: 'MODP',
    code: `32${i + 1}`,
    group: 'Delay colour',
    label: n,
    milestone: 2,
    isDefault: i === 2,
    apply: () => set('delay.color', i),
    active: () => get('delay.color') === i,
  })),

  // ---- MODP bank (later milestones) ---------------------------------------
  ...later('MODP', ['331', '332', '333', '341', '342', '343', '3311', '3312', '3313', '3314', '3321', '3322'], 'Main filter', (c) => `filter type ${c}`, 4),
  ...later('MODP', ['133', '134'], 'Routing', (c) => (c === '133' ? 'filter → delay (default)' : 'delay → filter'), 4),
  ...later('MODP', ['441', '442', '4411'], 'Reverb', (c) => ({ '441': 'delay (default)', '442': 'reverb replaces delay', '4411': 'lo-fi reverb after delay' })[c]!, 4),
  ...later('MODP', ['131', '132'], 'Delay sync', (c) => (c === '131' ? 'free (default)' : 'synced to clock'), 3),
  ...later('MODP', ['2441', '2442', '2443', '2444'], 'LFO sync', (c) => `LFO sync ${c}`, 3),
  ...later('MODP', ['241', '242', '243', '244', '2411', '2412', '2413', '2414'], 'LFO', (c) => `LFO option ${c}`, 3),
  ...later('MODP', ['2431', '2432', '2433', '2434'], 'Sequencer to LFO1', (c) => `voice ${c.at(-1)} sequencer → LFO1`, 3),
  ...later('MODP', ['221', '222', '223', '224'], 'Portamento', (c) => `portamento ${c}`, 3),
  ...later('MODP', ['2211', '2212', '2213', '2214', '2314'], 'Short envelopes', (c) => (c === '2314' ? 'off for all' : `voice ${c.at(-1)}`), 3),
  ...later('MODP', ['411', '412'], 'Voice volume', (c) => `volume control ${c}`, 3),
  ...later('MODP', ['421', '422', '423', '424'], 'MODP chaining', (c) => `chaining ${c}`, 3),
  ...later('MODP', ['3111', '311', '312', '313', '314'], 'Sequencer order', (c) => (c === '3111' ? 'normal (default)' : `voice ${c.at(-1)} random`), 3),
  ...later('MODP', ['1111', '1112', '1113', '1114'], 'Sequencer clock divider', (c) => `÷${c.at(-1)}`, 3),
  ...later('MODP', ['443', '444'], 'Save state', (c) => (c === '443' ? 'reset, no save' : 'save state'), 5),
  { bank: 'MODP', code: '211', group: 'Calibration', label: 'not emulated', milestone: 99 },
  { bank: 'MODP', code: '212', group: 'Calibration', label: 'not emulated', milestone: 99 },
  { bank: 'MODP', code: '213', group: 'Calibration', label: 'not emulated', milestone: 99 },
  { bank: 'MODP', code: '214', group: 'Calibration', label: 'not emulated', milestone: 99 },
];

/** Run a code. Returns true when it was recognised and applied. */
export function applyCode(bank: Bank, code: string): boolean {
  const def = CODES.find((c) => c.bank === bank && c.code === code);
  if (!def) {
    ui.toast(`${bank} ${code}: not a code`);
    return false;
  }
  if (def.milestone === 99) {
    ui.toast(`${bank} ${code}: ${def.group.toLowerCase()} is not emulated`);
    return false;
  }
  if (def.milestone > BUILD_MILESTONE || !def.apply) {
    ui.toast(`${bank} ${code} (${def.group}) arrives in milestone ${def.milestone}`);
    return false;
  }
  def.apply();
  ui.set({ codeFlashUntil: performance.now() + 900 });
  ui.toast(`${bank} ${code} · ${def.group}: ${def.label}`);
  return true;
}

/** Non-default code settings in force, for the ? overlay. */
export function activeCodes(): CodeDef[] {
  return CODES.filter((c) => c.milestone <= BUILD_MILESTONE && c.active?.() && !c.isDefault);
}
