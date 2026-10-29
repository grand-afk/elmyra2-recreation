// Everything a key, a button or a touch can do. Keymap and command bar both call these.
import { engine } from '../engine/client';
import { AVAILABLE_MODP, MODP_PROGRAMS, NUM_VOICES, paramDef } from '../engine/params';
import { saveFile, timestampName } from '../audio/wav';
import { ui } from './uiState';

/** Keyboard order for ↑/↓ stepping through controls. `$` = selected voice. */
export const CONTROL_ORDER = [
  '$.tune',
  '$.mod',
  '$.wave',
  '$.env',
  'master',
  'lfo1.freq',
  'lfo2.freq',
  'lfo2.wav',
  'filter.cutoff',
  'filter.reso',
  'delay.time',
  'delay.fdbk',
  'delay.mix',
  'ouch.bite',
  'ouch.choke',
];

export const resolve = (id: string) => id.replace('$', `v${ui.get().voice}`);

export function isActive(id: string) {
  return paramDef(resolve(id)).milestone <= 1;
}

export function selectControl(id: string) {
  const r = resolve(id);
  ui.set({ control: r });
  if (!isActive(id)) ui.toast(`${paramDef(r).label} arrives in milestone ${paramDef(r).milestone}`);
}

export function selectVoice(v: number) {
  const s = ui.get();
  // keep the same control type when switching voice
  const ctl = s.control?.match(/^v\d\.(\w+)$/)?.[1];
  ui.set({ voice: v, control: ctl ? `v${v}.${ctl}` : s.control });
  engine.store.set('tap.voice', v - 1);
}

export function stepControl(dir: 1 | -1) {
  const s = ui.get();
  const keys = CONTROL_ORDER.map(resolve);
  const i = s.control ? keys.indexOf(s.control) : -1;
  ui.set({ control: keys[(i + dir + keys.length) % keys.length] });
}

export function adjust(delta: number) {
  const id = ui.get().control;
  if (!id) {
    ui.toast('Select a control first (press a letter, or ↑/↓)');
    return;
  }
  if (paramDef(id).milestone > 1) return;
  engine.store.set(id, engine.store.get(id) + delta);
}

export function gate(v: number, value: number) {
  engine.store.set(`v${v}.gate`, value);
}

export function cyclePage(v = ui.get().voice) {
  engine.store.set(`v${v}.page`, (engine.store.get(`v${v}.page`) + 1) % 4);
}

export function toggleDrone(v = ui.get().voice) {
  const on = engine.store.get(`v${v}.drone`) > 0.5 ? 0 : 1;
  engine.store.set(`v${v}.drone`, on);
  ui.toast(`Voice ${v} drone ${on ? 'on' : 'off'}`);
}

/** MODP: cycle program on every voice (hardware behaviour), skipping ones not built yet. */
export function cycleModp(voice?: number) {
  const voices = voice ? [voice] : Array.from({ length: NUM_VOICES }, (_, i) => i + 1);
  const cur = Math.round(engine.store.get(`v${voices[0]}.modp`));
  const pos = AVAILABLE_MODP.findIndex((p) => p.index === cur);
  const next = AVAILABLE_MODP[(pos + 1) % AVAILABLE_MODP.length];
  for (const v of voices) engine.store.set(`v${v}.modp`, next.index);
  ui.toast(`MODP ${MODP_PROGRAMS[next.index].name}${voice ? ` (voice ${voice})` : ''}`);
}

export function toggleHelp(open = !ui.get().helpOpen) {
  ui.set({ helpOpen: open });
}

export function toggleScope(open = !ui.get().scopeOpen) {
  ui.set({ scopeOpen: open, scopePicking: open });
}

export function pickTap(id: Parameters<typeof engine.setTap>[0]) {
  if (!id) return;
  ui.setScope({ tap: id, frozen: false });
  ui.set({ scopePicking: false, scopeOpen: true });
}

export function toggleFreeze() {
  ui.setScope({ frozen: !ui.get().scope.frozen });
}

export async function toggleRecord() {
  if (!engine.started) {
    ui.toast('Start audio first');
    return;
  }
  if (!engine.recording) {
    engine.startRecording();
    ui.set({ recording: true, recSeconds: 0 });
    return;
  }
  const p = engine.stopRecording();
  ui.set({ recording: false });
  if (!p) return;
  const blob = await p;
  const how = await saveFile(blob, timestampName('elmyra2-recreation', 'wav'));
  ui.toast(how === 'cancelled' ? 'Recording discarded' : `Recording ${how} (${(blob.size / 1e6).toFixed(1)} MB)`);
}

export function escape() {
  const s = ui.get();
  if (s.helpOpen) ui.set({ helpOpen: false });
  else if (s.scopePicking) ui.set({ scopePicking: false });
  else ui.set({ control: null });
}

export const notYet = (what: string, m: number) => () => ui.toast(`${what} arrives in milestone ${m}`);
