// The instrument panel, drawn as one SVG so it scales cleanly on any screen.
// Positions are taken from a front-panel photo of the desktop unit: the viewBox uses the
// photo's own pixel coordinates (panel area x 140..1780, y 62..1062), so a control can be
// checked against the photo by its numbers alone.
import { memo, useEffect, useRef, useState, type PointerEvent as RPE } from 'react';
import { engine } from '../engine/client';
import { MODP_PROGRAMS, paramDef, type TapId } from '../engine/params';
import * as A from './actions';
import { useParam } from './hooks';
import { useUi } from './uiState';

const GOLD = '#d9bf86';
const TRACE = '#a88a4f';
const WHITE = '#f2f0ea';
const ACCENT = '#ff8a2a';
const PAGE_COLORS = ['#ff4d4d', '#4dd17a', '#4d8dff', '#ffd84d'];

const VIEWBOX = '130 52 1660 1020';

/**
 * Static backdrop drawn once in its own layer: glossy black PCB with a faint sheen and
 * fine texture, and black hex bolts. Kept separate so knob moves never repaint it.
 */
const Backdrop = memo(function Backdrop() {
  const bolts: [number, number][] = [
    [200, 76],
    [1716, 76],
    [200, 1026],
    [1716, 1026],
  ];
  return (
    <svg className="panel-bg" viewBox={VIEWBOX} aria-hidden>
      <defs>
        <linearGradient id="pcb" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#151515" />
          <stop offset="50%" stopColor="#0c0c0c" />
          <stop offset="100%" stopColor="#090909" />
        </linearGradient>
        <linearGradient id="sheen" x1="0" y1="0" x2="1" y2="0.6">
          <stop offset="0%" stopColor="#fff" stopOpacity={0} />
          <stop offset="38%" stopColor="#fff" stopOpacity={0} />
          <stop offset="50%" stopColor="#fff" stopOpacity={0.045} />
          <stop offset="62%" stopColor="#fff" stopOpacity={0} />
          <stop offset="100%" stopColor="#fff" stopOpacity={0} />
        </linearGradient>
        <radialGradient id="topLight" cx="35%" cy="10%" r="80%">
          <stop offset="0%" stopColor="#fff" stopOpacity={0.05} />
          <stop offset="100%" stopColor="#fff" stopOpacity={0} />
        </radialGradient>
        <filter id="grain" x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves={2} seed={7} />
          <feColorMatrix type="saturate" values="0" />
          <feComponentTransfer>
            <feFuncA type="linear" slope="0.05" />
          </feComponentTransfer>
          <feComposite in2="SourceGraphic" operator="in" />
        </filter>
        <radialGradient id="boltHead" cx="40%" cy="35%" r="70%">
          <stop offset="0%" stopColor="#3a3a3a" />
          <stop offset="100%" stopColor="#0a0a0a" />
        </radialGradient>
      </defs>
      <rect x={136} y={60} width={1648} height={1008} rx={12} fill="#000" opacity={0.6} />
      <rect x={140} y={62} width={1640} height={1000} rx={10} fill="url(#pcb)" />
      <rect x={140} y={62} width={1640} height={1000} rx={10} fill="#fff" filter="url(#grain)" />
      <rect x={140} y={62} width={1640} height={1000} rx={10} fill="url(#topLight)" />
      <rect x={140} y={62} width={1640} height={1000} rx={10} fill="url(#sheen)" />
      <rect x={141} y={63} width={1638} height={998} rx={10} fill="none" stroke="#2a2a2a" strokeWidth={2} />
      {bolts.map(([x, y]) => {
        const hex = Array.from({ length: 6 }, (_, i) => {
          const a = (Math.PI / 3) * i + Math.PI / 6;
          return `${x + Math.cos(a) * 16},${y + Math.sin(a) * 16}`;
        }).join(' ');
        return (
          <g key={`${x}-${y}`}>
            <circle cx={x + 2} cy={y + 3} r={18} fill="#000" opacity={0.7} />
            <circle cx={x} cy={y} r={18} fill="#050505" stroke="#1d1d1d" strokeWidth={1.5} />
            <polygon points={hex} fill="url(#boltHead)" stroke="#000" strokeWidth={1.5} />
            <path d={`M${x - 12} ${y - 9}L${x + 4} ${y - 15}`} stroke="#fff" strokeOpacity={0.18} strokeWidth={2} strokeLinecap="round" />
            <circle cx={x} cy={y} r={6} fill="#020202" />
          </g>
        );
      })}
    </svg>
  );
});

