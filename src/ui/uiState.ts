// App (non-audio) UI state: selection, open panels, scope settings. Tiny observable store.
import { useSyncExternalStore } from 'react';
import type { TapId } from '../engine/params';

export interface ScopeSettings {
  tap: TapId;
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
};

const listeners = new Set<() => void>();

export const ui = {
  get: () => state,
  set(patch: Partial<UiState> | ((s: UiState) => Partial<UiState>)) {
    const p = typeof patch === 'function' ? patch(state) : patch;
    state = { ...state, ...p };
    if (p.scope) {
      try {
        const { x, y, w, h, tap, msPerDiv, trigger, level, slope, gain } = state.scope;
        localStorage.setItem(SCOPE_KEY, JSON.stringify({ x, y, w, h, tap, msPerDiv, trigger, level, slope, gain }));
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
