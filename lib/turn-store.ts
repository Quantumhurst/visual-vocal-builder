// A synchronous store around the turn machine — pure, unit-testable.
//
// Canvas reads turn flags synchronously from inside timers, audio
// callbacks and socket handlers, where React state would be stale. The
// store keeps the current TurnState readable at any moment (get), applies
// events immediately (dispatch), and notifies subscribers so the screen
// re-renders (components/hooks/useTurnStore.ts).

import { INITIAL_TURN, turnReducer, type TurnEvent, type TurnState } from "./turn-machine.ts";

export type TurnStore = {
  get: () => TurnState;
  dispatch: (event: TurnEvent) => TurnState;
  subscribe: (listener: () => void) => () => void;
};

export function createTurnStore(initial: TurnState = INITIAL_TURN): TurnStore {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    dispatch: (event) => {
      const next = turnReducer(state, event);
      if (next !== state) {
        state = next;
        for (const listener of [...listeners]) listener();
      }
      return state;
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
