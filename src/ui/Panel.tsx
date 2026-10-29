// The instrument panel, drawn as one SVG so it scales cleanly on any screen.
// Layout follows the hardware's sections; exact positions to be refined against a photo.
import { useRef, useState, type PointerEvent as RPE } from 'react';
import { engine } from '../engine/client';
import { MODP_PROGRAMS, paramDef, type TapId } from '../engine/params';
import { ElmyraCore } from '../engine/core';
import * as A from './actions';
import { useParam } from './hooks';
import { useUi } from './uiState';

const INK = '#e9e2cf';
const QUIET = '#8d877a';
const LINE = '#3b3833';
const ACCENT = '#ff8a2a';
const PAGE_COLORS = ['#ff4d4d', '#4dd17a', '#4d8dff', '#ffd84d'];

// ---------------------------------------------------------------- Knob
function Knob({ id, x, y, r = 24, label }: { id: string; x: number; y: number; r?: number; label: string }) {
  const value = useParam(id);
  const def = paramDef(id);
  const active = def.milestone <= 1;
  const selected = useUi((s) => s.control === id);
  const drag = useRef<{ y: number; v: number; pid: number } | null>(null);
  const lastTap = useRef(0);
  const [dragging, setDragging] = useState(false);

  const onDown = (e: RPE<SVGGElement>) => {
    A.selectControl(id);
    if (!active) return;
    const now = performance.now();
    if (now - lastTap.current < 300) {
      engine.store.set(id, def.def); // double-tap resets
      lastTap.current = 0;
      return;
    }
    lastTap.current = now;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    drag.current = { y: e.clientY, v: value, pid: e.pointerId };
    setDragging(true);
  };
  const onMove = (e: RPE<SVGGElement>) => {
    const d = drag.current;
    if (!d || d.pid !== e.pointerId) return;
    const range = e.altKey ? 1200 : 240; // px for full travel
    engine.store.set(id, d.v + (d.y - e.clientY) / range);
  };
  const onUp = () => {
    drag.current = null;
    setDragging(false);
  };

  const ang = -135 + value * 270;
  const rad = (ang - 90) * (Math.PI / 180);
  const arc = (a0: number, a1: number, rr: number) => {
    const p = (a: number) => [x + rr * Math.cos(((a - 90) * Math.PI) / 180), y + rr * Math.sin(((a - 90) * Math.PI) / 180)];
    const [x0, y0] = p(a0);
    const [x1, y1] = p(a1);
    return `M${x0} ${y0} A${rr} ${rr} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1} ${y1}`;
  };
  return (
    <g
      className={`knob${active ? '' : ' inactive'}`}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      role="slider"
      aria-label={def.label}
      aria-valuenow={Math.round(value * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <circle cx={x} cy={y} r={r + 14} fill="transparent" />
      <path d={arc(-135, 135, r + 6)} stroke={LINE} strokeWidth={3} fill="none" strokeLinecap="round" />
      {active && value > 0.002 && <path d={arc(-135, ang, r + 6)} stroke={ACCENT} strokeWidth={3} fill="none" strokeLinecap="round" />}
      <circle cx={x} cy={y} r={r} fill="url(#knobFace)" stroke={selected ? ACCENT : '#000'} strokeWidth={selected ? 2.5 : 1} />
      <line x1={x + Math.cos(rad) * r * 0.25} y1={y + Math.sin(rad) * r * 0.25} x2={x + Math.cos(rad) * r * 0.85} y2={y + Math.sin(rad) * r * 0.85} stroke={INK} strokeWidth={3} strokeLinecap="round" />
      <text x={x} y={y + r + 24} textAnchor="middle" className="lbl">
        {label}
      </text>
      {!active && (
        <text x={x + r} y={y - r} className="mtag">
          M{def.milestone}
        </text>
      )}
      {dragging && (
        <text x={x} y={y - r - 12} textAnchor="middle" className="val">
          {Math.round(value * 100)}
        </text>
      )}
    </g>
  );
}

// ---------------------------------------------------------------- Jack (decorative until patching, M3)
function Jack({ x, y, label }: { x: number; y: number; label: string }) {
  return (
    <g className="jack inactive">
      <circle cx={x} cy={y} r={9} fill="#0b0b0b" stroke="#8c8c8c" strokeWidth={2.5} />
      <circle cx={x} cy={y} r={4} fill="#000" />
      <text x={x} y={y + 22} textAnchor="middle" className="lbl small">
        {label}
      </text>
    </g>
  );
}

// ---------------------------------------------------------------- Tap point
function TapPoint({ id, x, y, voice }: { id: TapId; x: number; y: number; voice?: number }) {
  const picking = useUi((s) => s.scopePicking);
  const current = useUi((s) => s.scopeOpen && s.scope.tap === id);
  const tapVoice = useParam('tap.voice');
  const isCurrent = current && (voice === undefined || tapVoice === voice - 1);
  if (!picking && !isCurrent) return null;
  return (
    <g
      className={`tap${picking ? ' picking' : ''}`}
      onPointerDown={(e) => {
        e.stopPropagation();
        if (voice) engine.store.set('tap.voice', voice - 1);
        A.pickTap(id);
      }}
    >
      <circle cx={x} cy={y} r={16} fill="transparent" />
      <circle cx={x} cy={y} r={7} className="tapdot" />
      <text x={x + 12} y={y - 10} className="taplbl">
        {id}
      </text>
    </g>
  );
}

// ---------------------------------------------------------------- Panel button with LED
function PanelButton({ x, y, label, led, onPress, onLong, active = true, milestone }: {
  x: number;
  y: number;
  label: string;
  led?: string | null;
  onPress: () => void;
  onLong?: () => void;
  active?: boolean;
  milestone?: number;
}) {
  const timer = useRef<number | null>(null);
  const longFired = useRef(false);
  const down = () => {
    longFired.current = false;
    if (onLong)
      timer.current = window.setTimeout(() => {
        longFired.current = true;
        onLong();
      }, 1000);
  };
  const up = () => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
    if (!longFired.current) onPress();
  };
  return (
    <g className={`btn${active ? '' : ' inactive'}`} onPointerDown={down} onPointerUp={up} onPointerCancel={() => timer.current && clearTimeout(timer.current)}>
      <circle cx={x} cy={y} r={24} fill="transparent" />
      <circle cx={x} cy={y} r={15} fill="url(#btnFace)" stroke="#000" />
      <circle cx={x - 24} cy={y - 18} r={4.5} fill={led ?? '#2a2622'} className={led ? 'led on' : 'led'} style={led ? { color: led } : undefined} />
      <text x={x} y={y + 34} textAnchor="middle" className="lbl">
        {label}
      </text>
      {!active && milestone && (
        <text x={x + 16} y={y - 16} className="mtag">
          M{milestone}
        </text>
      )}
    </g>
  );
}

// ---------------------------------------------------------------- Touchpad
function Pad({ v, x, y, w, h }: { v: number; x: number; y: number; w: number; h: number }) {
  const gate = useParam(`v${v}.gate`);
  const drone = useParam(`v${v}.drone`) > 0.5;
  const env = useParam(`v${v}.env`);
  const pointers = useRef(new Set<number>());
  const pressureOf = (e: RPE<SVGRectElement>) => {
    if (e.pointerType === 'pen' && e.pressure > 0) return Math.min(1, 0.15 + e.pressure);
    if (e.pointerType === 'touch' && e.width > 1) return Math.min(1, Math.max(0.45, (e.width - 8) / 40));
    return 1;
  };
  const down = (e: RPE<SVGRectElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.add(e.pointerId);
    A.selectVoice(v);
    A.gate(v, pressureOf(e));
  };
  const move = (e: RPE<SVGRectElement>) => {
    if (pointers.current.has(e.pointerId)) A.gate(v, pressureOf(e));
  };
  const up = (e: RPE<SVGRectElement>) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size === 0) A.gate(v, 0);
  };
  const lit = drone ? 1 : gate;
  const fade = ElmyraCore.envSeconds(env);
  return (
    <g className="pad">
      <rect x={x} y={y} width={w} height={h} rx={14} fill="url(#copper)" stroke="#000" strokeWidth={2} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} />
      {[0.25, 0.5, 0.75].map((f) => (
        <line key={f} x1={x + 14} x2={x + w - 14} y1={y + h * f} y2={y + h * f} stroke="#5a3417" strokeWidth={1.5} opacity={0.55} pointerEvents="none" />
      ))}
      <circle cx={x + w - 18} cy={y + 18} r={6} fill={ACCENT} pointerEvents="none" style={{ opacity: 0.12 + lit * 0.88, transition: `opacity ${fade.toFixed(3)}s linear`, filter: lit > 0.05 ? 'drop-shadow(0 0 6px #ff8a2a)' : 'none' }} />
      {drone && (
        <text x={x + 14} y={y + 24} className="lbl small" fill="#2b1608" pointerEvents="none">
          DRONE
        </text>
      )}
    </g>
  );
}

