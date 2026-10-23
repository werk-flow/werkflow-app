'use client';

import { useEffect, useRef, useState } from 'react';
import type { RealtimeChangeEvent, RealtimeTable } from '@/components/realtime/realtime-provider';
import type { ListenerRegistry } from '@/lib/realtime/listener-registry';
import { useHydratedFromServer } from '@/hooks/use-hydrated';

type RealtimeTablesOptions = {
  /** The provider's subscribe, which only the live-view family reads; null outside the provider. */
  subscribe: ListenerRegistry['subscribe'] | null;
  tables: readonly RealtimeTable[];
  enabled: boolean;
  /** The view shows server data; when it hydrated, it asks for the join catch-up it may have missed. */
  serverData: boolean;
  onEvent: (event: RealtimeChangeEvent) => void;
};

/**
 * The subscription of one live hook to its table list through the provider.
 * One effect registers the whole list; identity comes from the joined table
 * names, not the (usually inline) array reference. A view hydrated from the
 * document's server render can mount after the provider's join catch-up, so
 * its first subscription asks the provider for that catch-up
 * (lib/realtime/listener-registry.ts).
 */
export function useRealtimeTables(options: RealtimeTablesOptions): void {
  const joinCatchUpRef = useRef(useHydratedFromServer() && options.serverData);
  const latestRef = useRef(options);
  useEffect(() => {
    latestRef.current = options;
  });
  // One callback per hook instance: a re-subscription (StrictMode, a table change)
  // puts the same function back, so a pending join catch-up still finds it.
  const [onEvent] = useState(
    () =>
      (event: RealtimeChangeEvent): void =>
        latestRef.current.onEvent(event),
  );
  const { subscribe, enabled } = options;
  const tablesKey = options.tables.join(',');
  useEffect(() => {
    if (!subscribe || !enabled) return;
    const unsubscribes = latestRef.current.tables.map((table) =>
      subscribe(table, onEvent, joinCatchUpRef.current),
    );
    // A view whose table list is still empty keeps its claim for its first subscription.
    if (unsubscribes.length) joinCatchUpRef.current = false;
    return () => {
      for (const unsubscribe of unsubscribes) unsubscribe();
    };
  }, [subscribe, enabled, tablesKey, onEvent]);
}
