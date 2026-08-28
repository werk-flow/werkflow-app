'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  useRealtimeSubscribe,
  type RealtimeChangeEvent,
  type RealtimeTable,
} from '@/components/realtime/realtime-provider';
import {
  REALTIME_DEBOUNCE_MS,
  shouldScheduleRealtimeRefresh,
} from '@/lib/realtime/events';
import { useAnyDialogOpen } from '@/components/ui/open-dialog-context';

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
 * Dialog/AlertDialog/Sheet is open, refreshes are suspended so they cannot
 * remount the dialog mid-interaction; one catch-up refresh fires after close.
 * For narrower client refetches use `useLiveView` (hooks/use-live-view.ts).
 */
export function useRealtimeRouterRefresh({
  tables,
  enabled = true,
  eventFilter,
}: UseRealtimeRouterRefreshOptions): void {
  const router = useRouter();
  const subscribe = useRealtimeSubscribe();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const anyDialogOpen = useAnyDialogOpen();
  const anyDialogOpenRef = useRef(anyDialogOpen);
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
      if (
        !enabledRef.current ||
        (event && !shouldScheduleRealtimeRefresh(event, eventFilterRef.current))
      ) {
        return;
      }

      if (anyDialogOpenRef.current) {
        pendingWhileSuspendedRef.current = true;
        return;
      }

      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }

      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        router.refresh();
      }, REALTIME_DEBOUNCE_MS);
    },
    [router]
  );

  useEffect(() => {
    anyDialogOpenRef.current = anyDialogOpen;

    if (anyDialogOpen) {
      // Drop an already-scheduled refresh so it can't land mid-dialog.
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
        pendingWhileSuspendedRef.current = true;
      }
      return;
    }

    if (pendingWhileSuspendedRef.current) {
      pendingWhileSuspendedRef.current = false;
      scheduleRefresh();
    }
  }, [anyDialogOpen, scheduleRefresh]);

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (enabled || !timerRef.current) return;
    clearTimeout(timerRef.current);
    timerRef.current = null;
  }, [enabled]);

  const tablesKey = tables.join(',');
  useEffect(() => {
    if (!subscribe || !enabled) return;
    const onEvent = (event: RealtimeChangeEvent) => scheduleRefresh(event);
    const unsubscribes = tablesRef.current.map((table) =>
      subscribe(table, onEvent)
    );
    return () => {
      for (const unsubscribe of unsubscribes) unsubscribe();
    };
  }, [subscribe, enabled, tablesKey, scheduleRefresh]);
}
