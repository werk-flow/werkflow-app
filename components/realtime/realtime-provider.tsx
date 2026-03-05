'use client';

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useMemo,
  type ReactNode
} from 'react';
import type {
  RealtimeChannel,
  RealtimePostgresChangesPayload
} from '@supabase/supabase-js';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { useOrganization } from '@/components/organization/organization-context';

export type RealtimeTable = 'time_entries' | 'entry_change_requests' | 'organization_invites';

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

const RealtimeContext = createContext<RealtimeContextValue | null>(null);

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const { activeOrgId } = useOrganization();
  const channelRef = useRef<RealtimeChannel | null>(null);
  const listenersRef = useRef<Map<RealtimeTable, Set<RealtimeCallback>>>(
    new Map([
      ['time_entries', new Set()],
      ['entry_change_requests', new Set()],
      ['organization_invites', new Set()]
    ])
  );

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
      console.log(`[Realtime] ${payload.eventType} on ${table} → ${count} listener(s)`);

      if (count === 0) return;

      const event: RealtimeChangeEvent = {
        table,
        eventType: payload.eventType as RealtimeChangeEvent['eventType'],
        new: (payload.new as Record<string, unknown>) ?? null,
        old: (payload.old as Record<string, unknown>) ?? null
      };
      listeners!.forEach((cb) => cb(event));
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
        .subscribe((status: string, err?: Error) => {
          console.log(`[Realtime] channel status: ${status}`);
          if (err) {
            console.error('[Realtime] subscription error:', err);
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

    return () => {
      cancelled = true;
      authListener.unsubscribe();
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [activeOrgId]);

  // subscribe is a plain function stored in a ref — it never changes,
  // so the context value is created once and stays stable across renders.
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
