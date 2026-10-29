// The single keymap table. The keyboard handler and the `?` overlay both read it,
// so the overlay can never drift from the real bindings.
import * as A from './actions';
import { ui } from './uiState';

export type Group = 'Select' | 'Adjust' | 'Voice' | 'Panel buttons' | 'Commands';

export interface Binding {
  /** e.key value, lower-case for letters. */
  key: string;
  shift?: boolean;
  alt?: boolean;
  /** How the key is shown in the overlay. */
  display: string;
  label: string;
  group: Group;
  milestone: number;
  down: (e: KeyboardEvent) => void;
  up?: (e: KeyboardEvent) => void;
  /** Fire on auto-repeat too (arrows). */
  repeat?: boolean;
}

const sel = (key: string, id: string, label: string, milestone = 1): Binding => ({
  key,
  display: key.toUpperCase(),
  label,
  group: 'Select',
  milestone,
  down: () => A.selectControl(id),
});

const STEP = 0.01;

export const BINDINGS: Binding[] = [
  // Select
  sel('e', '$.env', 'ENV (selected voice)'),
  sel('w', '$.wave', 'WAVE (selected voice)'),
  sel('m', '$.mod', 'MOD (selected voice)'),
  sel('t', '$.tune', 'TUNE (selected voice)'),
  sel('c', 'filter.cutoff', 'CUTOFF', 4),
  sel('q', 'filter.reso', 'RESO', 4),
  sel('d', 'delay.time', 'Delay TIME'),
  sel('f', 'delay.fdbk', 'Delay FDBK'),
  sel('x', 'delay.mix', 'Delay MIX'),
  sel('b', 'ouch.bite', 'BITE'),
  sel('h', 'ouch.choke', 'CHOKE'),
  sel('l', 'lfo1.freq', 'LFO1 FREQ', 3),
  sel('k', 'lfo2.freq', 'LFO2 FREQ', 3),
  sel('j', 'lfo2.wav', 'LFO2 WAV', 3),
  sel('v', 'master', 'Master volume'),
  // Adjust
  { key: 'ArrowRight', display: '→', label: 'Increase selected control', group: 'Adjust', milestone: 1, repeat: true, down: () => A.adjust(STEP) },
  { key: 'ArrowLeft', display: '←', label: 'Decrease selected control', group: 'Adjust', milestone: 1, repeat: true, down: () => A.adjust(-STEP) },
  { key: 'ArrowRight', alt: true, display: 'Alt+→', label: 'Fine increase', group: 'Adjust', milestone: 1, repeat: true, down: () => A.adjust(STEP / 5) },
  { key: 'ArrowLeft', alt: true, display: 'Alt+←', label: 'Fine decrease', group: 'Adjust', milestone: 1, repeat: true, down: () => A.adjust(-STEP / 5) },
  { key: 'ArrowUp', display: '↑', label: 'Previous control', group: 'Adjust', milestone: 1, repeat: true, down: () => A.stepControl(-1) },
  { key: 'ArrowDown', display: '↓', label: 'Next control', group: 'Adjust', milestone: 1, repeat: true, down: () => A.stepControl(1) },
  // Voice
  ...[1, 2, 3, 4].map(
    (v): Binding => ({
      key: String(v),
      display: String(v),
      label: `Voice ${v}: select; press again and hold to touch its pad`,
      group: 'Voice',
      milestone: 1,
      down: () => {
        if (ui.get().voice === v) A.gate(v, 1);
        else A.selectVoice(v);
      },
      up: () => A.gate(v, 0),
    }),
  ),
  { key: 'g', display: 'G', label: 'PG: next wavetable page (selected voice)', group: 'Voice', milestone: 1, down: () => A.cyclePage() },
  { key: 'g', shift: true, display: 'Shift+G', label: 'PG long press: drone mode on/off', group: 'Voice', milestone: 1, down: () => A.toggleDrone() },
  // Panel buttons
  { key: ' ', display: 'Space', label: 'PLAY', group: 'Panel buttons', milestone: 3, down: A.notYet('PLAY', 3) },
  { key: 'Tab', display: 'Tab', label: 'MODP: next program (all voices)', group: 'Panel buttons', milestone: 1, down: () => A.cycleModp() },
  { key: 'Tab', shift: true, display: 'Shift+Tab', label: 'MODP: next program (selected voice only)', group: 'Panel buttons', milestone: 1, down: () => A.cycleModp(ui.get().voice) },
  { key: '`', display: '`', label: 'CHRM', group: 'Panel buttons', milestone: 2, down: A.notYet('CHRM', 2) },
  { key: 'Enter', display: 'Enter', label: 'REC (sequencer)', group: 'Panel buttons', milestone: 3, down: A.notYet('Sequencer REC', 3) },
  { key: ';', display: ';', label: 'SYNC (tap tempo)', group: 'Panel buttons', milestone: 3, down: A.notYet('SYNC', 3) },
  // Commands
  { key: '?', shift: true, display: '?', label: 'This overlay', group: 'Commands', milestone: 1, down: () => A.toggleHelp() },
  { key: 'o', shift: true, display: 'Shift+O', label: 'Scope on/off, then touch a glowing tap point', group: 'Commands', milestone: 1, down: () => A.toggleScope() },
  { key: 'f', shift: true, display: 'Shift+F', label: 'Scope: freeze trace', group: 'Commands', milestone: 1, down: () => A.toggleFreeze() },
  { key: 's', shift: true, display: 'Shift+S', label: 'Scope: cycle waveform, X-Y, spectrum', group: 'Commands', milestone: 2, down: A.notYet('Scope views', 2) },
  { key: 'r', shift: true, display: 'Shift+R', label: 'Start/stop WAV recording', group: 'Commands', milestone: 1, down: () => void A.toggleRecord() },
  { key: 'p', shift: true, display: 'Shift+P', label: 'Patch mode: source, then destination', group: 'Commands', milestone: 3, down: A.notYet('Patching', 3) },
  { key: 'x', shift: true, display: 'Shift+X', label: 'Delete a patch', group: 'Commands', milestone: 3, down: A.notYet('Patching', 3) },
  { key: 'a', shift: true, display: 'Shift+A', label: 'Arm modulation recording', group: 'Commands', milestone: 3, down: A.notYet('Modulation recording', 3) },
  { key: 'l', shift: true, display: 'Shift+L', label: 'Looper: record, play, overdub', group: 'Commands', milestone: 4, down: A.notYet('Looper', 4) },
  { key: 'k', shift: true, display: 'Shift+K', label: 'Looper stop', group: 'Commands', milestone: 4, down: A.notYet('Looper', 4) },
  { key: 'u', shift: true, display: 'Shift+U', label: 'Looper undo last overdub', group: 'Commands', milestone: 4, down: A.notYet('Looper', 4) },
  { key: 'c', shift: true, display: 'Shift+C', label: 'Looper clear', group: 'Commands', milestone: 4, down: A.notYet('Looper', 4) },
  { key: 'd', shift: true, display: 'Shift+D', label: 'Keyboard drawer', group: 'Commands', milestone: 2, down: A.notYet('Keyboard drawer', 2) },
  { key: 'e', shift: true, display: 'Shift+E', label: 'Export patch', group: 'Commands', milestone: 5, down: A.notYet('Patch export', 5) },
  { key: 'm', shift: true, display: 'Shift+M', label: 'MIDI learn (desktop Chrome/Edge)', group: 'Commands', milestone: 3, down: A.notYet('MIDI learn', 3) },
  { key: 'Escape', display: 'Esc', label: 'Cancel any mode / close', group: 'Commands', milestone: 1, down: () => A.escape() },
];