/** Original acid-house smiley, drawn in the panel's gold. */
function AcidFace({ cx, cy, r }: { cx: number; cy: number; r: number }) {
  return (
    <g pointerEvents="none" filter="url(#print)" stroke="url(#goldTitle)" fill="none" strokeLinecap="round">
      <circle cx={cx} cy={cy} r={r} strokeWidth={6} />
      <ellipse cx={cx - r * 0.33} cy={cy - r * 0.22} rx={r * 0.1} ry={r * 0.2} fill="url(#goldTitle)" stroke="none" />
      <ellipse cx={cx + r * 0.33} cy={cy - r * 0.22} rx={r * 0.1} ry={r * 0.2} fill="url(#goldTitle)" stroke="none" />
      <path d={`M${cx - r * 0.58} ${cy + r * 0.12}Q${cx} ${cy + r * 0.85} ${cx + r * 0.58} ${cy + r * 0.12}`} strokeWidth={6} />
      <path d={`M${cx - r * 0.66} ${cy + r * 0.02}L${cx - r * 0.5} ${cy + r * 0.24}M${cx + r * 0.66} ${cy + r * 0.02}L${cx + r * 0.5} ${cy + r * 0.24}`} strokeWidth={5} />
    </g>
  );
}

/** Horizontal offset of each voice from voice 1 (from the jack row in the photo). */
const VOICE_DX = [0, 283, 563, 846];

// ---------------------------------------------------------------- Knob
function Knob({ id, x, y, size = 'small' }: { id: string; x: number; y: number; size?: 'small' | 'big' }) {
  const value = useParam(id);
  const def = paramDef(id);
  const active = def.milestone <= 1;
  const selected = useUi((s) => s.control === id);
  const drag = useRef<{ y: number; v: number; pid: number } | null>(null);
  const lastTap = useRef(0);
  const [dragging, setDragging] = useState(false);
  const r = size === 'big' ? 46 : 19;

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
    const range = e.altKey ? 1200 : 240; // screen px for full travel
    engine.store.set(id, d.v + (d.y - e.clientY) / range);
  };
  const onUp = () => {
    drag.current = null;
    setDragging(false);
  };

  const ang = ((-135 + value * 270 - 90) * Math.PI) / 180;
  const p = (f: number) => [x + Math.cos(ang) * r * f, y + Math.sin(ang) * r * f];
  const [x0, y0] = p(size === 'big' ? 0.3 : 0.15);
  const [x1, y1] = p(0.92);
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
      <circle cx={x} cy={y} r={r + 16} fill="transparent" />
      {size === 'small' && <circle cx={x} cy={y} r={r + 7} fill="none" stroke={TRACE} strokeWidth={3} />}
      {size === 'big' && <circle cx={x + 4} cy={y + 6} r={r + 2} fill="#000" opacity={0.6} />}
      {size === 'big' && <circle cx={x} cy={y} r={r + 4} fill="#0a0a0a" stroke="#262626" strokeWidth={5} strokeDasharray="3 4" />}
      <circle cx={x} cy={y} r={r} fill={size === 'big' ? 'url(#bigKnob)' : 'url(#smallKnob)'} stroke={selected ? ACCENT : '#2a2a2a'} strokeWidth={selected ? 4 : 1.5} />
      <ellipse cx={x - r * 0.25} cy={y - r * 0.35} rx={r * 0.55} ry={r * 0.3} fill="url(#knobSheen)" pointerEvents="none" />
      <line x1={x0} y1={y0} x2={x1} y2={y1} stroke={WHITE} strokeWidth={size === 'big' ? 9 : 4.5} strokeLinecap="round" />
      {!active && (
        <text x={x + r + 4} y={y - r + 4} className="mtag">
          M{def.milestone}
        </text>
      )}
      {dragging && (
        <text x={x} y={y - r - 14} textAnchor="middle" className="val">
          {Math.round(value * 100)}
        </text>
      )}
    </g>
  );
}

