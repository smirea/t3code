import { useSyncExternalStore } from "react";

/** The prompt pinned under the sticky line, and the width of its bubble in the timeline. */
export interface StickyPrompt {
  readonly rowId: string;
  readonly width: number | null;
}

/** Written from the scroll handler, read by the pinned copy without re-rendering the timeline. */
export interface StickyPromptStore {
  readonly get: () => StickyPrompt | null;
  readonly set: (next: StickyPrompt | null) => void;
  readonly subscribe: (listener: () => void) => () => void;
}

export function createStickyPromptStore(): StickyPromptStore {
  let current: StickyPrompt | null = null;
  const listeners = new Set<() => void>();
  return {
    get: () => current,
    set: (next) => {
      if (next?.rowId === current?.rowId && next?.width === current?.width) return;
      current = next;
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

export function useStickyPrompt(store: StickyPromptStore): StickyPrompt | null {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}
