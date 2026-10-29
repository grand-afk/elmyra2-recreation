// Keyboard drawer: two octaves of the active tuning (12-EDO piano, a scale, or any EDO as a
// row of equal keys). Each key plays the next free voice; with all four busy, the oldest is
// stolen. Touch pressure (or Apple Pencil) sets the level.
import { useRef, useState, type PointerEvent as RPE } from 'react';
import { engine } from '../engine/client';
import { EDOS, SCALES, describePitch, noteToOctaves, octavesToHz, stepsOf, type Tuning } from '../engine/tuning';
import * as A from './actions';
import { useParam } from './hooks';
import { ui, useUi } from './uiState';

// Voice allocation shared across all keys.
const held = new Map<number, number>(); // pointerId -> voice
let lastUse = [0, 0, 0, 0];
let clock = 0;

function allocVoice(): number {
  const busy = new Set(held.values());
  const free = [1, 2, 3, 4].filter((v) => !busy.has(v));
  const pool = free.length ? free : [1, 2, 3, 4];
  // least recently used; when stealing, the oldest held note
  return pool.reduce((a, b) => (lastUse[a - 1] <= lastUse[b - 1] ? a : b));
}

const pressureOf = (e: RPE<HTMLElement>) => {
  if (e.pointerType === 'pen' && e.pressure > 0) return Math.min(1, 0.15 + e.pressure);
  if (e.pointerType === 'touch' && e.width > 1) return Math.min(1, Math.max(0.45, (e.width - 8) / 40));
  return 1;
};

const IS_BLACK_12 = [false, true, false, false, true, false, true, false, false, true, false, true]; // from A

export function Drawer() {
  const open = useUi((s) => s.drawerOpen);
  const octave = useUi((s) => s.drawerOctave);
  const edoIdx = useParam('chrm.edo');
  const scale = useParam('chrm.scale');
  const [down, setDown] = useState<Record<number, boolean>>({});
  const keyPointers = useRef(new Map<number, number>()); // pointerId -> note index
  if (!open) return null;

  const tuning: Tuning = { edo: EDOS[edoIdx] ?? 12, scale };
  const steps = stepsOf(tuning);
  const count = steps.length * 2 + 1;
  const first = octave * steps.length;
  const notes = Array.from({ length: count }, (_, k) => first + k);
  const piano = tuning.edo === 12 && scale === 0;
  const name = tuning.edo === 12 ? `${SCALES[scale].name} · 12-EDO` : `${tuning.edo}-EDO`;

  const press = (n: number) => (e: RPE<HTMLButtonElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const v = allocVoice();
    held.set(e.pointerId, v);
    keyPointers.current.set(e.pointerId, n);
    lastUse[v - 1] = ++clock;
    engine.store.set(`v${v}.note`, noteToOctaves(n, tuning));
    A.gate(v, pressureOf(e));
    setDown((d) => ({ ...d, [n]: true }));
  };
  const move = (e: RPE<HTMLButtonElement>) => {
    const v = held.get(e.pointerId);
    if (v) A.gate(v, pressureOf(e));
  };
  const release = (e: RPE<HTMLButtonElement>) => {
    const v = held.get(e.pointerId);
    const n = keyPointers.current.get(e.pointerId);
    held.delete(e.pointerId);
    keyPointers.current.delete(e.pointerId);
    if (v && ![...held.values()].includes(v)) A.gate(v, 0);
    if (n !== undefined) setDown((d) => ({ ...d, [n]: false }));
  };

  const label = (n: number) => {
    const o = noteToOctaves(n, tuning);
    const d = describePitch(o, tuning.edo);
    return tuning.edo === 12 ? d.name : `${((d.step % tuning.edo) + tuning.edo) % tuning.edo}`;
  };

  const keyProps = (n: number) => ({
    onPointerDown: press(n),
    onPointerMove: move,
    onPointerUp: release,
    onPointerCancel: release,
    title: `${label(n)} · ${octavesToHz(noteToOctaves(n, tuning)).toFixed(2)} Hz`,
  });

  return (
    <div className="drawer" role="group" aria-label="Keyboard drawer">
      <div className="drawer-head">
        <b>{name}</b>
        <span className="quiet">
          from {label(first)} · {octavesToHz(noteToOctaves(first, tuning)).toFixed(1)} Hz
        </span>
        <span className="grow" />
        <button onClick={() => ui.set({ drawerOctave: Math.max(0, octave - 1) })} aria-label="Octave down">
          oct −
        </button>
        <span className="oct">{octave}</span>
        <button onClick={() => ui.set({ drawerOctave: Math.min(6, octave + 1) })} aria-label="Octave up">
          oct +
        </button>
        <button onClick={() => A.toggleDrawer(false)} aria-label="Close keyboard">
          ✕
        </button>
      </div>
      {piano ? (
        <div className="keys piano">
          {notes.map((n) => {
            const pc = ((n % 12) + 12) % 12;
            if (IS_BLACK_12[pc]) return null;
            const next = n + 1;
            const hasBlack = next < first + count && IS_BLACK_12[((next % 12) + 12) % 12];
            return (
              <div key={n} className="white-wrap">
                <button className={`key white${down[n] ? ' down' : ''}`} {...keyProps(n)}>
                  <span>{label(n)}</span>
                </button>
                {hasBlack && <button className={`key black${down[next] ? ' down' : ''}`} {...keyProps(next)} />}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="keys row">
          {notes.map((n) => {
            const isRoot = ((n % steps.length) + steps.length) % steps.length === 0;
            return (
              <button key={n} className={`key flat${isRoot ? ' root' : ''}${down[n] ? ' down' : ''}`} {...keyProps(n)}>
                <span>{label(n)}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
