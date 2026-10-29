import { useSyncExternalStore } from 'react';
import { engine } from '../engine/client';

export function useParam(id: string): number {
  return useSyncExternalStore(
    (l) => engine.store.subscribe(id, l),
    () => engine.store.get(id),
  );
}
