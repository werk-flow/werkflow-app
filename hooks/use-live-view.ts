'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

/**
 * The live-view primitive (client freshness contract,
 * docs/technical/realtime-and-caching.md). One hook owns the whole refetch
 * discipline that every live surface previously hand-rolled:
 *
 * - Subscription consumption for a table list through the central provider
 *   (which also delivers the coalesced focus/visibility catch-up as
 *   synthetic events — no surface registers its own listeners).
 * - One shared debounce at REALTIME_DEBOUNCE_MS across all tables of the
 *   surface, so a cross-table burst lands as a single read.
 * - Generation-guarded reads: an older response never overwrites a newer one.
 * - Keep-last-known: a failed read keeps the previous data and marks the
 *   surface stale instead of clearing it.
 * - Dialog suspension: while any overlay is open (or `suspend` is true),
 *   events queue instead of refetching; exactly one catch-up read fires when
 *   the suspension ends.
 *
 * Events are invalidation signals: `read` is the authority, payload content
 * is only ever inspected inside `eventFilter` to skip irrelevant events.
 * DELETE payloads carry just `id` and `organization_id` (replica identity
 * `USING INDEX`), so a filter must treat a missing column as relevant.
 */

export type LiveViewResult<T> =
  | { ok: true; data: T }
  | { ok: false; error?: string };

export type UseLiveViewOptions<T> = {
  /** Tables whose events invalidate this view. */
  tables: readonly RealtimeTable[];
  /** The authoritative reader; usually wraps one server action. */
  read: () => Promise<LiveViewResult<T>>;
  /**
   * Server-rendered data for the initial paint. When present, the mount read
   * is skipped (the route render just produced this data).
   */
  initialData?: T;
  /** When false, the view neither subscribes nor reads. Default true. */
  enabled?: boolean;
  /**
   * Skips irrelevant non-synthetic events. Synthetic catch-up events bypass
   * the filter by design — after a gap, the read must run.
   */
  eventFilter?: (event: RealtimeChangeEvent) => boolean;
  /**
   * Surface-specific suspension in addition to the shared dialog suspension
   * (for example an inline editor that is not a Dialog). While true, events
   * queue; one catch-up read fires when it turns false.
   */
  suspend?: boolean;
  /**
   * Identity of the viewed scope (organization id, entity id). A change
   * discards in-flight reads and current data, then reads fresh. Prefer
   * keying the component by entity id; use this where remounting is not an
   * option (app-shell providers).
   */
  resetKey?: string | null;
};

export type LiveViewState<T> = {
  /** Last committed data; undefined until the first successful read. */
  data: T | undefined;
  /** True while no data exists yet and the view is enabled. */
  isLoading: boolean;
  /** True while a read is in flight (initial or refresh). */
  isRefreshing: boolean;
  /**
   * True when the last completed read failed: `data` is last-known. Surfaces
   * mark dependent content visibly stale and disable actions that rely on it.
   */
  isStale: boolean;
  /** Error message from the last failed read, when the reader provided one. */
  error: string | null;
  /** Immediate generation-guarded read; bypasses debounce and suspension. */
  refresh: () => Promise<void>;
  /**
   * Discards in-flight reads without starting a new one. Call before applying
   * an optimistic local mutation so a stale response cannot overwrite it.
   */
  invalidate: () => void;
  /**
   * Applies an optimistic local echo (D4: a user's own action reflects
   * instantly). Call `invalidate()` first so an in-flight read cannot
   * overwrite the echo; the next event-driven read reconciles with the
   * server. Not for ordinary refetch flows — `read` stays the authority.
   */
  setData: (updater: (previous: T | undefined) => T | undefined) => void;
};