// ---------------------------------------------------------------- Voice strip
function VoiceStrip({ v, x0 }: { v: number; x0: number }) {
  const page = useParam(`v${v}.page`);
  const modp = useParam(`v${v}.modp`);
  const selected = useUi((s) => s.voice === v);
  const b = `v${v}.`;
  return (
    <g>
      <rect x={x0 + 6} y={276} width={243} height={428} rx={10} fill="none" stroke={selected ? '#6b5235' : LINE} strokeWidth={selected ? 2 : 1} />
      <text x={x0 + 22} y={300} className="sect" onPointerDown={() => A.selectVoice(v)}>
        VOICE {v}
      </text>
      <circle cx={x0 + 228} cy={295} r={4} fill={MODP_PROGRAMS[modp]?.color ?? '#333'} className="led on" style={{ color: MODP_PROGRAMS[modp]?.color }} />
      <Knob id={b + 'tune'} x={x0 + 66} y={350} label="TUNE" />
      <Knob id={b + 'mod'} x={x0 + 189} y={350} label="MOD" />
      <Knob id={b + 'wave'} x={x0 + 66} y={442} label="WAVE" />
      <Knob id={b + 'env'} x={x0 + 189} y={442} label="ENV" />
      <PanelButton x={x0 + 128} y={398} label="PG" led={PAGE_COLORS[page]} onPress={() => A.cyclePage(v)} onLong={() => A.toggleDrone(v)} />
      {['TUNE', 'GATE', 'ENV', 'MOD'].map((l, i) => (
        <Jack key={l} x={x0 + 46 + i * 54} y={505} label={l} />
      ))}
      <Pad v={v} x={x0 + 20} y={548} w={215} h={142} />
      <TapPoint id="T1" x={x0 + 232} y={322} voice={v} />
    </g>
  );
}

