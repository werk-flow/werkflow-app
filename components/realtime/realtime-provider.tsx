'use client';

import { createContext, useContext, useEffect, useRef, useMemo, useState, type ReactNode } from 'react';
import type { RealtimeChannel, RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import { logError } from '@/lib/logging';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { useOrganization } from '@/components/organization/organization-context';
import {
  REALTIME_FOCUS_CATCH_UP_MIN_ABSENCE_MS,
  normalizeRealtimeDeletion,
  type RealtimeChangeEvent,
} from '@/lib/realtime/events';
import {
  REALTIME_TABLES,
  REALTIME_DELETION_TABLE,
  UNFILTERED_REALTIME_TABLES,
  type RealtimeTable,
} from '@/lib/realtime/tables';
import {
  createListenerRegistry,
  type ListenerRegistry,
  type RealtimeCallback,
} from '@/lib/realtime/listener-registry';

export type { RealtimeTable } from '@/lib/realtime/tables';

export type { RealtimeChangeEvent };

type RealtimeContextValue = {
  subscribe: ListenerRegistry['subscribe'];
};

const RealtimeContext = createContext<RealtimeContextValue | null>(null);

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const { activeOrgId } = useOrganization();
  const channelRef = useRef<RealtimeChannel | null>(null);
  const [registry] = useState(createListenerRegistry);

  useEffect(() => {
    if (!activeOrgId) return;
    const organizationId = activeOrgId;

    const supabase = createSupabaseBrowserClient();
    let cancelled = false;

    // Preserve every event identity. The two read/refresh hooks coalesce
    // their complete table set once, with the shared 150 ms guard.
    // A second provider timer delays delivery and can swallow a DELETE.
    function dispatch(event: RealtimeChangeEvent) {
      if (!cancelled) registry.dispatch(event);
    }

    async function setup() {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (cancelled) return;

      if (session?.access_token) {
        supabase.realtime.setAuth(session.access_token);
      }

      // One binding per table, generated from the single source of truth:
      // a table cannot join Realtime without its organization filter
      // (profiles is the recorded exception). All bindings ride one channel
      // join. Raw DELETE/TRUNCATE are disabled in the database publication;
      // tenant-authorized INSERT invalidations below replace DELETE delivery.
      let channel = supabase.channel(`org-${activeOrgId}`);
      channel = channel.on('system', {}, (payload: unknown) => {
        if (
          cancelled ||
          !payload ||
          typeof payload !== 'object' ||
          !('extension' in payload) ||
          payload.extension !== 'postgres_changes' ||
          !('status' in payload)
        )
          return;
        if (payload.status === 'ok') {
          document.documentElement.dataset.realtimePostgresState = 'ready';
          // Channel join can precede database-listener readiness. Read after
          // this signal on initial connection and reconnect to cover that gap.
          registry.dispatchAll({ joined: true });
        } else if (payload.status === 'error') {
          document.documentElement.dataset.realtimePostgresState = 'error';
          logError('realtime.database_subscription_unavailable');
        }
      });
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
            ...(filter ? { filter } : {}),
          },
          (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => {
            if (payload.eventType === 'DELETE') return;
            dispatch({ table, eventType: payload.eventType, new: payload.new, old: payload.old });
          },
        );
      }
      channel = channel.on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: REALTIME_DELETION_TABLE,
          filter: `organization_id=eq.${activeOrgId}`,
        },
        (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => {
          const event = normalizeRealtimeDeletion(payload.new, organizationId);
          if (event) dispatch(event);
        },
      );
      channel.subscribe((status: string, err?: Error) => {
        if (cancelled) return;
        // Diagnostic marker for measured scenarios and support: the join state
        // of this organization's channel, written after the client committed.
        document.documentElement.dataset.realtimeState = status.toLowerCase();
        if (err) logError('realtime.subscription_error', err);
        if (status === 'TIMED_OUT' || status === 'CHANNEL_ERROR' || status === 'CLOSED') {
          registry.leave();
          delete document.documentElement.dataset.realtimePostgresState;
          // The client reconnects by itself; the log keeps the interruption.
          logError('realtime.channel_interrupted', status);
        }
      });

      channelRef.current = channel;
    }

    // A failed session read leaves the page without live updates; the log keeps it.
    setup().catch((error: unknown) => logError('realtime.setup_failed', error));

    const {
      data: { subscription: authListener },
    } = supabase.auth.onAuthStateChange((_event: string, session: { access_token?: string } | null) => {
      if (session?.access_token) {
        supabase.realtime.setAuth(session.access_token);
      }
    });

    // Browsers (especially Edge) may throttle or drop WebSocket connections
    // for background tabs. After a long absence one catch-up re-reads every
    // live view; a short glance elsewhere never does (decision D5), and a
    // dropped socket recovers through the reconnect catch-up above instead.
    // A provider mounted in a hidden tab is already away; focus is not read
    // here because headless and embedded browsers report it unreliably.
    let awaySince: number | null = document.visibilityState === 'hidden' ? Date.now() : null;
    function markAway() {
      awaySince ??= Date.now();
    }
    function handleReturn() {
      if (awaySince === null) return;
      const absenceMs = Date.now() - awaySince;
      awaySince = null;
      if (absenceMs >= REALTIME_FOCUS_CATCH_UP_MIN_ABSENCE_MS) registry.dispatchAll();
    }
    function handleVisibilityChange() {
      if (document.visibilityState === 'hidden') markAway();
      else handleReturn();
    }
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('blur', markAway);
    window.addEventListener('focus', handleReturn);

    return () => {
      cancelled = true;
      registry.leave();
      delete document.documentElement.dataset.realtimeState;
      delete document.documentElement.dataset.realtimePostgresState;
      authListener.unsubscribe();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('blur', markAway);
      window.removeEventListener('focus', handleReturn);
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [activeOrgId, registry]);

  const ctxValue = useMemo<RealtimeContextValue>(() => ({ subscribe: registry.subscribe }), [registry]);

  return <RealtimeContext.Provider value={ctxValue}>{children}</RealtimeContext.Provider>;
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
export function useRealtimeEvent(table: RealtimeTable, callback: RealtimeCallback) {
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
