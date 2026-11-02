import { useSyncExternalStore } from "react";
import { useAppStore } from "./appStore";
import { useCanvasStore } from "./canvasStore";
import { usePenStore } from "./penStore";
import { useSavedDesignsStore } from "./savedDesignsStore";
import { useCustomProblemsStore } from "./customProblemsStore";
import { useCustomComponentsStore } from "./customComponentsStore";
import { useTradeoffStore } from "./tradeoffStore";
import { useInterviewStore } from "./interviewStore";
import { useTutorialStore } from "./tutorialStore";

/**
 * All persisted stores use `skipHydration: true` so that the server render
 * and the first client render agree (no hydration mismatch). Call
 * `rehydrateAllStores()` once after mount (e.g. in AppShell's useEffect)
 * to load the persisted state from localStorage.
 */

let hasHydrated = false;
let rehydrationPromise: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function rehydrateAllStores(): Promise<void> {
  if (hasHydrated) return Promise.resolve();
  if (rehydrationPromise) return rehydrationPromise;

  const results: (void | Promise<void>)[] = [
    useAppStore.persist.rehydrate(),
    useCanvasStore.persist.rehydrate(),
    usePenStore.persist.rehydrate(),
    useSavedDesignsStore.persist.rehydrate(),
    useCustomProblemsStore.persist.rehydrate(),
    useCustomComponentsStore.persist.rehydrate(),
    useTradeoffStore.persist.rehydrate(),
    useInterviewStore.persist.rehydrate(),
    useTutorialStore.persist.rehydrate(),
  ];
  rehydrationPromise = Promise.all(results.map((r) => Promise.resolve(r))).then(() => {
    hasHydrated = true;
    emit();
  }).finally(() => {
    rehydrationPromise = null;
  });
  return rehydrationPromise;
}

export function areStoresHydrated(): boolean {
  return hasHydrated;
}

/**
 * Returns false on the server and until `rehydrateAllStores()` has
 * completed on the client; true afterwards. Use it to gate UI that must
 * only render persisted state.
 */
export function useHasHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => hasHydrated,
    () => false
  );
}