const norm = (k: string) => (k.length === 1 ? k.toLowerCase() : k);

export function findBinding(e: KeyboardEvent): Binding | undefined {
  const k = norm(e.key);
  // '?' arrives as e.key '?' with shift on most layouts
  if (k === '?') return BINDINGS.find((b) => b.key === '?');
  return BINDINGS.find((b) => norm(b.key) === k && !!b.shift === e.shiftKey && !!b.alt === e.altKey);
}

export function installKeyboard(): () => void {
  const held = new Map<string, Binding>();
  const onDown = (e: KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey) return; // leave Cmd/Ctrl to the browser and iPadOS
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
    if (!ui.get().keyboardSeen) ui.set({ keyboardSeen: true });
    const b = findBinding(e);
    if (!b) return;
    e.preventDefault();
    if (e.repeat && !b.repeat) return;
    held.set(e.code, b);
    b.down(e);
  };
  const onUp = (e: KeyboardEvent) => {
    const b = held.get(e.code);
    held.delete(e.code);
    b?.up?.(e);
  };
  const onBlur = () => {
    // release any held pads if focus is lost mid-press
    held.forEach((b) => b.up?.(new KeyboardEvent('keyup')));
    held.clear();
  };
  window.addEventListener('keydown', onDown);
  window.addEventListener('keyup', onUp);
  window.addEventListener('blur', onBlur);
  return () => {
    window.removeEventListener('keydown', onDown);
    window.removeEventListener('keyup', onUp);
    window.removeEventListener('blur', onBlur);
  };
}