// ---------------------------------------------------------------- Jack (decorative until patching, M3)
function Jack({ x, y }: { x: number; y: number }) {
  return (
    <g pointerEvents="none">
      <circle cx={x + 2} cy={y + 3} r={26} fill="#000" opacity={0.5} />
      <circle cx={x} cy={y} r={25} fill="url(#jackNut)" stroke="#6d6d69" strokeWidth={2.5} strokeDasharray="1.6 2.2" />
      <circle cx={x} cy={y} r={15} fill="#9a9a96" />
      <circle cx={x} cy={y} r={11} fill="#050505" />
    </g>
  );
}

/** White boxed label, as printed above jacks and knobs. */
function Label({ x, y, text }: { x: number; y: number; text: string }) {
  const w = text.length * 12 + 12;
  return (
    <g pointerEvents="none">
      <rect x={x - w / 2} y={y - 12} width={w} height={22} rx={4} fill="#ecebe5" filter="url(#print)" />
      <text x={x} y={y + 5} textAnchor="middle" className="plbl" filter="url(#print)">
        {text}
      </text>
    </g>
  );
}

/** Big gold section word. */
function Title({ x, y, text, size = 56, rotate = 0 }: { x: number; y: number; text: string; size?: number; rotate?: number }) {
  return (
    <text x={x} y={y} className="ptitle" fill="url(#goldTitle)" filter="url(#print)" fontSize={size} transform={rotate ? `rotate(${rotate} ${x} ${y})` : undefined} pointerEvents="none">
      {text}
    </text>
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
      <circle cx={x} cy={y} r={22} fill="transparent" />
      <circle cx={x} cy={y} r={9} className="tapdot" />
      <text x={x + 14} y={y - 12} className="taplbl">
        {id}
      </text>
    </g>
  );
}

// ---------------------------------------------------------------- Panel button with LED window
function PanelButton({ x, y, label, led, ledAt, red, onPress, onLong, active = true, milestone }: {
  x: number;
  y: number;
  label: string;
  led?: string | null;
  ledAt: [number, number];
  red?: boolean;
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
    <g>
      <rect x={ledAt[0] - 10} y={ledAt[1] - 10} width={20} height={20} fill={led ?? '#2b2a22'} className={led ? 'led on' : 'led'} style={led ? { color: led } : undefined} pointerEvents="none" />
      <g className={`btn${active ? '' : ' inactive'}`} onPointerDown={down} onPointerUp={up} onPointerCancel={() => timer.current && clearTimeout(timer.current)}>
        <circle cx={x} cy={y} r={30} fill="transparent" />
        <circle cx={x} cy={y} r={22} fill={red ? 'url(#redBtn)' : '#0b0b0b'} stroke={red ? '#7a1010' : '#3a3a3a'} strokeWidth={2} />
        {!active && milestone && (
          <text x={x + 22} y={y - 18} className="mtag">
            M{milestone}
          </text>
        )}
      </g>
      <Label x={x - 32} y={y + 45} text={label} />
    </g>
  );
}

// ---------------------------------------------------------------- Touch plates
/**
 * Two brushed-metal discs bridged by a translucent strip. The voice's LED sits behind the
 * PCB under the strip, its brightness following the envelope (= volume), as on the hardware.
 */
