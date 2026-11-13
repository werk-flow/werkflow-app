/** A set of change listeners: `subscribe` adds one and answers its removal, `notify` calls every one. */
export function createListeners(): { subscribe: (listener: () => void) => () => void; notify: () => void } {
  const listeners = new Set<() => void>();
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    notify() {
      for (const listener of listeners) listener();
    },
  };
}
