import { useSyncExternalStore } from "react";

/**
 * The row id of the prompt pinned under the top nav. The pinned copy and the timeline row both
 * read this one value, so a prompt is never drawn twice.
 */
export interface StickyPromptStore {
  readonly get: () => string | null;
  readonly set: (rowId: string | null) => void;
  readonly subscribe: (listener: () => void) => () => void;
}

export function createStickyPromptStore(): StickyPromptStore {
  let rowId: string | null = null;
  const listeners = new Set<() => void>();
  return {
    get: () => rowId,
    set: (next) => {
      if (next === rowId) return;
      rowId = next;
      for (const listener of listeners) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export function useStuckPromptRowId(store: StickyPromptStore): string | null {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}

export function useIsStuckPrompt(store: StickyPromptStore, rowId: string): boolean {
  const isStuck = () => store.get() === rowId;
  return useSyncExternalStore(store.subscribe, isStuck, isStuck);
}