function TouchPlates({ v, a, b }: { v: number; a: [number, number]; b: [number, number] }) {
  const drone = useParam(`v${v}.drone`) > 0.5;
  const pointers = useRef(new Set<number>());
  const glow = useRef<SVGGElement>(null);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      if (glow.current) glow.current.style.opacity = String(Math.min(1, engine.envLevels[v - 1] * 1.15));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [v]);

  const pressureOf = (e: RPE<SVGElement>) => {
    if (e.pointerType === 'pen' && e.pressure > 0) return Math.min(1, 0.15 + e.pressure);
    if (e.pointerType === 'touch' && e.width > 1) return Math.min(1, Math.max(0.45, (e.width - 8) / 40));
    return 1;
  };
  const down = (e: RPE<SVGElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.add(e.pointerId);
    A.selectVoice(v);
    A.gate(v, pressureOf(e));
  };
  const move = (e: RPE<SVGElement>) => {
    if (pointers.current.has(e.pointerId)) A.gate(v, pressureOf(e));
  };
  const up = (e: RPE<SVGElement>) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size === 0) A.gate(v, 0);
  };
  const handlers = { onPointerDown: down, onPointerMove: move, onPointerUp: up, onPointerCancel: up };
  const strip = `M${a[0]} ${a[1]}L${b[0]} ${b[1]}`;
  const R = 46;
  return (
    <g className="pad">
      <g pointerEvents="none">
        <path d={strip} stroke="#2b3020" strokeWidth={70} strokeLinecap="round" />
        <path d={strip} stroke="#3a4229" strokeWidth={58} strokeLinecap="round" opacity={0.7} />
        <g ref={glow} style={{ opacity: 0 }}>
          <path d={strip} stroke="#ffd98a" strokeWidth={62} strokeLinecap="round" filter="url(#ledBlur)" />
          <path d={strip} stroke="#fff4d6" strokeWidth={26} strokeLinecap="round" opacity={0.8} filter="url(#ledBlur)" />
        </g>
        {[a, b].map(([x, y], i) => (
          <g key={i}>
            <circle cx={x + 3} cy={y + 5} r={R + 1} fill="#000" opacity={0.55} />
            <circle cx={x} cy={y} r={R} fill="url(#disc)" stroke="#8d8d88" strokeWidth={1.5} />
            <circle cx={x} cy={y} r={R - 1} fill="#fff" filter="url(#brushed)" opacity={0.35} />
            <ellipse cx={x - 12} cy={y - 16} rx={24} ry={12} fill="#fff" opacity={0.22} />
          </g>
        ))}
        {drone && (
          <text x={(a[0] + b[0]) / 2} y={Math.min(a[1], b[1]) - 56} textAnchor="middle" className="ptitle" fontSize={18} fill="url(#goldTitle)">
            DRONE
          </text>
        )}
      </g>
      {/* hit area: both discs and the bridge */}
      <path d={strip} stroke="transparent" strokeWidth={96} strokeLinecap="round" {...handlers} />
    </g>
  );
}

