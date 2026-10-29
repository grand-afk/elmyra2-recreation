// `?` overlay: generated from the keymap table, plus live patch and code state.
import { BINDINGS, type Group } from './keymap';
import * as A from './actions';
import { ui, useUi } from './uiState';
import { engine } from '../engine/client';
import { MODP_PROGRAMS, NUM_VOICES } from '../engine/params';

const GROUPS: Group[] = ['Select', 'Adjust', 'Voice', 'Panel buttons', 'Commands'];

export function HelpOverlay() {
  const open = useUi((s) => s.helpOpen);
  const barForced = useUi((s) => s.barForced);
  if (!open) return null;
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
                    <tr key={b.display + b.label} className={b.milestone > 1 ? 'later' : ''}>
                      <td>
                        <kbd>{b.display}</kbd>
                      </td>
                      <td>
                        {b.label}
                        {b.milestone > 1 && <span className="mtag-html">M{b.milestone}</span>}
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
                  <td>all defaults (code entry arrives in milestone 2)</td>
                </tr>
                <tr>
                  <td>MIDI</td>
                  <td>milestone 3</td>
                </tr>
              </tbody>
            </table>
            <h3>Touch</h3>
            <p>Drag a knob up or down; double-tap resets it. Hold a touch plate to play; with Apple Pencil, pressure sets the level. PG: tap for the next wavetable page, hold 1 s for drone mode.</p>
          </section>
        </div>
      </div>
    </div>
  );
}
