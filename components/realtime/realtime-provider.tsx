'use client';

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useMemo,
  useCallback,
  type ReactNode
} from 'react';
import type {
  RealtimeChannel,
  RealtimePostgresChangesPayload
} from '@supabase/supabase-js';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { useOrganization } from '@/components/organization/organization-context';

export type RealtimeTable = 'time_entries' | 'entry_change_requests' | 'organization_invites' | 'jobs' | 'job_assignments';

export type RealtimeChangeEvent = {
  table: RealtimeTable;
  eventType: 'INSERT' | 'UPDATE' | 'DELETE';
  new: Record<string, unknown> | null;
  old: Record<string, unknown> | null;
};

type RealtimeCallback = (event: RealtimeChangeEvent) => void;

type RealtimeContextValue = {
  subscribe: (table: RealtimeTable, cb: RealtimeCallback) => () => void;
};

const TABLES: RealtimeTable[] = [
  'time_entries',
  'entry_change_requests',
  'organization_invites',
  'jobs',
  'job_assignments'
];

const RealtimeContext = createContext<RealtimeContextValue | null>(null);

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const { activeOrgId } = useOrganization();
  const channelRef = useRef<RealtimeChannel | null>(null);
  const listenersRef = useRef<Map<RealtimeTable, Set<RealtimeCallback>>>(
    new Map(TABLES.map((t) => [t, new Set<RealtimeCallback>()]))
  );

  const debounceTimersRef = useRef<Map<RealtimeTable, NodeJS.Timeout>>(new Map());

  const dispatchAll = useCallback(() => {
    for (const table of TABLES) {
      const listeners = listenersRef.current.get(table);
      if (!listeners || listeners.size === 0) continue;
      const syntheticEvent: RealtimeChangeEvent = {
        table,
        eventType: 'UPDATE',
        new: null,
        old: null,
      };
      listeners.forEach((cb) => cb(syntheticEvent));
    }
  }, []);

  useEffect(() => {
    if (!activeOrgId) return;

    const supabase = createSupabaseBrowserClient();
    let cancelled = false;

    function dispatch(
      table: RealtimeTable,
      payload: RealtimePostgresChangesPayload<Record<string, unknown>>
    ) {
      const listeners = listenersRef.current.get(table);
      const count = listeners?.size ?? 0;
      if (count === 0) return;

      const event: RealtimeChangeEvent = {
        table,
        eventType: payload.eventType as RealtimeChangeEvent['eventType'],
        new: (payload.new as Record<string, unknown>) ?? null,
        old: (payload.old as Record<string, unknown>) ?? null
      };

      // Debounce: coalesce rapid-fire events on the same table into a single dispatch.
      // This prevents the thundering herd when e.g. switchJob inserts 2 time_entries
      // in quick succession, which would otherwise trigger 10+ parallel refetches twice.
      const existing = debounceTimersRef.current.get(table);
      if (existing) clearTimeout(existing);

      debounceTimersRef.current.set(
        table,
        setTimeout(() => {
          debounceTimersRef.current.delete(table);
          listeners!.forEach((cb) => cb(event));
        }, 150)
      );
    }

    async function setup() {
      const { data: { session } } = await supabase.auth.getSession();
      if (cancelled) return;

      if (session?.access_token) {
        supabase.realtime.setAuth(session.access_token);
      }

      const channel = supabase
        .channel(`org-${activeOrgId}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'time_entries',
            filter: `organization_id=eq.${activeOrgId}`
          },
          (p: RealtimePostgresChangesPayload<Record<string, unknown>>) =>
            dispatch('time_entries', p)
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'entry_change_requests',
            filter: `organization_id=eq.${activeOrgId}`
          },
          (p: RealtimePostgresChangesPayload<Record<string, unknown>>) =>
            dispatch('entry_change_requests', p)
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'organization_invites',
            filter: `organization_id=eq.${activeOrgId}`
          },
          (p: RealtimePostgresChangesPayload<Record<string, unknown>>) =>
            dispatch('organization_invites', p)
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'jobs',
            filter: `organization_id=eq.${activeOrgId}`
          },
          (p: RealtimePostgresChangesPayload<Record<string, unknown>>) =>
            dispatch('jobs', p)
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'job_assignments'
          },
          (p: RealtimePostgresChangesPayload<Record<string, unknown>>) => {
            // job_assignments has no organization_id column, so we can't filter server-side.
            // Consumers should be resilient to stale events; debouncing limits the impact.
            dispatch('job_assignments', p);
          }
        )
        .subscribe((status: string, err?: Error) => {
          if (err) {
            console.error('[Realtime] subscription error:', err);
          }
          if (status === 'TIMED_OUT' || status === 'CHANNEL_ERROR') {
            console.warn(`[Realtime] ${status} — will reconnect automatically`);
          }
        });

      channelRef.current = channel;
    }

    setup();

    const { data: { subscription: authListener } } = supabase.auth.onAuthStateChange(
      (_event: string, session: { access_token?: string } | null) => {
        if (session?.access_token) {
          supabase.realtime.setAuth(session.access_token);
        }
      }
    );

    // Refresh all listeners when the tab becomes visible again.
    // Browsers (especially Edge) may throttle or drop WebSocket connections
    // for background tabs; this ensures data is fresh when the user returns.
    function handleVisibilityChange() {
      if (document.visibilityState === 'visible') {
        dispatchAll();
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      cancelled = true;
      authListener.unsubscribe();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
      for (const timer of debounceTimersRef.current.values()) {
        clearTimeout(timer);
      }
      debounceTimersRef.current.clear();
    };
  }, [activeOrgId, dispatchAll]);

  const subscribeRef = useRef((table: RealtimeTable, cb: RealtimeCallback) => {
    listenersRef.current.get(table)?.add(cb);
    return () => {
      listenersRef.current.get(table)?.delete(cb);
    };
  });

  const ctxValue = useMemo<RealtimeContextValue>(
    () => ({ subscribe: subscribeRef.current }),
    []
  );

  return (
    <RealtimeContext.Provider value={ctxValue}>
      {children}
    </RealtimeContext.Provider>
  );
}

/**
 * Subscribe to Realtime changes on a specific table.
 * The callback fires whenever a row in that table (for the active org) is inserted, updated, or deleted.
 */
export function useRealtimeEvent(
  table: RealtimeTable,
  callback: RealtimeCallback
) {
  const ctx = useContext(RealtimeContext);
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    if (!ctx) return;

    const stableCallback: RealtimeCallback = (event) => {
      callbackRef.current(event);
    };

    return ctx.subscribe(table, stableCallback);
    // ctx is now stable (memoized), so this effect runs only on mount/unmount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx, table]);
}