// ---------------------------------------------------------------- Voice
function Voice({ v }: { v: number }) {
  const dx = VOICE_DX[v - 1];
  const page = useParam(`v${v}.page`);
  const modp = useParam(`v${v}.modp`);
  const selected = useUi((s) => s.voice === v);
  const b = `v${v}.`;
  const X = (x: number) => x + dx;
  // Voices 1-2 have the lower disc on the left; voices 3-4 are mirrored, as on the panel.
  const plates: [[number, number], [number, number]] = v <= 2 ? [[X(390), 960], [X(495), 908]] : [[X(392), 905], [X(492), 955]];
  return (
    <g>
      {/* gold traces; the bar count marks the voice number */}
      <g stroke={selected ? GOLD : TRACE} strokeWidth={selected ? 4 : 3} fill="none" pointerEvents="none">
        <path d={`M${X(312)} 448H${X(572)}`} />
        <path d={`M${X(445)} 448V812`} />
        <path d={`M${X(395)} 700H${X(495)}`} />
        <path d={`M${X(395)} 812H${X(500)}`} />
        <path d={`M${X(400)} 557H${X(445)}`} />
      </g>
      {Array.from({ length: v }, (_, i) => (
        <rect key={i} x={X(455) + i * 11} y={560} width={6} height={128} fill={selected ? GOLD : TRACE} pointerEvents="none" />
      ))}
      {['GATE', 'MOD', 'WAV', 'ENV'].map((l, i) => (
        <g key={l}>
          <Label x={X(337) + i * 70} y={375} text={l} />
          <Jack x={X(337) + i * 70} y={430} />
        </g>
      ))}
      <Label x={X(375)} y={493} text="TUNE" />
      <Jack x={X(372)} y={557} />
      <Knob id={b + 'tune'} x={X(515)} y={550} size="big" />
      <Label x={X(375)} y={643} text="MOD" />
      <Knob id={b + 'mod'} x={X(370)} y={700} />
      <Label x={X(518)} y={643} text="WAV" />
      <Knob id={b + 'wave'} x={X(515)} y={700} />
      <Label x={X(375)} y={757} text="ENV" />
      <Knob id={b + 'env'} x={X(368)} y={812} />
      <g className="btn" onPointerDown={() => A.selectVoice(v)}>
        <PgButton v={v} x={X(518)} y={812} color={PAGE_COLORS[page]} />
      </g>
      <Label x={X(556)} y={842} text="PG" />
      <circle cx={X(560)} cy={493} r={5} fill={MODP_PROGRAMS[modp]?.color ?? '#333'} className="led on" style={{ color: MODP_PROGRAMS[modp]?.color }} pointerEvents="none" />
      <TouchPlates v={v} a={plates[0]} b={plates[1]} />
      <TapPoint id="T1" x={X(440)} y={493} voice={v} />
    </g>
  );
}

/** PG: tap = next wavetable page, hold 1 s = drone. Ring colour shows the page. */
function PgButton({ v, x, y, color }: { v: number; x: number; y: number; color: string }) {
  const timer = useRef<number | null>(null);
  const longFired = useRef(false);
  return (
    <g
      onPointerDown={() => {
        longFired.current = false;
        timer.current = window.setTimeout(() => {
          longFired.current = true;
          A.toggleDrone(v);
        }, 1000);
      }}
      onPointerUp={() => {
        if (timer.current) clearTimeout(timer.current);
        if (!longFired.current) A.cyclePage(v);
      }}
      onPointerCancel={() => timer.current && clearTimeout(timer.current)}
    >
      <circle cx={x} cy={y} r={28} fill="transparent" />
      <circle cx={x} cy={y} r={22} fill="none" stroke={color} strokeWidth={3} className="led on" style={{ color }} />
      <circle cx={x} cy={y} r={18} fill="#0b0b0b" stroke="#3a3a3a" strokeWidth={1.5} />
    </g>
  );
}

