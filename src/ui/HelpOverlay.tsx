import { useSyncExternalStore } from 'react';
import { BUILD_MILESTONE } from '../engine/params';
import { CODES, activeCodes, applyCode, type Bank } from './codes';
// `?` overlay: generated from the keymap table, plus live patch and code state.
import { BINDINGS, type Group } from './keymap';
import * as A from './actions';
import { ui, useUi } from './uiState';
import { engine } from '../engine/client';
import { MODP_PROGRAMS, NUM_VOICES } from '../engine/params';

let version = 0;
const useParamsVersion = () =>
  useSyncExternalStore(
    (l) =>
      engine.store.subscribeAll(() => {
        version++;
        l();
      }),
    () => version,
  );

const GROUPS: Group[] = ['Select', 'Adjust', 'Voice', 'Panel buttons', 'Commands'];

export function HelpOverlay() {
  const open = useUi((s) => s.helpOpen);
  const barForced = useUi((s) => s.barForced);
  // re-render while open so the palette reflects codes as they are applied
  useParamsVersion();
  if (!open) return null;
  const active = activeCodes();
  const modp = Array.from({ length: NUM_VOICES }, (_, i) => MODP_PROGRAMS[Math.round(engine.store.get(`v${i + 1}.modp`))].name);
  const drones = Array.from({ length: NUM_VOICES }, (_, i) => i + 1).filter((v) => engine.store.get(`v${v}.drone`) > 0.5);
  return (
    <div className="overlay" onPointerDown={(e) => e.target === e.currentTarget && A.toggleHelp(false)}>
      <div className="help" role="dialog" aria-label="Shortcuts and state">
        <header>
          <h2>Shortcuts</h2>
          <span className="grow" />
          <label className="toggle">
            <input type="checkbox" checked={barForced} onChange={(e) => ui.set({ barForced: e.target.checked })} /> show touch command bar
          </label>
          <button onClick={() => A.toggleHelp(false)}>Close</button>
        </header>
        <div className="help-cols">
          {GROUPS.map((g) => (
            <section key={g}>
              <h3>{g}</h3>
              <table>
                <tbody>
                  {BINDINGS.filter((b) => b.group === g).map((b) => (
                    <tr key={b.display + b.label} className={b.milestone > BUILD_MILESTONE ? 'later' : ''}>
                      <td>
                        <kbd>{b.display}</kbd>
                      </td>
                      <td>
                        {b.label}
                        {b.milestone > BUILD_MILESTONE && <span className="mtag-html">M{b.milestone}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ))}
          <section>
            <h3>Current state</h3>
            <table>
              <tbody>
                <tr>
                  <td>MODP</td>
                  <td>{modp.every((m) => m === modp[0]) ? modp[0] : modp.map((m, i) => `${i + 1}:${m}`).join(' ')}</td>
                </tr>
                <tr>
                  <td>Drone</td>
                  <td>{drones.length ? `voices ${drones.join(', ')}` : 'off'}</td>
                </tr>
                <tr>
                  <td>Patches</td>
                  <td>none (patching arrives in milestone 3)</td>
                </tr>
                <tr>
                  <td>Codes</td>
                  <td>{active.length ? active.map((c) => `${c.bank} ${c.code} (${c.group}: ${c.label})`).join(' · ') : 'all defaults'}</td>
                </tr>
                <tr>
                  <td>MIDI</td>
                  <td>milestone 3</td>
                </tr>
              </tbody>
            </table>
            <h3>Entering codes</h3>
            <p>Hold MODP (Tab) or CHRM (`), tap PG buttons 1–4 (or keys 1–4) as digits, then release. REC and PLAY flash when a code is accepted. Or tap a code below.</p>
            <h3>Touch</h3>
            <p>Drag a knob up or down; double-tap resets it. Hold a touch plate to play; with Apple Pencil, pressure sets the level. PG: tap for the next wavetable page, hold 1 s for drone mode.</p>
          </section>
        </div>
        <CodePalette />
      </div>
    </div>
  );
}

function CodePalette() {
  const banks: Bank[] = ['CHRM', 'MODP'];
  return (
    <div className="palette">
      {banks.map((bank) => {
        const groups = [...new Set(CODES.filter((c) => c.bank === bank).map((c) => c.group))];
        return (
          <section key={bank}>
            <h3>{bank} codes</h3>
            <div className="palette-groups">
              {groups.map((g) => (
                <div key={g} className="palette-group">
                  <span className="pg-name">{g}</span>
                  {CODES.filter((c) => c.bank === bank && c.group === g).map((c) => {
                    const on = c.milestone <= BUILD_MILESTONE && c.active?.();
                    return (
                      <button
                        key={c.code}
                        className={`code${on ? ' on' : ''}${c.milestone > BUILD_MILESTONE ? ' later' : ''}`}
                        title={`${bank} ${c.code}: ${c.label}`}
                        onClick={() => applyCode(bank, c.code)}
                      >
                        <b>{c.code}</b> {c.label}
                        {c.milestone > BUILD_MILESTONE && c.milestone < 99 && <span className="mtag-html">M{c.milestone}</span>}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
