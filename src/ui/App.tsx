import { BUILD_MILESTONE } from '../engine/params';
import { useEffect, useState } from 'react';
import { engine } from '../engine/client';
import { MODP_PROGRAMS, paramDef } from '../engine/params';
import { Panel } from './Panel';
import { Scope } from './Scope';
import { HelpOverlay } from './HelpOverlay';
import { CommandBar } from './CommandBar';
import { Drawer } from './Drawer';
import { installKeyboard } from './keymap';
import { useParam } from './hooks';
import { ui, useUi } from './uiState';

function StartGate() {
  const [state, setState] = useState<'idle' | 'starting' | 'error'>('idle');
  const [err, setErr] = useState('');
  const [running, setRunning] = useState(engine.started);
  useEffect(() => {
    // iOS suspends audio when backgrounded; offer to resume.
    const onVis = () => setRunning(engine.started);
    document.addEventListener('visibilitychange', onVis);
    const off = engine.statsEvent.on(() => setRunning(engine.started));
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      off();
    };
  }, []);
  if (running) return null;
  const start = async () => {
    setState('starting');
    try {
      await engine.start();
      setRunning(engine.started);
      setState('idle');
    } catch (e) {
      setErr(String(e));
      setState('error');
    }
  };
  return (
    <div className="overlay start" onPointerDown={start}>
      <div className="start-card">
        <h1>Elmyra 2 Recreation</h1>
        <p>{state === 'starting' ? 'Starting audio…' : engine.ctx ? 'Audio paused. Tap to resume.' : 'Tap anywhere to start audio.'}</p>
        {state === 'error' && <p className="err">Audio could not start: {err}</p>}
        <p className="small">Landscape works best. Press ? for shortcuts. Unofficial, personal recreation; not affiliated with Neutral Labs.</p>
      </div>
    </div>
  );
}

function StatusLine() {
  const control = useUi((s) => s.control);
  const voice = useUi((s) => s.voice);
  const value = useParam(control ?? 'master');
  const modp = useParam(`v${voice}.modp`);
  const ce = useUi((s) => s.codeEntry);
  if (ce && !ce.consumed)
    return (
      <div className="status-line">
        <span className="sel">
          {ce.bank} code: <b>{ce.digits ? ce.digits.split('').join(' ') : '…'}</b>
        </span>
        <span className="quiet">tap PG 1–4 (or keys 1–4), then release {ce.bank}</span>
      </div>
    );
  return (
    <div className="status-line">
      <span>Voice {voice}</span>
      <span>MODP {MODP_PROGRAMS[modp]?.name}</span>
      {control ? (
        <span className="sel">
          {paramDef(control).label} <b>{Math.round(value * 100)}</b>
          {paramDef(control).milestone > BUILD_MILESTONE && ` · arrives in milestone ${paramDef(control).milestone}`}
        </span>
      ) : (
        <span className="quiet">No control selected: press a letter or touch a knob</span>
      )}
    </div>
  );
}

function Toast() {
  const t = useUi((s) => s.toast);
  return t ? <div className="toast">{t}</div> : null;
}

export function App() {
  useEffect(() => installKeyboard(), []);
  useEffect(() => engine.recEvent.on(({ seconds }) => ui.set({ recSeconds: seconds })), []);
  return (
    <div className="app">
      <main className="stage">
        <Panel />
        <StatusLine />
      </main>
      <CommandBar />
      <Drawer />
      <Scope />
      <HelpOverlay />
      <Toast />
      <StartGate />
    </div>
  );
}
