import { BUILD_MILESTONE } from '../engine/params';
// Everything a key, a button or a touch can do. Keymap and command bar both call these.
import { engine } from '../engine/client';
import { AVAILABLE_MODP, MODP_PROGRAMS, NUM_VOICES, paramDef } from '../engine/params';
import { saveFile, timestampName } from '../audio/wav';
import { ui } from './uiState';
import { applyCode, type Bank } from './codes';

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
  return paramDef(resolve(id)).milestone <= BUILD_MILESTONE;
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
  if (paramDef(id).milestone > BUILD_MILESTONE) return;
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

export function cycleScopeView() {
  const v = ui.get().scope.view === 'wave' ? 'spectrum' : 'wave';
  ui.setScope({ view: v });
  if (!ui.get().scopeOpen) ui.set({ scopeOpen: true });
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

// ---------------------------------------------------------------- CHRM, codes, PG combos

export function toggleChrmVoice(v: number) {
  const on = engine.store.get(`v${v}.chrm`) > 0.5 ? 0 : 1;
  engine.store.set(`v${v}.chrm`, on);
  ui.toast(`Voice ${v} chromatic ${on ? 'on' : 'off'}`);
}

/** CHRM button: if any voice is chromatic, turn all off; otherwise all on. */
export function toggleChrmAll() {
  const anyOn = [1, 2, 3, 4].some((v) => engine.store.get(`v${v}.chrm`) > 0.5);
  for (let v = 1; v <= 4; v++) engine.store.set(`v${v}.chrm`, anyOn ? 0 : 1);
  ui.toast(`Chromatic ${anyOn ? 'off' : 'on'}`);
}

export function toggleMute(v: number) {
  const on = engine.store.get(`v${v}.mute`) > 0.5 ? 0 : 1;
  engine.store.set(`v${v}.mute`, on);
  ui.set({ codeFlashUntil: performance.now() + 900 });
  ui.toast(`Voice ${v} ${on ? 'muted' : 'unmuted'}`);
}

/** PG buttons currently held, and whether a combo has used them (so release does nothing). */
const heldPg = new Map<number, { consumed: boolean; timer: number }>();

/** MODP or CHRM pressed. With a PG held: per-voice action. Otherwise: start code entry. */
export function bankDown(bank: Bank) {
  const held = [...heldPg.keys()];
  if (held.length) {
    for (const v of held) {
      heldPg.get(v)!.consumed = true;
      if (bank === 'MODP') cycleModp(v);
      else toggleChrmVoice(v);
    }
    ui.set({ codeEntry: { bank, digits: '', consumed: true } });
    return;
  }
  ui.set({ codeEntry: { bank, digits: '', consumed: false } });
}

/** MODP or CHRM released: apply the code typed, or do the button's plain action. */
export function bankUp(bank: Bank) {
  const ce = ui.get().codeEntry;
  ui.set({ codeEntry: null });
  if (!ce || ce.bank !== bank || ce.consumed) return;
  if (ce.digits) applyCode(bank, ce.digits);
  else if (bank === 'MODP') cycleModp();
  else toggleChrmAll();
}

/** A digit while MODP/CHRM is held. Returns true if it was taken as a code digit. */
export function codeDigit(v: number): boolean {
  const ce = ui.get().codeEntry;
  if (!ce || ce.consumed) return false;
  if (ce.digits.length < 6) ui.set({ codeEntry: { ...ce, digits: ce.digits + v } });
  return true;
}

export function pgDown(v: number) {
  const timer = window.setTimeout(() => {
    const h = heldPg.get(v);
    if (!h || h.consumed) return;
    h.consumed = true;
    const ce = ui.get().codeEntry;
    if (ce) {
      // MODP held + long press PG = mute (manual); keep MODP's release from cycling programs
      toggleMute(v);
      ui.set({ codeEntry: { ...ce, consumed: true } });
    } else toggleDrone(v);
  }, 1000);
  heldPg.set(v, { consumed: false, timer });
}

export function pgUp(v: number) {
  const h = heldPg.get(v);
  heldPg.delete(v);
  if (!h) return;
  window.clearTimeout(h.timer);
  if (h.consumed) return;
  if (codeDigit(v)) return;
  cyclePage(v);
}

// ---------------------------------------------------------------- Keyboard drawer
export function toggleDrawer(open = !ui.get().drawerOpen) {
  ui.set({ drawerOpen: open });
}
