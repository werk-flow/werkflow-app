'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouterRefresh } from '@/components/ui/refresh-button';
import {
  useRealtimeSubscribe,
  type RealtimeChangeEvent,
  type RealtimeTable,
} from '@/components/realtime/realtime-provider';
import {
  REALTIME_DEBOUNCE_MS,
  REALTIME_MAX_DEFER_MS,
  shouldScheduleRealtimeRefresh,
} from '@/lib/realtime/events';
import { createTrailingScheduler, type TrailingScheduler } from '@/lib/realtime/scheduler';
import { useAnyDialogOpen } from '@/components/ui/open-dialog-context';
import { countRealtimeRefresh, markRouteRefresh } from '@/lib/ui/route-refresh-signal';

type UseRealtimeRouterRefreshOptions = {
  tables: readonly RealtimeTable[];
  enabled?: boolean;
  /**
   * Skips irrelevant non-synthetic events. Synthetic catch-up events bypass
   * the filter by design — after a gap, the refresh must run.
   */
  eventFilter?: (event: RealtimeChangeEvent) => boolean;
};

/**
 * The route-refresh member of the live-view family: server-rendered surfaces
 * reload the route when one of their tables changes. Debounce is the shared
 * REALTIME_DEBOUNCE_MS — there is deliberately no per-surface knob. While any
 * Dialog/AlertDialog/Sheet is open or a route render is pending, refreshes wait
 * so they cannot interrupt that work. One catch-up runs when enabled and idle.
 * For narrower client refetches use `useLiveView` (hooks/use-live-view.ts).
 */
export function useRealtimeRouterRefresh({
  tables,
  enabled = true,
  eventFilter,
}: UseRealtimeRouterRefreshOptions): void {
  const { refresh, isPending } = useRouterRefresh();
  const subscribe = useRealtimeSubscribe();
  const schedulerRef = useRef<TrailingScheduler | null>(null);
  // A queued refresh is a busy signal; one parked behind a dialog or a running render is not.
  const [queuedHolder] = useState(() => Symbol('queued route refresh'));

  const anyDialogOpen = useAnyDialogOpen();
  const suspended = anyDialogOpen || isPending || !enabled;
  const suspendedRef = useRef(suspended);
  const pendingWhileSuspendedRef = useRef(false);
  const enabledRef = useRef(enabled);
  const eventFilterRef = useRef(eventFilter);
  const tablesRef = useRef<readonly RealtimeTable[]>(tables);

  useEffect(() => {
    enabledRef.current = enabled;
    eventFilterRef.current = eventFilter;
    tablesRef.current = tables;
  });

  const scheduleRefresh = useCallback(
    (event?: RealtimeChangeEvent) => {
      if (!enabledRef.current || (event && !shouldScheduleRealtimeRefresh(event, eventFilterRef.current))) {
        return;
      }

      if (suspendedRef.current) {
        pendingWhileSuspendedRef.current = true;
        return;
      }

      // Shared debounce with a bounded maximum deferral.
      schedulerRef.current ??= createTrailingScheduler({
        delayMs: REALTIME_DEBOUNCE_MS,
        maxWaitMs: REALTIME_MAX_DEFER_MS,
        run: () => {
          markRouteRefresh(queuedHolder, false);
          countRealtimeRefresh();
          refresh();
        },
      });
      markRouteRefresh(queuedHolder, true);
      schedulerRef.current.schedule();
    },
    [refresh, queuedHolder],
  );

  useEffect(() => {
    suspendedRef.current = suspended;

    if (suspended) {
      // Preserve queued work until the current interaction or render settles.
      if (schedulerRef.current?.cancel()) {
        pendingWhileSuspendedRef.current = true;
      }
      markRouteRefresh(queuedHolder, false);
      return;
    }

    if (pendingWhileSuspendedRef.current) {
      pendingWhileSuspendedRef.current = false;
      scheduleRefresh();
    }
  }, [suspended, scheduleRefresh, queuedHolder]);

  useEffect(() => {
    return () => {
      schedulerRef.current?.cancel();
      markRouteRefresh(queuedHolder, false);
    };
  }, [queuedHolder]);

  useEffect(() => {
    if (enabled) return;
    schedulerRef.current?.cancel();
    markRouteRefresh(queuedHolder, false);
  }, [enabled, queuedHolder]);

  const tablesKey = tables.join(',');
  useEffect(() => {
    if (!subscribe || !enabled) return;
    const onEvent = (event: RealtimeChangeEvent) => scheduleRefresh(event);
    const unsubscribes = tablesRef.current.map((table) => subscribe(table, onEvent));
    return () => {
      for (const unsubscribe of unsubscribes) unsubscribe();
    };
  }, [subscribe, enabled, tablesKey, scheduleRefresh]);
}
