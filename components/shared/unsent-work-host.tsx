'use client';

import { Fragment, memo, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';

// Where the unsent-work question renders (unsent-work-prompt.tsx). Each client
// tree whose flows can ask mounts one host: the app shell, and the pages
// outside it that end a session (lib/conventions/unsent-work-hosts.test.ts).
// The question needs no React root of its own: a lazy module that imports
// `react-dom/client` makes the bundler cut React's DOM renderer out of the
// start-up chunk into a file of its own, one more request on every cold
// start (docs/technical/performance.md). The root layout stays a server file,
// so no route payload carries this host.

type Shown = { key: number; node: ReactNode };

const NOTHING: readonly Shown[] = [];
let shown: readonly Shown[] = NOTHING;
let nextKey = 0;
/** The mounted hosts in mount order; only the first renders, so a question never shows twice. */
let hosts: readonly symbol[] = [];
const listeners = new Set<() => void>();

function subscribeToHost(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notify(): void {
  for (const listener of listeners) listener();
}

/**
 * Renders `node` in the mounted host and answers the call that removes it. Throws when no host is
 * mounted: the question would never show, and the session must not end over unasked work.
 */
export function showInUnsentWorkHost(node: ReactNode): () => void {
  if (hosts.length === 0) throw new Error('no unsent-work host is mounted');
  const key = nextKey;
  nextKey += 1;
  shown = [...shown, { key, node }];
  notify();
  return () => {
    shown = shown.filter((entry) => entry.key !== key);
    notify();
  };
}

/** Memoized: it takes no props, so a parent's render never renders it again. */
export const UnsentWorkHost = memo(function UnsentWorkHost() {
  const [id] = useState(() => Symbol('unsent-work-host'));
  useEffect(() => {
    hosts = [...hosts, id];
    notify();
    return () => {
      hosts = hosts.filter((host) => host !== id);
      notify();
    };
  }, [id]);
  const current = useSyncExternalStore(
    subscribeToHost,
    () => shown,
    () => NOTHING,
  );
  const first = useSyncExternalStore(
    subscribeToHost,
    () => hosts[0],
    () => undefined,
  );
  if (first !== id) return null;
  return current.map((entry) => <Fragment key={entry.key}>{entry.node}</Fragment>);
});
