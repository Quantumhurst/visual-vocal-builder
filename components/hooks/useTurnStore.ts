"use client";

// The turn machine (lib/turn-machine.ts) for a component: a store whose
// state is readable synchronously (store.get) from timers and audio
// callbacks, and a `state` value that re-renders the screen on change.

import { useState, useSyncExternalStore } from "react";
import { createTurnStore, type TurnStore } from "../../lib/turn-store";
import type { TurnState } from "../../lib/turn-machine";

export function useTurnStore(): { store: TurnStore; state: TurnState } {
  const [store] = useState(createTurnStore);
  const state = useSyncExternalStore(store.subscribe, store.get, store.get);
  return { store, state };
}
