// App (non-audio) UI state: selection, open panels, scope settings. Tiny observable store.
import { useSyncExternalStore } from 'react';
import type { TapId } from '../engine/params';

export type ScopeView = 'wave' | 'spectrum';

export interface ScopeSettings {
  tap: TapId;
  view: ScopeView;
  coupling: 'ac' | 'dc';
  persistence: 0 | 1 | 2;
  lock: boolean;
  msPerDiv: number;
  trigger: 'auto' | 'normal' | 'single';
  level: number;
  slope: 'rise' | 'fall';
  gain: number;
  frozen: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface UiState {
  voice: number; // 1..4
  control: string | null; // param id currently selected for keyboard adjustment
  helpOpen: boolean;
  scopeOpen: boolean;
  scopePicking: boolean;
  scope: ScopeSettings;
  keyboardSeen: boolean;
  barForced: boolean;
  recording: boolean;
  recSeconds: number;
  toast: string | null;
  /** Code entry in progress (MODP or CHRM held). */
  codeEntry: { bank: 'MODP' | 'CHRM'; digits: string; consumed: boolean } | null;
  /** REC and PLAY LEDs flash until this time (code confirmed). */
  codeFlashUntil: number;
  drawerOpen: boolean;
  drawerOctave: number;
}

const SCOPE_KEY = 'e2r.scope';

function loadScope(): Partial<ScopeSettings> {
  try {
    const raw = localStorage.getItem(SCOPE_KEY);
    return raw ? (JSON.parse(raw) as Partial<ScopeSettings>) : {};
  } catch {
    return {};
  }
}

const scopeDefaults: ScopeSettings = {
  tap: 'T6',
  view: 'wave',
  coupling: 'dc',
  persistence: 0,
  lock: false,
  msPerDiv: 2,
  trigger: 'auto',
  level: 0,
  slope: 'rise',
  gain: 1,
  frozen: false,
  x: 80,
  y: 80,
  w: 420,
  h: 300,
};

let state: UiState = {
  voice: 1,
  control: null,
  helpOpen: false,
  scopeOpen: false,
  scopePicking: false,
  scope: { ...scopeDefaults, ...loadScope(), frozen: false },
  keyboardSeen: false,
  barForced: false,
  recording: false,
  recSeconds: 0,
  toast: null,
  codeEntry: null,
  codeFlashUntil: 0,
  drawerOpen: false,
  drawerOctave: 2,
};

const listeners = new Set<() => void>();

export const ui = {
  get: () => state,
  set(patch: Partial<UiState> | ((s: UiState) => Partial<UiState>)) {
    const p = typeof patch === 'function' ? patch(state) : patch;
    state = { ...state, ...p };
    if (p.scope) {
      try {
        const { frozen: _f, ...keep } = state.scope;
        void _f;
        localStorage.setItem(SCOPE_KEY, JSON.stringify(keep));
      } catch {
        /* storage unavailable: settings just won't persist */
      }
    }
    listeners.forEach((l) => l());
  },
  setScope(p: Partial<ScopeSettings>) {
    ui.set((s) => ({ scope: { ...s.scope, ...p } }));
  },
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  toast(msg: string) {
    ui.set({ toast: msg });
    window.setTimeout(() => {
      if (state.toast === msg) ui.set({ toast: null });
    }, 2200);
  },
};

export function useUi<T>(select: (s: UiState) => T): T {
  return useSyncExternalStore(ui.subscribe, () => select(state));
}
