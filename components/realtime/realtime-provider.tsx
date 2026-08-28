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
import {
  coalesceRealtimeEvents,
  REALTIME_DEBOUNCE_MS
} from '@/lib/realtime/events';
import {
  REALTIME_TABLES,
  UNFILTERED_REALTIME_TABLES,
  type RealtimeTable,
} from '@/lib/realtime/tables';

export type { RealtimeTable } from '@/lib/realtime/tables';

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
const isDev = process.env.NODE_ENV === 'development';

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const { activeOrgId } = useOrganization();
  const channelRef = useRef<RealtimeChannel | null>(null);
  const listenersRef = useRef<Map<RealtimeTable, Set<RealtimeCallback>>>(
    new Map(REALTIME_TABLES.map((t) => [t, new Set<RealtimeCallback>()]))
  );

  const debounceTimersRef = useRef<Map<RealtimeTable, NodeJS.Timeout>>(new Map());
  const pendingEventsRef = useRef<Map<RealtimeTable, RealtimeChangeEvent>>(new Map());

  const dispatchAll = useCallback(() => {
    for (const table of REALTIME_TABLES) {
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

      if (isDev) {
        // Dev-mode propagation latency: database commit to client receipt.
        // The D4 latency contract's real numbers come from these lines plus
        // the expectLiveWithin measurements in the harness.
        const commitTimestamp = (payload as { commit_timestamp?: string })
          .commit_timestamp;
        const commitMs = commitTimestamp ? Date.parse(commitTimestamp) : NaN;
        console.info('[Realtime] event received', {
          channel: `org-${activeOrgId}`,
          table,
          eventType: event.eventType,
          propagationMs: Number.isFinite(commitMs)
            ? Math.max(0, Date.now() - commitMs)
            : null
        });
      }

      // Debounce: coalesce rapid-fire events on the same table into a single dispatch.
      // This prevents the thundering herd when e.g. switchJob inserts 2 time_entries
      // in quick succession, which would otherwise trigger 10+ parallel refetches twice.
      const existing = debounceTimersRef.current.get(table);
      if (existing) clearTimeout(existing);
      pendingEventsRef.current.set(
        table,
        coalesceRealtimeEvents(pendingEventsRef.current.get(table), event)
      );

      debounceTimersRef.current.set(
        table,
        setTimeout(() => {
          debounceTimersRef.current.delete(table);
          const pendingEvent = pendingEventsRef.current.get(table);
          pendingEventsRef.current.delete(table);
          if (pendingEvent) listeners!.forEach((cb) => cb(pendingEvent));
        }, REALTIME_DEBOUNCE_MS)
      );
    }

    async function setup() {
      const { data: { session } } = await supabase.auth.getSession();
      if (cancelled) return;

      if (session?.access_token) {
        supabase.realtime.setAuth(session.access_token);
      }

      // One binding per table, generated from the single source of truth:
      // a table cannot join Realtime without its organization filter
      // (profiles is the recorded exception). All bindings ride one channel
      // join; DELETE payloads carry only id/organization_id (replica
      // identity USING INDEX — see docs/technical/realtime-and-caching.md).
      let channel = supabase.channel(`org-${activeOrgId}`);
      for (const table of REALTIME_TABLES) {
        const filter = UNFILTERED_REALTIME_TABLES.includes(table)
          ? undefined
          : `organization_id=eq.${activeOrgId}`;
        channel = channel.on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table,
            ...(filter ? { filter } : {})
          },
          (p: RealtimePostgresChangesPayload<Record<string, unknown>>) =>
            dispatch(table, p)
        );
      }
      let hadChannelGap = false;
      channel
        .subscribe((status: string, err?: Error) => {
          if (isDev) {
            console.info('[Realtime] channel status', {
              channel: `org-${activeOrgId}`,
              status
            });
          }
          if (err) {
            console.error('[Realtime] subscription error:', err);
          }
          if (status === 'SUBSCRIBED') {
            console.info(`[Realtime] subscribed to org-${activeOrgId}`);
            if (hadChannelGap) {
              // Gap recovery: events during the outage are gone, so treat the
              // re-join like a tab return and let every subscriber refetch.
              hadChannelGap = false;
              dispatchAll();
            }
          }
          if (status === 'TIMED_OUT' || status === 'CHANNEL_ERROR' || status === 'CLOSED') {
            hadChannelGap = true;
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
    let catchUpTimer: ReturnType<typeof setTimeout> | null = null;
    function scheduleCatchUp() {
      if (catchUpTimer) clearTimeout(catchUpTimer);
      catchUpTimer = setTimeout(() => {
        catchUpTimer = null;
        dispatchAll();
      }, 50);
    }
    function handleVisibilityChange() {
      if (document.visibilityState === 'visible') {
        scheduleCatchUp();
      }
    }
    function handleWindowFocus() {
      scheduleCatchUp();
    }
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleWindowFocus);
    const debounceTimers = debounceTimersRef.current;
    const pendingEvents = pendingEventsRef.current;

    return () => {
      cancelled = true;
      authListener.unsubscribe();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleWindowFocus);
      if (catchUpTimer) clearTimeout(catchUpTimer);
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
      for (const timer of debounceTimers.values()) {
        clearTimeout(timer);
      }
      debounceTimers.clear();
      pendingEvents.clear();
    };
  }, [activeOrgId, dispatchAll]);

  const subscribe = useCallback((table: RealtimeTable, cb: RealtimeCallback) => {
    listenersRef.current.get(table)?.add(cb);
    return () => {
      listenersRef.current.get(table)?.delete(cb);
    };
  }, []);

  const ctxValue = useMemo<RealtimeContextValue>(
    () => ({ subscribe }),
    [subscribe]
  );

  return (
    <RealtimeContext.Provider value={ctxValue}>
      {children}
    </RealtimeContext.Provider>
  );
}

/**
 * Imperative access to the provider's subscribe function, for hooks that
 * subscribe to a dynamic table list in one effect (the live-view primitive).
 * Returns null outside the provider (auth/onboarding shells).
 */
export function useRealtimeSubscribe(): RealtimeContextValue['subscribe'] | null {
  const ctx = useContext(RealtimeContext);
  return ctx ? ctx.subscribe : null;
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

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(() => {
    if (!ctx) return;

    const stableCallback: RealtimeCallback = (event) => {
      callbackRef.current(event);
    };

    return ctx.subscribe(table, stableCallback);
  }, [ctx, table]);
}

