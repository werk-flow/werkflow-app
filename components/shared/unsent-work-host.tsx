'use client';

import { Fragment, useSyncExternalStore, type ReactNode } from 'react';

// Where the unsent-work question renders (unsent-work-prompt.tsx). The root
// layout mounts this host on every page, inside the app shell and outside it,
// so the lazy question needs no React root of its own. A lazy module that
// imports `react-dom/client` makes the bundler cut React's DOM renderer out of
// the start-up chunk into a file of its own, one more request on every cold
// start (docs/technical/performance.md).

type Shown = { key: number; node: ReactNode };

const NOTHING: readonly Shown[] = [];
let shown: readonly Shown[] = NOTHING;
let nextKey = 0;
const listeners = new Set<() => void>();

function subscribeToShown(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function changed(next: readonly Shown[]): void {
  shown = next;
  for (const listener of listeners) listener();
}

/** Renders `node` in the host. Returns the call that removes it. */
export function showInUnsentWorkHost(node: ReactNode): () => void {
  const key = nextKey;
  nextKey += 1;
  changed([...shown, { key, node }]);
  return () => changed(shown.filter((entry) => entry.key !== key));
}

export function UnsentWorkHost() {
  const current = useSyncExternalStore(
    subscribeToShown,
    () => shown,
    () => NOTHING,
  );
  return current.map((entry) => <Fragment key={entry.key}>{entry.node}</Fragment>);
}
