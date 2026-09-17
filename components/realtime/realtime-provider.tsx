"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useMemo,
  useCallback,
  type ReactNode,
} from "react";
import type {
  RealtimeChannel,
  RealtimePostgresChangesPayload,
} from "@supabase/supabase-js";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useOrganization } from "@/components/organization/organization-context";
import {
  REALTIME_FOCUS_CATCH_UP_MIN_ABSENCE_MS,
  normalizeRealtimeDeletion,
} from "@/lib/realtime/events";
import {
  REALTIME_TABLES,
  REALTIME_DELETION_TABLE,
  UNFILTERED_REALTIME_TABLES,
  type RealtimeTable,
} from "@/lib/realtime/tables";

export type { RealtimeTable } from "@/lib/realtime/tables";

export type RealtimeChangeEvent = {
  table: RealtimeTable;
  eventType: "INSERT" | "UPDATE" | "DELETE";
  new: Record<string, unknown> | null;
  old: Record<string, unknown> | null;
};

type RealtimeCallback = (event: RealtimeChangeEvent) => void;

type RealtimeContextValue = {
  subscribe: (table: RealtimeTable, cb: RealtimeCallback) => () => void;
};

const RealtimeContext = createContext<RealtimeContextValue | null>(null);
const isDev = process.env.NODE_ENV === "development";

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const { activeOrgId } = useOrganization();
  const channelRef = useRef<RealtimeChannel | null>(null);
  const listenersRef = useRef<Map<RealtimeTable, Set<RealtimeCallback>>>(
    new Map(REALTIME_TABLES.map((t) => [t, new Set<RealtimeCallback>()])),
  );

  const dispatchAll = useCallback(() => {
    for (const table of REALTIME_TABLES) {
      const listeners = listenersRef.current.get(table);
      if (!listeners || listeners.size === 0) continue;
      const syntheticEvent: RealtimeChangeEvent = {
        table,
        eventType: "UPDATE",
        new: null,
        old: null,
      };
      listeners.forEach((cb) => cb(syntheticEvent));
    }
  }, []);

  useEffect(() => {
    if (!activeOrgId) return;
    const organizationId = activeOrgId;

    const supabase = createSupabaseBrowserClient();
    let cancelled = false;

    function dispatch(
      event: RealtimeChangeEvent,
      commitTimestamp?: string,
    ) {
      if (cancelled) return;
      const table = event.table;
      const listeners = listenersRef.current.get(table);
      const count = listeners?.size ?? 0;
      if (count === 0) return;

      if (isDev) {
        // Dev-mode propagation latency: database commit to client receipt.
        // The D4 latency contract's real numbers come from these lines plus
        // the expectLiveWithin measurements in the harness.
        const commitMs = commitTimestamp ? Date.parse(commitTimestamp) : NaN;
        console.info("[Realtime] event received", {
          channel: `org-${activeOrgId}`,
          table,
          eventType: event.eventType,
          propagationMs: Number.isFinite(commitMs)
            ? Math.max(0, Date.now() - commitMs)
            : null,
        });
      }

      // Preserve every event identity. The two read/refresh hooks coalesce
      // their complete table set once, with the shared 150 ms guard.
      // A second provider timer delays delivery and can swallow a DELETE.
      listeners!.forEach((callback) => callback(event));
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
        if (cancelled || !payload || typeof payload !== 'object'
          || !('extension' in payload) || payload.extension !== 'postgres_changes'
          || !('status' in payload)) return;
        if (payload.status === 'ok') {
          document.documentElement.dataset.realtimePostgresState = 'ready';
          // Channel join can precede database-listener readiness. Read after
          // this signal on initial connection and reconnect to cover that gap.
          dispatchAll();
        } else if (payload.status === 'error') {
          document.documentElement.dataset.realtimePostgresState = 'error';
          console.warn('[Realtime] database subscription unavailable');
        }
      });
      for (const table of REALTIME_TABLES) {
        const filter = UNFILTERED_REALTIME_TABLES.includes(table)
          ? undefined
          : `organization_id=eq.${activeOrgId}`;
        channel = channel.on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table,
            ...(filter ? { filter } : {}),
          },
          (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => {
            if (payload.eventType === 'DELETE') return;
            dispatch({ table, eventType: payload.eventType, new: payload.new, old: payload.old }, payload.commit_timestamp);
          },
        );
      }
      channel = channel.on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: REALTIME_DELETION_TABLE,
        filter: `organization_id=eq.${activeOrgId}`,
      }, (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => {
        const event = normalizeRealtimeDeletion(payload.new, organizationId);
        if (event) dispatch(event, payload.commit_timestamp);
      });
      channel.subscribe((status: string, err?: Error) => {
        if (cancelled) return;
        // Diagnostic marker for measured scenarios and support: the join state
        // of this organization's channel, written after the client committed.
        document.documentElement.dataset.realtimeState = status.toLowerCase();
        if (isDev) {
          console.info("[Realtime] channel status", {
            channel: `org-${activeOrgId}`,
            status,
          });
        }
        if (err) {
          console.error("[Realtime] subscription error:", err);
        }
        if (status === "SUBSCRIBED") {
          console.info('[Realtime] subscribed');
        }
        if (
          status === "TIMED_OUT" ||
          status === "CHANNEL_ERROR" ||
          status === "CLOSED"
        ) {
          delete document.documentElement.dataset.realtimePostgresState;
          console.warn(`[Realtime] ${status} — will reconnect automatically`);
        }
      });

      channelRef.current = channel;
    }

    setup();

    const {
      data: { subscription: authListener },
    } = supabase.auth.onAuthStateChange(
      (_event: string, session: { access_token?: string } | null) => {
        if (session?.access_token) {
          supabase.realtime.setAuth(session.access_token);
        }
      },
    );

    // Browsers (especially Edge) may throttle or drop WebSocket connections
    // for background tabs. After a long absence one catch-up re-reads every
    // live view; a short glance elsewhere never does (decision D5), and a
    // dropped socket recovers through the reconnect catch-up above instead.
    // A provider mounted in a hidden tab is already away; focus is not read
    // here because headless and embedded browsers report it unreliably.
    let awaySince: number | null = document.visibilityState === "hidden" ? Date.now() : null;
    function markAway() {
      awaySince ??= Date.now();
    }
    function handleReturn() {
      if (awaySince === null) return;
      const absenceMs = Date.now() - awaySince;
      awaySince = null;
      if (absenceMs >= REALTIME_FOCUS_CATCH_UP_MIN_ABSENCE_MS) dispatchAll();
    }
    function handleVisibilityChange() {
      if (document.visibilityState === "hidden") markAway();
      else handleReturn();
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("blur", markAway);
    window.addEventListener("focus", handleReturn);

    return () => {
      cancelled = true;
      delete document.documentElement.dataset.realtimeState;
      delete document.documentElement.dataset.realtimePostgresState;
      authListener.unsubscribe();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("blur", markAway);
      window.removeEventListener("focus", handleReturn);
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }

    };
  }, [activeOrgId, dispatchAll]);

  const subscribe = useCallback(
    (table: RealtimeTable, cb: RealtimeCallback) => {
      listenersRef.current.get(table)?.add(cb);
      return () => {
        listenersRef.current.get(table)?.delete(cb);
      };
    },
    [],
  );

  const ctxValue = useMemo<RealtimeContextValue>(
    () => ({ subscribe }),
    [subscribe],
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
export function useRealtimeSubscribe():
  RealtimeContextValue["subscribe"] | null {
  const ctx = useContext(RealtimeContext);
  return ctx ? ctx.subscribe : null;
}

/**
 * Subscribe to Realtime changes on a specific table.
 * The callback fires whenever a row in that table (for the active org) is inserted, updated, or deleted.
 */
export function useRealtimeEvent(
  table: RealtimeTable,
  callback: RealtimeCallback,
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