function Section({ x, y, w, h, title }: { x: number; y: number; w: number; h: number; title: string }) {
  return (
    <g pointerEvents="none">
      <rect x={x} y={y} width={w} height={h} rx={10} fill="none" stroke={LINE} />
      <text x={x + 12} y={y + 22} className="sect">
        {title}
      </text>
    </g>
  );
}

export function Panel() {
  const modp1 = useParam('v1.modp');
  const allSame = [2, 3, 4].every((v) => engine.store.get(`v${v}.modp`) === modp1);
  useParam('v2.modp');
  useParam('v3.modp');
  useParam('v4.modp');
  return (
    <svg className="panel" viewBox="0 0 1200 720" role="application" aria-label="Elmyra 2 Recreation panel">
      <defs>
        <radialGradient id="knobFace" cx="40%" cy="35%" r="70%">
          <stop offset="0%" stopColor="#4a4744" />
          <stop offset="100%" stopColor="#1c1b1a" />
        </radialGradient>
        <radialGradient id="btnFace" cx="40%" cy="35%" r="70%">
          <stop offset="0%" stopColor="#d9d3c4" />
          <stop offset="100%" stopColor="#8c8679" />
        </radialGradient>
        <linearGradient id="copper" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#d08a4e" />
          <stop offset="55%" stopColor="#a8622e" />
          <stop offset="100%" stopColor="#7c4520" />
        </linearGradient>
      </defs>
      <rect x={0} y={0} width={1200} height={720} rx={18} fill="#171615" />
      {/* screws */}
      {[
        [18, 18],
        [1182, 18],
        [18, 702],
        [1182, 702],
      ].map(([x, y]) => (
        <circle key={`${x}-${y}`} cx={x} cy={y} r={5} fill="#2b2926" stroke="#000" />
      ))}

      {/* Brand */}
      <text x={36} y={58} className="logo">
        Elmyra 2
      </text>
      <text x={38} y={80} className="logo2">
        RECREATION
      </text>

      {/* Master */}
      <Section x={26} y={100} w={112} h={160} title="MASTER" />
      <Knob id="master" x={82} y={170} label="VOL" />
      <TapPoint id="T6" x={124} y={118} />

      {/* LFOs */}
      <Section x={150} y={34} w={228} h={226} title="LFO" />
      <Knob id="lfo1.freq" x={198} y={110} r={20} label="LFO1" />
      <Knob id="lfo2.freq" x={264} y={110} r={20} label="LFO2" />
      <Knob id="lfo2.wav" x={330} y={110} r={20} label="WAV" />
      <Jack x={198} y={200} label="LFO1" />
      <Jack x={264} y={200} label="LFO2" />

      {/* Filter */}
      <Section x={390} y={34} w={156} h={226} title="FILTER" />
      <Knob id="filter.cutoff" x={432} y={120} label="CUTOFF" />
      <Knob id="filter.reso" x={506} y={120} label="RESO" />
      <Jack x={432} y={210} label="CUT" />
      <Jack x={506} y={210} label="RES" />

      {/* Delay */}
      <Section x={558} y={34} w={228} h={226} title="DELAY" />
      <Knob id="delay.time" x={604} y={120} label="TIME" />
      <Knob id="delay.fdbk" x={672} y={120} label="FDBK" />
      <Knob id="delay.mix" x={740} y={120} label="MIX" />
      <Jack x={604} y={210} label="TIME" />
      <Jack x={672} y={210} label="FDBK" />
      <TapPoint id="T4" x={772} y={52} />

      {/* OUCH */}
      <Section x={798} y={34} w={176} h={226} title="OUCH" />
      <Knob id="ouch.bite" x={846} y={110} label="BITE" />
      <Knob id="ouch.choke" x={926} y={110} label="CHOKE" />
      {['P', 'S', 'G', 'S', 'P'].map((l, i) => (
        <g key={i} className="inactive" pointerEvents="none">
          <rect x={820 + i * 28} y={190} width={10} height={10} fill="#0b0b0b" stroke="#777" />
          <rect x={820 + i * 28} y={214} width={10} height={10} fill="#0b0b0b" stroke="#777" />
          <text x={825 + i * 28} y={244} textAnchor="middle" className="lbl small">
            {l}
          </text>
        </g>
      ))}

      {/* Utilities */}
      <Section x={986} y={34} w={188} h={226} title="ATT · ADD" />
      <Knob id="att.out1" x={1030} y={104} r={16} label="OUT1" />
      <Knob id="att.out2" x={1092} y={104} r={16} label="OUT2" />
      <Knob id="add.in1" x={1030} y={186} r={16} label="IN1" />
      <Knob id="add.in2" x={1092} y={186} r={16} label="IN2" />
      <Jack x={1146} y={104} label="ATT" />
      <Jack x={1146} y={186} label="ADD" />

      {/* Left buttons */}
      <Jack x={112} y={318} label="CLK" />
      <PanelButton x={60} y={318} label="SYNC" onPress={A.notYet('SYNC', 3)} active={false} milestone={3} />
      <PanelButton x={60} y={404} label="MODP" led={allSame ? MODP_PROGRAMS[modp1]?.color : '#ffffff'} onPress={() => A.cycleModp()} />
      <PanelButton x={60} y={490} label="CHRM" onPress={A.notYet('CHRM', 2)} active={false} milestone={2} />
      <PanelButton x={60} y={576} label="REC" onPress={A.notYet('Sequencer REC', 3)} active={false} milestone={3} />
      <PanelButton x={60} y={662} label="PLAY" onPress={A.notYet('PLAY', 3)} active={false} milestone={3} />

      {/* Voices */}
      {[1, 2, 3, 4].map((v) => (
        <VoiceStrip key={v} v={v} x0={150 + (v - 1) * 255} />
      ))}

      <text x={1180} y={712} textAnchor="end" className="lbl small" fill={QUIET}>
        unofficial recreation · not affiliated with Neutral Labs
      </text>
    </svg>
  );
}
