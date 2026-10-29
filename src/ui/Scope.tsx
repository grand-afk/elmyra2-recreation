// Floating oscilloscope frame: draggable, resizable, triggered waveform or spectrum view,
// with a frequency / note / cents readout in the active tuning.
import { useEffect, useRef, type PointerEvent as RPE } from 'react';
import { engine } from '../engine/client';
import { TAPS, type TapId } from '../engine/params';
import { EDOS, describePitch, hzToOctaves } from '../engine/tuning';
import { spectrumDb, yin } from '../dsp/pitch';
import * as A from './actions';
import { ui, useUi } from './uiState';
import { useParam } from './hooks';

const MS_STEPS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50];
const DIVS = 10;
const MIN_LEN = 8192; // enough for pitch detection down to ~25 Hz and a fine spectrum
const PITCH_EVERY_MS = 150;

/** Newest trigger index with a full window after it, or -1. */
function findTrigger(d: Float32Array, level: number, rise: boolean, window: number) {
  for (let i = d.length - window - 1; i > 0; i--) {
    const a = d[i - 1];
    const b = d[i];
    if (rise ? a < level && b >= level : a > level && b <= level) return i;
  }
  return -1;
}

interface Readout {
  hz: number;
  confidence: number;
  exact: boolean;
}

export function Scope() {
  const open = useUi((s) => s.scopeOpen);
  const sc = useUi((s) => s.scope);
  const picking = useUi((s) => s.scopePicking);
  const tapVoice = useParam('tap.voice');
  const edoIdx = useParam('chrm.edo');
  const canvas = useRef<HTMLCanvasElement>(null);
  const shown = useRef<Float32Array | null>(null);
  const latest = useRef<Float32Array | null>(null);
  const peaks = useRef<Float32Array | null>(null);
  const status = useRef<HTMLSpanElement>(null);
  const readoutEl = useRef<HTMLDivElement>(null);
  const tapStarted = useRef(false);
  const readout = useRef<Readout | null>(null);
  const lastPitchAt = useRef(0);
  const lockAnchor = useRef<number | null>(null);

  useEffect(() => {
    if (!open) {
      engine.setTap(null);
      return;
    }
    const win = Math.ceil((sc.msPerDiv * DIVS * engine.sampleRate) / 1000);
    engine.setTap(sc.tap, Math.min(32768, Math.max(MIN_LEN, win * 2 + 64)));
    peaks.current = null;
    lockAnchor.current = null;
  }, [open, sc.tap, sc.msPerDiv]);

  useEffect(() => {
    lockAnchor.current = null;
  }, [sc.lock, tapVoice]);

  useEffect(() => {
    if (!open) return;
    const off = engine.scope.on(({ id, data, end }) => {
      const s = ui.get().scope;
      if (id !== s.tap) return;
      latest.current = data;
      updatePitch(data);
      if (s.frozen) return;
      const sr = engine.sampleRate;
      const win = Math.ceil((s.msPerDiv * DIVS * sr) / 1000);
      let start = -1;
      const r = readout.current;
      if (s.lock && r && r.confidence > 0.6) {
        // Lock: keep the display start on a whole number of detected periods from an anchor,
        // so a detuned or drifting signal holds still instead of re-triggering.
        const period = sr / r.hz;
        const bufStart = end - data.length;
        if (lockAnchor.current === null) {
          const t = findTrigger(data, s.level, s.slope === 'rise', win);
          lockAnchor.current = bufStart + (t < 0 ? data.length - win : t);
        }
        const k = Math.floor((end - win - lockAnchor.current) / period);
        start = Math.round(lockAnchor.current + k * period - bufStart);
        if (start < 0 || start + win > data.length) {
          lockAnchor.current = null;
          start = -1;
        }
        if (status.current) status.current.textContent = 'locked';
      }
      if (start < 0) {
        const t = findTrigger(data, s.level, s.slope === 'rise', win);
        if (t < 0 && s.trigger !== 'auto') {
          if (status.current) status.current.textContent = 'waiting for trigger';
          return;
        }
        start = t < 0 ? Math.max(0, data.length - win) : t;
        if (status.current) status.current.textContent = t < 0 ? 'free run' : 'triggered';
        if (s.trigger === 'single' && t >= 0) ui.setScope({ frozen: true });
      }
      shown.current = data.subarray(start, start + win);
      draw();
    });
    return off;
  }, [open]);

  useEffect(() => draw());

  function updatePitch(data: Float32Array) {
    const now = performance.now();
    if (now - lastPitchAt.current < PITCH_EVERY_MS) return;
    lastPitchAt.current = now;
    const s = ui.get().scope;
    const v = Math.round(engine.store.get('tap.voice'));
    if (s.tap === 'T1') {
      // The engine knows each voice's exact pitch: no detection needed.
      const live = engine.envLevels[v] > 0.01;
      readout.current = live ? { hz: engine.voiceHz[v], confidence: 1, exact: true } : null;
    } else {
      const r = yin(data, engine.sampleRate);
      readout.current = r && r.confidence > 0.3 ? { ...r, exact: false } : null;
    }
    renderReadout();
  }

  function renderReadout() {
    const el = readoutEl.current;
    if (!el) return;
    const r = readout.current;
    if (!r) {
      el.innerHTML = '<span class="dim">no clear pitch</span>';
      return;
    }
    const edo = EDOS[Math.round(engine.store.get('chrm.edo'))] ?? 12;
    const d = describePitch(hzToOctaves(r.hz), edo);
    const c = Math.max(-50, Math.min(50, d.cents));
    el.innerHTML = `
      <span class="hz">${r.hz.toFixed(r.hz < 100 ? 2 : 1)} Hz</span>
      <span class="note">${d.name}</span>
      <span class="cents ${Math.abs(d.cents) < 2 ? 'ok' : ''}">${d.cents >= 0 ? '+' : ''}${d.cents.toFixed(1)}¢</span>
      <span class="needle"><i style="left:${50 + c}%"></i></span>
      <span class="conf" title="${r.exact ? 'exact (engine)' : 'detected'}">${r.exact ? 'exact' : `${Math.round(r.confidence * 100)}%`}</span>`;
  }

  function draw() {
    const c = canvas.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth;
    const h = c.clientHeight;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
    const g = c.getContext('2d');
    if (!g) return;
    const s = ui.get().scope;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    // persistence: fade the previous frame instead of clearing it
    g.fillStyle = s.persistence === 0 ? '#0c0f0c' : s.persistence === 1 ? 'rgba(12,15,12,0.35)' : 'rgba(12,15,12,0.12)';
    g.fillRect(0, 0, w, h);
    if (s.view === 'spectrum') drawSpectrum(g, w, h);
    else drawWave(g, w, h);
  }

  function grid(g: CanvasRenderingContext2D, w: number, h: number) {
    g.strokeStyle = '#1e2a1f';
    g.lineWidth = 1;
    for (let i = 1; i < DIVS; i++) {
      g.beginPath();
      g.moveTo((i / DIVS) * w, 0);
      g.lineTo((i / DIVS) * w, h);
      g.stroke();
    }
    for (let i = 1; i < 8; i++) {
      g.beginPath();
      g.moveTo(0, (i / 8) * h);
      g.lineTo(w, (i / 8) * h);
      g.stroke();
    }
  }

  function drawWave(g: CanvasRenderingContext2D, w: number, h: number) {
    const s = ui.get().scope;
    if (s.persistence === 0) grid(g, w, h);
    g.strokeStyle = '#2f4a31';
    g.beginPath();
    g.moveTo(0, h / 2);
    g.lineTo(w, h / 2);
    g.stroke();
    const ly = h / 2 - s.level * s.gain * (h / 2);
    g.strokeStyle = '#ff8a2a66';
    g.setLineDash([4, 4]);
    g.beginPath();
    g.moveTo(0, ly);
    g.lineTo(w, ly);
    g.stroke();
    g.setLineDash([]);
    const d = shown.current;
    if (!d || d.length < 2) return;
    let mean = 0;
    if (s.coupling === 'ac') {
      for (let i = 0; i < d.length; i++) mean += d[i];
      mean /= d.length;
    }
    const Y = (v: number) => h / 2 - (v - mean) * s.gain * (h / 2);
    g.strokeStyle = '#7dff8a';
    g.lineWidth = 1.6;
    g.shadowColor = '#7dff8a';
    g.shadowBlur = 4;
    g.beginPath();
    const n = d.length;
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
        g.moveTo(x, Y(hi));
        g.lineTo(x, Y(lo) + 0.5);
      }
    } else {
      for (let i = 0; i < n; i++) {
        const x = (i / (n - 1)) * w;
        if (i === 0) g.moveTo(x, Y(d[i]));
        else g.lineTo(x, Y(d[i]));
      }
    }
    g.stroke();
    g.shadowBlur = 0;
  }

  function drawSpectrum(g: CanvasRenderingContext2D, w: number, h: number) {
    const data = latest.current;
    const sr = engine.sampleRate;
    const fMin = 20;
    const fMax = Math.min(20000, sr / 2);
    const X = (f: number) => (Math.log(f / fMin) / Math.log(fMax / fMin)) * w;
    const DB_MIN = -100;
    const Y = (db: number) => (Math.min(0, Math.max(DB_MIN, db)) / DB_MIN) * h;
    // grid: decades and 20 dB lines
    g.strokeStyle = '#1e2a1f';
    g.fillStyle = '#4c6a4e';
    g.font = '10px -apple-system, sans-serif';
    for (const f of [50, 100, 200, 500, 1000, 2000, 5000, 10000]) {
      const x = X(f);
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, h);
      g.stroke();
      g.fillText(f >= 1000 ? `${f / 1000}k` : `${f}`, x + 2, h - 4);
    }
    for (let db = -20; db > DB_MIN; db -= 20) {
      const y = Y(db);
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(w, y);
      g.stroke();
      g.fillText(`${db}`, 2, y - 2);
    }
    if (!data) return;
    const n = data.length >= 8192 ? 8192 : data.length >= 4096 ? 4096 : 2048;
    const spec = spectrumDb(data, n);
    if (!peaks.current || peaks.current.length !== spec.length) peaks.current = Float32Array.from(spec);
    const pk = peaks.current;
    const binHz = sr / n;
    const trace = (arr: Float32Array, color: string, width: number) => {
      g.strokeStyle = color;
      g.lineWidth = width;
      g.beginPath();
      let started = false;
      // one point per pixel column: max over the bins it covers
      for (let x = 0; x < w; x++) {
        const f0 = fMin * Math.pow(fMax / fMin, x / w);
        const f1 = fMin * Math.pow(fMax / fMin, (x + 1) / w);
        const b0 = Math.max(1, Math.floor(f0 / binHz));
        const b1 = Math.max(b0 + 1, Math.ceil(f1 / binHz));
        let m = -Infinity;
        for (let b = b0; b < b1 && b < arr.length; b++) m = Math.max(m, arr[b]);
        if (!Number.isFinite(m)) continue;
        if (!started) {
          g.moveTo(x, Y(m));
          started = true;
        } else g.lineTo(x, Y(m));
      }
      g.stroke();
    };
    for (let i = 0; i < pk.length; i++) pk[i] = Math.max(spec[i], pk[i] - 0.6); // slow decay
    trace(pk, '#ff8a2a88', 1);
    trace(spec, '#7dff8a', 1.5);
    const r = readout.current;
    if (r) {
      g.strokeStyle = '#ffd84d88';
      g.setLineDash([3, 3]);
      g.beginPath();
      g.moveTo(X(r.hz), 0);
      g.lineTo(X(r.hz), h);
      g.stroke();
      g.setLineDash([]);
    }
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
    else ui.setScope({ w: Math.max(320, d.ow + dx), h: Math.max(240, d.oh + dy) });
  };
  const end = () => (drag.current = null);

  if (!open) return null;
  const tapInfo = TAPS.find((t) => t.id === sc.tap);
  void edoIdx; // re-render the readout when the tuning changes
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
        <button className={sc.view === 'spectrum' ? 'on' : ''} onClick={() => A.cycleScopeView()} title="Waveform / spectrum (Shift+S)">
          {sc.view === 'spectrum' ? 'spectrum' : 'wave'}
        </button>
        <span className="grow" />
        <button onClick={() => A.toggleScope(false)} aria-label="Close scope">
          ✕
        </button>
      </div>
      <div className="scope-readout" ref={readoutEl} aria-live="polite" />
      <canvas
        ref={canvas}
        className="scope-canvas"
        onPointerDown={() => (tapStarted.current = true)}
        onPointerUp={() => {
          if (tapStarted.current) A.toggleFreeze();
          tapStarted.current = false;
        }}
        onPointerLeave={() => (tapStarted.current = false)}
        aria-label={`Scope ${sc.view} of ${tapInfo?.label}`}
      />
      <div className="scope-controls">
        {sc.view === 'wave' && (
          <>
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
            <button className={sc.lock ? 'on' : ''} onClick={() => ui.setScope({ lock: !sc.lock })} title="Lock the display to the detected pitch">
              lock
            </button>
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
            <button onClick={() => ui.setScope({ coupling: sc.coupling === 'dc' ? 'ac' : 'dc' })} title="AC removes the DC offset; DC shows it">
              {sc.coupling.toUpperCase()}
            </button>
          </>
        )}
        <label title="Persistence">
          persist
          <select value={sc.persistence} onChange={(e) => ui.setScope({ persistence: Number(e.target.value) as 0 })}>
            <option value={0}>off</option>
            <option value={1}>short</option>
            <option value={2}>long</option>
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