export function Panel() {
  const modp1 = useParam('v1.modp');
  const m2 = useParam('v2.modp');
  const m3 = useParam('v3.modp');
  const m4 = useParam('v4.modp');
  const allSame = m2 === modp1 && m3 === modp1 && m4 === modp1;
  return (
    <div className="panel-wrap">
    <Backdrop />
    <svg className="panel" viewBox={VIEWBOX} role="application" aria-label="Elmyra 2 Recreation panel">
      <defs>
        <radialGradient id="bigKnob" cx="45%" cy="40%" r="65%">
          <stop offset="0%" stopColor="#2a2a2a" />
          <stop offset="70%" stopColor="#111" />
          <stop offset="100%" stopColor="#050505" />
        </radialGradient>
        <radialGradient id="jackNut" cx="40%" cy="35%" r="70%">
          <stop offset="0%" stopColor="#f4f4f0" />
          <stop offset="60%" stopColor="#b9b9b4" />
          <stop offset="100%" stopColor="#6d6d69" />
        </radialGradient>
        <radialGradient id="disc" cx="40%" cy="35%" r="75%">
          <stop offset="0%" stopColor="#f1f1ec" />
          <stop offset="55%" stopColor="#cfcfc9" />
          <stop offset="100%" stopColor="#9d9d97" />
        </radialGradient>
        <radialGradient id="redBtn" cx="40%" cy="35%" r="70%">
          <stop offset="0%" stopColor="#ff5a4a" />
          <stop offset="100%" stopColor="#a3140f" />
        </radialGradient>
        <radialGradient id="smallKnob" cx="40%" cy="35%" r="70%">
          <stop offset="0%" stopColor="#262626" />
          <stop offset="100%" stopColor="#070707" />
        </radialGradient>
        <radialGradient id="knobSheen" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#fff" stopOpacity={0.16} />
          <stop offset="100%" stopColor="#fff" stopOpacity={0} />
        </radialGradient>
        <linearGradient id="goldTitle" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ecd6a0" />
          <stop offset="55%" stopColor="#d4b679" />
          <stop offset="100%" stopColor="#b8965a" />
        </linearGradient>
        <filter id="print" x="-5%" y="-20%" width="110%" height="140%">
          <feGaussianBlur stdDeviation="0.45" />
        </filter>
        <filter id="brushed" x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.004 0.6" numOctaves={2} seed={4} />
          <feColorMatrix type="saturate" values="0" />
          <feComposite in2="SourceGraphic" operator="in" />
        </filter>
        <filter id="ledBlur" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="9" />
        </filter>
      </defs>
      {/* ---- Audio, master ---- */}
      <Title x={188} y={360} text="AUDIO" size={44} rotate={-90} />
      <Jack x={215} y={195} />
      <path d="M245 165V128M233 140L245 126L257 140" stroke={WHITE} strokeWidth={5} fill="none" pointerEvents="none" />
      <path d="M243 195H262" stroke={TRACE} strokeWidth={3} pointerEvents="none" />
      <Knob id="master" x={295} y={195} />
      <Jack x={215} y={295} />
      <path d="M290 322H252M264 310L250 322L264 334" stroke={WHITE} strokeWidth={5} fill="none" pointerEvents="none" />
      <TapPoint id="T6" x={215} y={150} />

      {/* ---- Clock + SEQ buttons ---- */}
      <Jack x={215} y={400} />
      <path d="M215 428V455" stroke={TRACE} strokeWidth={3} pointerEvents="none" />
      <PanelButton x={215} y={500} label="SYNC" ledAt={[243, 462]} onPress={A.notYet('SYNC', 3)} active={false} milestone={3} />
      <PanelButton x={215} y={605} label="MODP" ledAt={[243, 568]} led={allSame ? MODP_PROGRAMS[modp1]?.color : '#ffffff'} onPress={() => A.cycleModp()} />
      <PanelButton x={215} y={708} label="CHRM" ledAt={[243, 672]} onPress={A.notYet('CHRM', 2)} active={false} milestone={2} />
      <PanelButton x={215} y={812} label="REC" ledAt={[243, 852]} red onPress={A.notYet('Sequencer REC', 3)} active={false} milestone={3} />
      <PanelButton x={215} y={912} label="PLAY" ledAt={[243, 955]} onPress={A.notYet('PLAY', 3)} active={false} milestone={3} />
      <Title x={312} y={945} text="SEQ" size={44} rotate={-90} />

      {/* ---- Delay ---- */}
      {[
        ['TIME', 390, 'delay.time'],
        ['FDBK', 490, 'delay.fdbk'],
        ['MIX', 590, 'delay.mix'],
      ].map(([l, x, id]) => (
        <g key={l as string}>
          <Label x={x as number} y={133} text={l as string} />
          <Jack x={x as number} y={195} />
          <Knob id={id as string} x={(x as number) - 3} y={295} />
        </g>
      ))}
      <Title x={378} y={270} text="DELAY" size={62} />
      <TapPoint id="T4" x={660} y={300} />

      {/* ---- LPF ---- */}
      <Label x={693} y={135} text="RESO" />
      <Jack x={693} y={197} />
      <Knob id="filter.reso" x={782} y={278} size="big" />
      <Label x={912} y={135} text="CUTOFF" />
      <Jack x={910} y={197} />
      <Knob id="filter.cutoff" x={995} y={272} size="big" />
      <Title x={738} y={150} text="LPF" size={78} rotate={52} />

      {/* ---- OUCH ---- */}
      <Label x={1125} y={137} text="CHOKE" />
      <Jack x={1125} y={200} />
      <Knob id="ouch.choke" x={1128} y={300} />
      <Label x={1227} y={137} text="BITE" />
      <Jack x={1227} y={200} />
      <Knob id="ouch.bite" x={1222} y={300} />
      <Title x={1085} y={270} text="OUCH" size={62} />
      <g pointerEvents="none" className="inactive">
        {[168, 212].map((y) => (
          <rect key={y} x={1290} y={y - 9} width={118} height={18} rx={9} fill="#050505" stroke={GOLD} strokeWidth={2} />
        ))}
        <text x={1349} y={196} textAnchor="middle" className="ptitle" fill="url(#goldTitle)" fontSize={13} letterSpacing={6}>
          PSGSP
        </text>
      </g>

      {/* ---- Brand (replaces the maker's logo) ---- */}
      <AcidFace cx={1478} cy={190} r={44} />
      <text x={1478} y={296} textAnchor="middle" className="brand" filter="url(#print)">
        ELMYRA 2
      </text>
      <text x={1478} y={326} textAnchor="middle" className="brand2" fill="url(#goldTitle)" filter="url(#print)">
        RECREATION
      </text>

      {/* ---- LFO 1 ---- */}
      <Label x={1600} y={148} text="FREQ" />
      <Jack x={1600} y={200} />
      <Label x={1700} y={148} text="OUT" />
      <Jack x={1700} y={200} />
      <Knob id="lfo1.freq" x={1615} y={285} />
      <Title x={1650} y={350} text="LFO" size={58} rotate={-45} />

      {/* ---- LFO 2 ---- */}
      <Label x={1505} y={353} text="WAV" />
      <Jack x={1505} y={410} />
      <Label x={1600} y={353} text="FREQ" />
      <Jack x={1600} y={410} />
      <Label x={1700} y={353} text="OUT" />
      <Jack x={1700} y={410} />
      <Knob id="lfo2.wav" x={1512} y={495} />
      <Knob id="lfo2.freq" x={1615} y={495} />
      <Title x={1650} y={565} text="LFO" size={58} rotate={-45} />

      {/* ---- ADD ---- */}
      <Label x={1505} y={565} text="IN" />
      <Jack x={1505} y={620} />
      <Label x={1600} y={565} text="IN" />
      <Jack x={1600} y={620} />
      <Label x={1700} y={565} text="OUT" />
      <Jack x={1700} y={620} />
      <Knob id="add.in1" x={1512} y={708} />
      <Knob id="add.in2" x={1612} y={708} />
      <Title x={1612} y={688} text="ADD" size={50} />

      {/* ---- ATT ---- */}
      <Label x={1505} y={777} text="IN" />
      <Jack x={1505} y={830} />
      <Label x={1600} y={777} text="OUT" />
      <Jack x={1600} y={828} />
      <Label x={1700} y={777} text="OUT" />
      <Jack x={1700} y={828} />
      <Knob id="att.out1" x={1606} y={922} />
      <Knob id="att.out2" x={1710} y={922} />
      <Title x={1452} y={895} text="ATT" size={50} />

      {/* ---- Voices ---- */}
      {[1, 2, 3, 4].map((v) => (
        <Voice key={v} v={v} />
      ))}

      <text x={1770} y={1054} textAnchor="end" className="disclaimer">
        unofficial recreation · not affiliated with Neutral Labs
      </text>
    </svg>
    </div>
  );
}