export function useLiveView<T>(options: UseLiveViewOptions<T>): LiveViewState<T> {
  const {
    tables,
    read,
    initialData,
    enabled = true,
    eventFilter,
    suspend = false,
    resetKey = null,
  } = options;

  const subscribe = useRealtimeSubscribe();
  const anyDialogOpen = useAnyDialogOpen();
  const suspended = anyDialogOpen || suspend;

  const [data, setData] = useState<T | undefined>(initialData);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isStale, setIsStale] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Settled means at least one read completed (or server data made a read
  // unnecessary): isLoading must not stay true after a failed first read.
  const [hasSettled, setHasSettled] = useState(initialData !== undefined);

  const generationRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingWhileSuspendedRef = useRef(false);
  const suspendedRef = useRef(suspended);
  const readRef = useRef(read);
  const eventFilterRef = useRef(eventFilter);
  const hasDataRef = useRef(initialData !== undefined);
  const enabledRef = useRef(enabled);

  const tablesRef = useRef<readonly RealtimeTable[]>(tables);

  useEffect(() => {
    readRef.current = read;
    eventFilterRef.current = eventFilter;
    enabledRef.current = enabled;
    tablesRef.current = tables;
  });

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const runRead = useCallback(async (): Promise<void> => {
    if (!enabledRef.current) return;
    const generation = ++generationRef.current;
    setIsRefreshing(true);
    try {
      const result = await readRef.current();
      if (generation !== generationRef.current) return;
      if (result.ok) {
        hasDataRef.current = true;
        setData(result.data);
        setIsStale(false);
        setError(null);
      } else {
        // Keep-last-known: existing data stays visible, marked stale.
        setIsStale(hasDataRef.current);
        setError(result.error ?? null);
      }
    } catch (readError) {
      if (generation !== generationRef.current) return;
      console.error('[LiveView] read failed:', readError);
      setIsStale(hasDataRef.current);
    } finally {
      if (generation === generationRef.current) {
        setIsRefreshing(false);
        setHasSettled(true);
      }
    }
  }, []);

  const scheduleRead = useCallback(() => {
    if (!enabledRef.current) return;
    if (suspendedRef.current) {
      pendingWhileSuspendedRef.current = true;
      return;
    }
    clearTimer();
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      void runRead();
    }, REALTIME_DEBOUNCE_MS);
  }, [clearTimer, runRead]);

  // Suspension boundary: entering drops a pending timer into the queue flag;
  // leaving fires exactly one catch-up read.
  useEffect(() => {
    suspendedRef.current = suspended;
    if (suspended) {
      if (timerRef.current) {
        clearTimer();
        pendingWhileSuspendedRef.current = true;
      }
      return;
    }
    if (pendingWhileSuspendedRef.current) {
      pendingWhileSuspendedRef.current = false;
      scheduleRead();
    }
  }, [suspended, clearTimer, scheduleRead]);

  // Subscribe to the table list. The provider keeps callbacks in a set, so
  // one effect can register the whole list; identity comes from the joined
  // table names, not the (usually inline) array reference.
  const tablesKey = tables.join(',');
  useEffect(() => {
    if (!subscribe || !enabled) return;
    const onEvent = (event: RealtimeChangeEvent) => {
      if (!shouldScheduleRealtimeRefresh(event, eventFilterRef.current)) return;
      scheduleRead();
    };
    const unsubscribes = tablesRef.current.map((table) =>
      subscribe(table, onEvent)
    );
    return () => {
      for (const unsubscribe of unsubscribes) unsubscribe();
    };
  }, [subscribe, enabled, tablesKey, scheduleRead]);

  // Initial read, reset handling, and enable transitions. `initialData` only
  // suppresses the very first read; a resetKey change always reads fresh.
  const lastResetKeyRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (!enabled) return;
    const isFirstRun = lastResetKeyRef.current === undefined;
    const resetChanged = !isFirstRun && lastResetKeyRef.current !== resetKey;
    lastResetKeyRef.current = resetKey;

    if (resetChanged) {
      generationRef.current += 1;
      clearTimer();
      pendingWhileSuspendedRef.current = false;
      hasDataRef.current = false;
      setData(undefined);
      setIsStale(false);
      setError(null);
      setHasSettled(false);
      void runRead();
      return;
    }

    if (isFirstRun && initialData !== undefined) return;
    void runRead();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initialData is mount-time data only (freshness contract rule 3)
  }, [enabled, resetKey, clearTimer, runRead]);

  useEffect(() => {
    return () => {
      generationRef.current += 1;
      clearTimer();
    };
  }, [clearTimer]);

  const refresh = useCallback(async () => {
    clearTimer();
    pendingWhileSuspendedRef.current = false;
    await runRead();
  }, [clearTimer, runRead]);

  const invalidate = useCallback(() => {
    generationRef.current += 1;
    clearTimer();
    // A discarded in-flight read can no longer clear this flag (its
    // generation no longer matches), so settle it here.
    setIsRefreshing(false);
  }, [clearTimer]);

  const setDataExternally = useCallback(
    (updater: (previous: T | undefined) => T | undefined) => {
      setData((previous) => {
        const next = updater(previous);
        hasDataRef.current = next !== undefined;
        return next;
      });
      setIsStale(false);
      setError(null);
      setHasSettled(true);
    },
    []
  );

  return useMemo<LiveViewState<T>>(
    () => ({
      data,
      isLoading: enabled && !hasSettled,
      isRefreshing,
      isStale,
      error,
      refresh,
      invalidate,
      setData: setDataExternally,
    }),
    [
      data,
      enabled,
      hasSettled,
      isRefreshing,
      isStale,
      error,
      refresh,
      invalidate,
      setDataExternally,
    ]
  );
}
