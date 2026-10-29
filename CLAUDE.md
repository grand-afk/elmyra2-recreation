# Notes for Claude

- Source of truth for behaviour: the Elmyra 2 v2.4 user manual. Never decompile or copy firmware.
- Keep the panel branded "Elmyra 2 Recreation"; no Neutral Labs logo or wordmark.
- All DSP lives in `src/engine/core.ts` and must stay free of browser APIs so it runs in Node tests and offline renders.
- Every keyboard shortcut goes in `src/ui/keymap.ts`; the `?` overlay is generated from it. Every command also needs a touch route (command bar or panel).
- A feature is done only when its milestone acceptance test in the spec passes. Run `npm test` and `npm run build` before committing.
- Parameters not yet implemented carry their milestone in `params.ts`; the UI dims them automatically.
- Target: iPad Safari (landscape, with or without hardware keyboard). Web MIDI only on desktop Chrome/Edge.
