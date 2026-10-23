import type { RealtimeChangeEvent } from './events';
import { REALTIME_TABLES, type RealtimeTable } from './tables';

export type RealtimeCallback = (event: RealtimeChangeEvent) => void;

export type ListenerRegistry = {
  /**
   * Adds a listener and returns its removal. `serverData` names a view that
   * shows data the document's server render produced: when the database
   * listener is already ready, the view hydrated after the join catch-up and
   * reads once now, because a write between that render and readiness reached
   * no listener.
   */
  subscribe: (table: RealtimeTable, callback: RealtimeCallback, serverData?: boolean) => () => void;
  dispatch: (event: RealtimeChangeEvent) => void;
  /** The catch-up of every current listener; `joined` records database readiness. */
  dispatchAll: (options?: { joined?: boolean }) => void;
  /** A closed or replaced channel: the next readiness catches up again. */
  leave: () => void;
};

function catchUpEvent(table: RealtimeTable): RealtimeChangeEvent {
  return { table, eventType: 'UPDATE', new: null, old: null };
}

/** The provider's listeners per table and its join state (client freshness contract). */
export function createListenerRegistry(): ListenerRegistry {
  const listeners = new Map(REALTIME_TABLES.map((table) => [table, new Set<RealtimeCallback>()]));
  let joined = false;
  return {
    subscribe: (table, callback, serverData = false) => {
      const tableListeners = listeners.get(table);
      tableListeners?.add(callback);
      if (serverData && joined) {
        queueMicrotask(() => {
          if (tableListeners?.has(callback)) callback(catchUpEvent(table));
        });
      }
      return () => {
        tableListeners?.delete(callback);
      };
    },
    // Every event identity reaches every listener; the hooks coalesce with the shared debounce.
    dispatch: (event) => listeners.get(event.table)?.forEach((callback) => callback(event)),
    dispatchAll: (options = {}) => {
      if (options.joined) joined = true;
      for (const [table, tableListeners] of listeners) {
        tableListeners.forEach((callback) => callback(catchUpEvent(table)));
      }
    },
    leave: () => {
      joined = false;
    },
  };
}
