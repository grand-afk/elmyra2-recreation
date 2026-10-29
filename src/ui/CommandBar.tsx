// Touch command bar + performance meter. Collapses when a hardware keyboard is in use.
import { useEffect, useState } from 'react';
import { engine, type Stats } from '../engine/client';
import * as A from './actions';
import { useUi } from './uiState';

const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

function Meter() {
  const [st, setSt] = useState<Stats>(engine.getStats());
  const [open, setOpen] = useState(false);
  useEffect(() => engine.statsEvent.on(setSt), []);
  const pct = Math.round(st.load * 100);
  const level = pct >= 90 ? 'red' : pct >= 70 ? 'amber' : 'ok';
  const mb = (st.memBytes + st.recBytes) / 1e6;
  return (
    <button className={`meter ${level}`} onClick={() => setOpen(!open)} title="DSP load and audio memory">
      <span className="bar">
        <span style={{ width: `${Math.min(100, pct)}%` }} />
      </span>
      <span className="txt">
        DSP {pct}% · {mb.toFixed(1)} MB
      </span>
      {open && (
        <span className="meter-detail">
          <span>Audio thread load (estimate): {pct}%</span>
          <span>Audio buffers: {(st.memBytes / 1e6).toFixed(2)} MB</span>
          <span>Recording buffer: {(st.recBytes / 1e6).toFixed(2)} MB</span>
          <span>Dropouts: {st.underruns ?? 'not reported by this browser'}</span>
          <span>Sample rate: {engine.sampleRate} Hz</span>
          <span>Per-module breakdown arrives with more modules (M3)</span>
        </span>
      )}
    </button>
  );
}

interface Cmd {
  icon: string;
  label: string;
  key: string;
  on?: boolean;
  milestone?: number;
  run: () => void;
}

export function CommandBar() {
  const scopeOpen = useUi((s) => s.scopeOpen);
  const helpOpen = useUi((s) => s.helpOpen);
  const drawerOpen = useUi((s) => s.drawerOpen);
  const recording = useUi((s) => s.recording);
  const recSeconds = useUi((s) => s.recSeconds);
  const keyboardSeen = useUi((s) => s.keyboardSeen);
  const barForced = useUi((s) => s.barForced);
  const compact = keyboardSeen && !barForced;

  const cmds: Cmd[] = [
    { icon: '◉', label: recording ? fmtTime(recSeconds) : 'Record', key: 'Shift+R', on: recording, run: () => void A.toggleRecord() },
    { icon: '∿', label: 'Scope', key: 'Shift+O', on: scopeOpen, run: () => A.toggleScope() },
    { icon: '?', label: 'Help', key: '?', on: helpOpen, run: () => A.toggleHelp() },
    { icon: '⟲', label: 'Mod rec', key: 'Shift+A', milestone: 3, run: A.notYet('Modulation recording', 3) },
    { icon: '∞', label: 'Looper', key: 'Shift+L', milestone: 4, run: A.notYet('Looper', 4) },
    { icon: '♪', label: 'Keys', key: 'Shift+D', on: drawerOpen, run: () => A.toggleDrawer() },
    { icon: '⇪', label: 'Export', key: 'Shift+E', milestone: 5, run: A.notYet('Patch export', 5) },
    { icon: 'M', label: 'MIDI', key: 'Shift+M', milestone: 3, run: A.notYet('MIDI learn', 3) },
  ];
  const shown = compact ? cmds.filter((c) => c.on) : cmds;
  return (
    <nav className={`cmdbar${compact ? ' compact' : ''}`} aria-label="Commands">
      <Meter />
      {shown.map((c) => (
        <button key={c.label + c.key} className={`cmd${c.on ? ' on' : ''}${c.milestone ? ' later' : ''}`} onClick={c.run} title={`${c.label} (${c.key})`}>
          <span className="icon">{c.icon}</span>
          <span className="name">{c.label}</span>
          {c.milestone && <span className="mtag-html">M{c.milestone}</span>}
        </button>
      ))}
      {compact && <span className="hint">? for shortcuts</span>}
    </nav>
  );
}
