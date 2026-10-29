// Floating oscilloscope frame. Draggable, resizable, triggered waveform view.
import { useEffect, useRef, type PointerEvent as RPE } from 'react';
import { engine } from '../engine/client';
import { TAPS, type TapId } from '../engine/params';
import * as A from './actions';
import { ui, useUi } from './uiState';
import { useParam } from './hooks';

const MS_STEPS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50];
const DIVS = 10;

/** Find the trigger index in the first part of the buffer, or -1. */
function findTrigger(d: Float32Array, level: number, rise: boolean, window: number) {
  const searchEnd = d.length - window;
  // search backwards from the newest possible start so the display is as fresh as possible
  for (let i = searchEnd - 1; i > 0; i--) {
    const a = d[i - 1];
    const b = d[i];
    if (rise ? a < level && b >= level : a > level && b <= level) return i;
  }
  return -1;
}

export function Scope() {
  const open = useUi((s) => s.scopeOpen);
  const sc = useUi((s) => s.scope);
  const picking = useUi((s) => s.scopePicking);
  const tapVoice = useParam('tap.voice');
  const canvas = useRef<HTMLCanvasElement>(null);
  const last = useRef<Float32Array | null>(null);
  const status = useRef<HTMLSpanElement>(null);
  const tapStarted = useRef(false);

  // Attach/detach the tap and size the requested window.
  useEffect(() => {
    if (!open) {
      engine.setTap(null);
      return;
    }
    const sr = engine.sampleRate;
    const win = Math.ceil((sc.msPerDiv * DIVS * sr) / 1000);
    engine.setTap(sc.tap, Math.min(32768, win * 2 + 64));
  }, [open, sc.tap, sc.msPerDiv]);

  useEffect(() => {
    if (!open) return;
    const off = engine.scope.on(({ id, data }) => {
      const s = ui.get().scope;
      if (id !== s.tap || s.frozen) return;
      const sr = engine.sampleRate;
      const win = Math.ceil((s.msPerDiv * DIVS * sr) / 1000);
      const t = findTrigger(data, s.level, s.slope === 'rise', win);
      if (t < 0 && s.trigger !== 'auto') {
        if (status.current) status.current.textContent = 'waiting for trigger';
        return;
      }
      const start = t < 0 ? Math.max(0, data.length - win) : t;
      last.current = data.subarray(start, start + win);
      if (status.current) status.current.textContent = t < 0 ? 'free run' : 'triggered';
      draw();
      if (s.trigger === 'single' && t >= 0) ui.setScope({ frozen: true });
    });
    return off;
  }, [open]);

  // Redraw when settings or size change.
  useEffect(() => draw());

  function draw() {
    const c = canvas.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth;
    const h = c.clientHeight;
    if (c.width !== w * dpr || c.height !== h * dpr) {
      c.width = w * dpr;
      c.height = h * dpr;
    }
    const g = c.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#0c0f0c';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#1e2a1f';
    g.lineWidth = 1;
    for (let i = 1; i < DIVS; i++) {
      const x = (i / DIVS) * w;
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, h);
      g.stroke();
    }
    for (let i = 1; i < 8; i++) {
      const y = (i / 8) * h;
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(w, y);
      g.stroke();
    }
    g.strokeStyle = '#2f4a31';
    g.beginPath();
    g.moveTo(0, h / 2);
    g.lineTo(w, h / 2);
    g.stroke();
    const s = ui.get().scope;
    // trigger level marker
    const ly = h / 2 - s.level * s.gain * (h / 2);
    g.strokeStyle = '#ff8a2a66';
    g.setLineDash([4, 4]);
    g.beginPath();
    g.moveTo(0, ly);
    g.lineTo(w, ly);
    g.stroke();
    g.setLineDash([]);
    const d = last.current;
    if (!d || d.length < 2) return;
    g.strokeStyle = '#7dff8a';
    g.lineWidth = 1.6;
    g.shadowColor = '#7dff8a';
    g.shadowBlur = 4;
    g.beginPath();
    const n = d.length;
    // min/max decimation when there are more samples than pixels
    const cols = Math.max(1, Math.floor(w));
    if (n > cols * 2) {
      for (let x = 0; x < cols; x++) {
        const i0 = Math.floor((x / cols) * n);
        const i1 = Math.floor(((x + 1) / cols) * n);
        let lo = Infinity;
        let hi = -Infinity;
        for (let i = i0; i < i1; i++) {
          if (d[i] < lo) lo = d[i];
          if (d[i] > hi) hi = d[i];
        }
        g.moveTo(x, h / 2 - hi * s.gain * (h / 2));
        g.lineTo(x, h / 2 - lo * s.gain * (h / 2) + 0.5);
      }
    } else {
      for (let i = 0; i < n; i++) {
        const x = (i / (n - 1)) * w;
        const y = h / 2 - d[i] * s.gain * (h / 2);
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
    }
    g.stroke();
    g.shadowBlur = 0;
  }

  // Dragging and resizing
  const drag = useRef<{ mode: 'move' | 'size'; x: number; y: number; ox: number; oy: number; ow: number; oh: number } | null>(null);
  const begin = (mode: 'move' | 'size') => (e: RPE<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button,select,input')) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { mode, x: e.clientX, y: e.clientY, ox: sc.x, oy: sc.y, ow: sc.w, oh: sc.h };
  };
  const move = (e: RPE<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (d.mode === 'move')
      ui.setScope({ x: Math.max(0, Math.min(window.innerWidth - 80, d.ox + dx)), y: Math.max(0, Math.min(window.innerHeight - 40, d.oy + dy)) });
    else ui.setScope({ w: Math.max(280, d.ow + dx), h: Math.max(200, d.oh + dy) });
  };
  const end = () => (drag.current = null);

  if (!open) return null;
  const tapInfo = TAPS.find((t) => t.id === sc.tap);
  return (
    <div className="scope" style={{ left: sc.x, top: sc.y, width: sc.w, height: sc.h }}>
      <div className="scope-title" onPointerDown={begin('move')} onPointerMove={move} onPointerUp={end} onPointerCancel={end}>
        <select value={sc.tap} onChange={(e) => A.pickTap(e.target.value as TapId)} aria-label="Tap point">
          {TAPS.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
        {sc.tap === 'T1' && <span className="chip">voice {tapVoice + 1}</span>}
        <button className={picking ? 'on' : ''} onClick={() => ui.set({ scopePicking: !picking })} title="Pick a tap on the panel">
          ◎ pick
        </button>
        <span className="grow" />
        <button onClick={() => A.toggleScope(false)} aria-label="Close scope">
          ✕
        </button>
      </div>
      <canvas
        ref={canvas}
        className="scope-canvas"
        // Freeze only on a tap that starts and ends on the trace, so the tap that
        // picked a panel point (and opened this frame) does not also freeze it.
        onPointerDown={() => (tapStarted.current = true)}
        onPointerUp={() => {
          if (tapStarted.current) A.toggleFreeze();
          tapStarted.current = false;
        }}
        onPointerLeave={() => (tapStarted.current = false)}
        aria-label={`Scope trace of ${tapInfo?.label}`}
      />
      <div className="scope-controls">
        <label>
          time
          <select value={sc.msPerDiv} onChange={(e) => ui.setScope({ msPerDiv: Number(e.target.value) })}>
            {MS_STEPS.map((m) => (
              <option key={m} value={m}>
                {m} ms/div
              </option>
            ))}
          </select>
        </label>
        <label>
          trig
          <select value={sc.trigger} onChange={(e) => ui.setScope({ trigger: e.target.value as 'auto', frozen: false })}>
            <option value="auto">auto</option>
            <option value="normal">normal</option>
            <option value="single">single</option>
          </select>
        </label>
        <button onClick={() => ui.setScope({ slope: sc.slope === 'rise' ? 'fall' : 'rise' })} title="Trigger slope">
          {sc.slope === 'rise' ? '↗' : '↘'}
        </button>
        <label title="Trigger level">
          lvl
          <input type="range" min={-1} max={1} step={0.01} value={sc.level} onChange={(e) => ui.setScope({ level: Number(e.target.value) })} />
        </label>
        <label title="Vertical gain">
          gain
          <select value={sc.gain} onChange={(e) => ui.setScope({ gain: Number(e.target.value) })}>
            {[0.25, 0.5, 1, 2, 4, 8, 16].map((g) => (
              <option key={g} value={g}>
                ×{g}
              </option>
            ))}
          </select>
        </label>
        <button className={sc.frozen ? 'on' : ''} onClick={() => A.toggleFreeze()}>
          {sc.frozen ? 'frozen' : 'freeze'}
        </button>
        <span className="status" ref={status} />
      </div>
      <div className="scope-resize" onPointerDown={begin('size')} onPointerMove={move} onPointerUp={end} onPointerCancel={end} aria-hidden />
    </div>
  );
}
