'use client';

import { useState, useSyncExternalStore } from 'react';

const subscribe = (): (() => void) => () => {};
const clientSnapshot = (): boolean => true;
const serverSnapshot = (): boolean => false;

/** Keep client-only actions disabled in server HTML until React owns their events. */
export function useHydrated(): boolean {
  return useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);
}

/**
 * Whether the component's first render hydrated the document's server HTML,
 * so its server props predate everything the client did since. Fixed at mount.
 */
export function useHydratedFromServer(): boolean {
  const hydrated = useHydrated();
  const [fromServer] = useState(!hydrated);
  return fromServer;
}
