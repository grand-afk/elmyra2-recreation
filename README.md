# Elmyra 2 Recreation

A browser recreation of a 4-voice microtonal drone synthesizer, built for learning (every stage of the signal path can be probed with a scope), for recording WAV output, and as a test of how far Claude can get from a user manual alone.

**Unofficial, personal, non-commercial.** Not affiliated with or endorsed by Neutral Labs. No firmware code is used: the DSP is written from the v2.4 user manual's description of behaviour and tuned by ear against real hardware.

## Status: milestone 1

| Area | State |
|---|---|
| Voices | 4 voices, band-limited wavetables (4 pages × 8 waves), TUNE / MOD / WAVE / ENV, touch envelope, drone mode |
| MODP | DETUNE and SUBOSC (others arrive in milestone 3) |
| Signal path | Mix saturation → (filter: M4) → delay (TIME, FDBK, MIX) → OUCH (BITE, CHOKE) → master |
| Scope | Movable, resizable frame; taps T1 (any voice), T4 (after delay), T6 (master); timebase, trigger mode/level/slope, gain, freeze |
| Recording | 24-bit WAV via the iOS share sheet or a download |
| Help | `?` overlay generated from the keymap |
| Meter | Audio-thread load estimate and audio memory |

Controls for later milestones are drawn on the panel but dimmed, tagged with their milestone (M2–M5).

## Use

- **iPad / iPhone:** open the GitHub Pages URL in Safari, tap to start audio, and optionally Share → Add to Home Screen.
- **Keyboard:** press `?` for every shortcut. Plain letters select a control, ←/→ adjust it, digits 1–4 select a voice (press again and hold to play its pad), Shift+letter runs commands.
- **Touch:** drag knobs vertically (double-tap resets), hold the copper pads to play, tap PG for the next page and hold it 1 s for drone mode.

## Develop

```bash
npm install
npm run dev        # local dev server
npm test           # DSP and WAV unit tests
npm run render     # offline render of a demo patch to out/demo.wav, with a real-time factor
npm run build      # production build to dist/
```

Pushing to `main` deploys to GitHub Pages (Settings → Pages → Source: GitHub Actions).

## Layout

```
src/engine/params.ts      parameter table + UI↔worklet messages
src/engine/wavetables.ts  band-limited table bank (inverse FFT)
src/engine/core.ts        all DSP, pure TypeScript (runs in worklet, Node and tests)
src/engine/worklet.ts     AudioWorklet wrapper: scope taps, recorder feed, load stats
src/engine/client.ts      main-thread engine, parameter store
src/ui/keymap.ts          the one keymap table (drives keys and the ? overlay)
src/ui/*.tsx              panel, scope, help overlay, command bar
```

The full spec lives in the project's Claude doc ("Elmyra 2 Web Emulator — Spec").
