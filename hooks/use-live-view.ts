'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from 'react';
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
import { logError } from '@/lib/logging';
import { createTrailingScheduler, type TrailingScheduler } from '@/lib/realtime/scheduler';
import { useAnyDialogOpen } from '@/components/ui/open-dialog-context';
import { useHeldReadFlag, useLiveReadMarker, type LiveReadMarker } from '@/lib/ui/route-refresh-signal';
import { useRealtimeTables } from '@/hooks/use-realtime-tables';

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
 * - Generation-guarded reads: data commits in generation order. An older
 *   successful result that arrives while the newer read is still pending is
 *   applied (it is fresher than the state); one that arrives after a newer
 *   success, or after an invalidation, is discarded. `isStale` and `error`
 *   follow the newest completed read, so a failed newer read cannot be
 *   overwritten by an older success and an older failure never hides a
 *   newer success. One client's Server Actions run one after another, so a
 *   newer read can wait in that queue for seconds: discarding the older
 *   result meanwhile would leave the surface on mount-time data, and
 *   applying an older failure would hide the newer result.
 * - Keep-last-known: a failed read keeps the previous data and marks the
 *   surface stale instead of clearing it.
 * - Dialog suspension: while any overlay is open (or `suspend` is true),
 *   events queue instead of refetching; exactly one catch-up read fires when
 *   the suspension ends.
 *
 * Events are invalidation signals: `read` is the authority, payload content
 * is only ever inspected inside `eventFilter` to skip irrelevant events.
 * Private deletion notifications carry only `id` and `organization_id`;
 * a filter must treat a missing column as relevant.
 */

export type LiveViewResult<T> = { ok: true; data: T } | { ok: false; error?: string };

export type UseLiveViewOptions<T> = {
  /** Tables whose events invalidate this view. */
  tables: readonly RealtimeTable[];
  /**
   * The authoritative reader: a `readInBackground` call of a kind registered in
   * lib/data/background-reads.ts, given the request's `signal`. Never a Server
   * Action: the view reads on mount, on every event and beside a save, and a
   * Server Action read would queue ahead of the user's next save.
   */
  read: (request: { invalidatedAt: number; signal: AbortSignal }) => Promise<LiveViewResult<T>>;
  /**
   * Server-rendered data for the initial paint. When present, the mount read
   * is skipped (the route render just produced this data).
   */
  initialData?: T | undefined;
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
  /** Let a same-scope event read finish, then catch up once for events received meanwhile. */
  coalesceWhileReading?: boolean;
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

/**
 * The shared debounce with a bounded maximum deferral: a burst lands as one
 * read, a sustained stream reads at least once a second. The marker shows the
 * queued read until it runs or a suspension or reset cancels it.
 */
function createMarkedScheduler(run: () => void, marker: LiveReadMarker): TrailingScheduler {
  const scheduler = createTrailingScheduler({
    delayMs: REALTIME_DEBOUNCE_MS,
    maxWaitMs: REALTIME_MAX_DEFER_MS,
    run: () => {
      marker.queued(false);
      run();
    },
  });
  return {
    schedule: () => {
      marker.queued(true);
      scheduler.schedule();
    },
    cancel: () => {
      marker.queued(false);
      return scheduler.cancel();
    },
    pending: scheduler.pending,
  };
}

type ReadGuardRefs = {
  generationRef: RefObject<number>;
  floorGenerationRef: RefObject<number>;
  dataGenerationRef: RefObject<number>;
  statusGenerationRef: RefObject<number>;
  readControllerRef: RefObject<AbortController | null>;
};

type ReaderRefs<T> = {
  readRef: RefObject<UseLiveViewOptions<T>['read']>;
  enabledRef: RefObject<boolean>;
  invalidatedAtRef: RefObject<number>;
  hasDataRef: RefObject<boolean>;
  liveRead: LiveReadMarker;
};

type ReadStateSetters<T> = {
  setData: Dispatch<SetStateAction<T | undefined>>;
  setIsRefreshing: Dispatch<SetStateAction<boolean>>;
  setIsStale: Dispatch<SetStateAction<boolean>>;
  setError: Dispatch<SetStateAction<string | null>>;
  setHasSettled: Dispatch<SetStateAction<boolean>>;
};

type DataSetters<T> = Omit<ReadStateSetters<T>, 'setIsRefreshing'>;

/** One generation-guarded read: the contract above decides what each result may commit. */
async function runGuardedRead<T>(
  guards: ReadGuardRefs,
  reader: ReaderRefs<T>,
  setters: ReadStateSetters<T>,
): Promise<void> {
  const { generationRef, floorGenerationRef, dataGenerationRef, statusGenerationRef, readControllerRef } =
    guards;
  const { readRef, enabledRef, invalidatedAtRef, hasDataRef, liveRead } = reader;
  const { setData, setIsRefreshing, setIsStale, setError, setHasSettled } = setters;
  if (!enabledRef.current) return;
  const generation = ++generationRef.current;
  readControllerRef.current?.abort();
  const controller = new AbortController();
  readControllerRef.current = controller;
  liveRead.reading(true);
  setIsRefreshing(true);
  const obsolete = () => generation <= floorGenerationRef.current;
  try {
    const result = await readRef.current({
      invalidatedAt: invalidatedAtRef.current,
      signal: controller.signal,
    });
    if (obsolete()) return;
    // A read cancelled by a newer one reports the abort as a failure when
    // its transport honours the signal (the clock GET); that is not a
    // failed read and must not flash an error before the newer read lands.
    // A reader that ignored the abort and still returned data is applied.
    if (!result.ok && controller.signal.aborted) return;
    const newestCompleted = generation > statusGenerationRef.current;
    if (newestCompleted) statusGenerationRef.current = generation;
    if (result.ok) {
      if (generation > dataGenerationRef.current) {
        dataGenerationRef.current = generation;
        hasDataRef.current = true;
        setData(result.data);
      }
      if (newestCompleted) {
        setIsStale(false);
        setError(null);
      }
    } else if (newestCompleted) {
      // Keep-last-known: existing data stays visible, marked stale.
      setIsStale(hasDataRef.current);
      setError(result.error ?? null);
    }
  } catch (readError) {
    if (obsolete() || controller.signal.aborted || generation <= statusGenerationRef.current) return;
    statusGenerationRef.current = generation;
    logError('live_view.read_failed', readError);
    setIsStale(hasDataRef.current);
    // A thrown read carries no structured reason; clear any previous one so
    // surfaces fall back to their own generic message instead of rendering
    // an outdated error.
    setError(null);
  } finally {
    if (readControllerRef.current === controller) readControllerRef.current = null;
    if (generation === generationRef.current) {
      liveRead.reading(false);
      setIsRefreshing(false);
      setHasSettled(true);
    }
  }
}

/**
 * What the reset effect does on this run. `initialData` only suppresses the
 * very first read; a resetKey change always reads fresh.
 */
function nextResetStep(
  lastResetKeyRef: RefObject<string | null | undefined>,
  resetKey: string | null,
  hasInitialData: boolean,
): 'reset' | 'skip' | 'read' {
  const isFirstRun = lastResetKeyRef.current === undefined;
  const resetChanged = !isFirstRun && lastResetKeyRef.current !== resetKey;
  lastResetKeyRef.current = resetKey;
  if (resetChanged) return 'reset';
  return isFirstRun && hasInitialData ? 'skip' : 'read';
}

/** A scope change drops the data and its status; the next read starts from loading. */
function discardViewData<T>(hasDataRef: RefObject<boolean>, setters: DataSetters<T>): void {
  hasDataRef.current = false;
  setters.setData(undefined);
  setters.setIsStale(false);
  setters.setError(null);
  setters.setHasSettled(false);
}

/** The optimistic local echo: new data, settled and fresh. */
function applyLocalEcho<T>(
  updater: (previous: T | undefined) => T | undefined,
  hasDataRef: RefObject<boolean>,
  setters: DataSetters<T>,
): void {
  setters.setData((previous) => {
    const next = updater(previous);
    hasDataRef.current = next !== undefined;
    return next;
  });
  setters.setIsStale(false);
  setters.setError(null);
  setters.setHasSettled(true);
}

/** Every read so far becomes obsolete, the one in flight aborts and a queued one is dropped. */
function discardReads(
  supersedeReads: () => void,
  readControllerRef: RefObject<AbortController | null>,
  clearTimer: () => void,
): void {
  supersedeReads();
  readControllerRef.current?.abort();
  readControllerRef.current = null;
  clearTimer();
}

/** Callbacks that never change identity read the latest reader, filter and enabled flag. */
function useLatestOptions<T>(
  refs: Pick<ReaderRefs<T>, 'readRef' | 'enabledRef'> & {
    eventFilterRef: RefObject<UseLiveViewOptions<T>['eventFilter']>;
  },
  options: {
    read: UseLiveViewOptions<T>['read'];
    eventFilter: UseLiveViewOptions<T>['eventFilter'];
    enabled: boolean;
  },
): void {
  const { readRef, eventFilterRef, enabledRef } = refs;
  const { read, eventFilter, enabled } = options;
  useEffect(() => {
    readRef.current = read;
    eventFilterRef.current = eventFilter;
    enabledRef.current = enabled;
  });
}

type SchedulingRefs = {
  enabledRef: RefObject<boolean>;
  invalidatedAtRef: RefObject<number>;
  suspendedRef: RefObject<boolean>;
  pendingWhileSuspendedRef: RefObject<boolean>;
  schedulerRef: RefObject<TrailingScheduler | null>;
  eventFilterRef: RefObject<((event: RealtimeChangeEvent) => boolean) | undefined>;
};

type SchedulingInputs = {
  runRead: () => Promise<void>;
  liveRead: LiveReadMarker;
  clearTimer: () => void;
  suspended: boolean;
};

type SubscriptionInputs = {
  subscribe: ReturnType<typeof useRealtimeSubscribe>;
  tables: readonly RealtimeTable[];
  enabled: boolean;
  serverData: boolean;
};

/**
 * Events schedule one debounced read through the shared scheduler. While
 * suspended they queue; leaving the suspension fires exactly one catch-up read.
 */
function useEventReads(
  refs: SchedulingRefs,
  inputs: SchedulingInputs,
  subscription: SubscriptionInputs,
): void {
  const {
    enabledRef,
    invalidatedAtRef,
    suspendedRef,
    pendingWhileSuspendedRef,
    schedulerRef,
    eventFilterRef,
  } = refs;
  const { runRead, liveRead, clearTimer, suspended } = inputs;
  const { subscribe, tables, enabled, serverData } = subscription;

  const scheduleRead = useCallback(
    (recordInvalidation = true) => {
      if (!enabledRef.current) return;
      if (recordInvalidation) invalidatedAtRef.current = performance.now();
      if (suspendedRef.current) {
        pendingWhileSuspendedRef.current = true;
        return;
      }
      schedulerRef.current ??= createMarkedScheduler(() => void runRead(), liveRead);
      schedulerRef.current.schedule();
    },
    [runRead, pendingWhileSuspendedRef, liveRead, enabledRef, invalidatedAtRef, suspendedRef, schedulerRef],
  );

  // Suspension boundary: entering drops a pending timer into the queue flag;
  // leaving fires exactly one catch-up read.
  useEffect(() => {
    suspendedRef.current = suspended;
    if (suspended) {
      if (schedulerRef.current?.cancel()) {
        pendingWhileSuspendedRef.current = true;
      }
      return;
    }
    if (pendingWhileSuspendedRef.current) {
      pendingWhileSuspendedRef.current = false;
      scheduleRead(false);
    }
  }, [suspended, clearTimer, scheduleRead, pendingWhileSuspendedRef, suspendedRef, schedulerRef]);

  useRealtimeTables({
    subscribe,
    tables,
    enabled,
    serverData,
    onEvent: (event: RealtimeChangeEvent) => {
      if (shouldScheduleRealtimeRefresh(event, eventFilterRef.current)) scheduleRead();
    },
  });
}

/**
 * Leaving a scope (disable, reset, unmount) discards its reads; `refresh`
 * reads now, bypassing the debounce and the suspension.
 */
function useScopeTeardown(
  refs: {
    readControllerRef: RefObject<AbortController | null>;
    pendingWhileSuspendedRef: RefObject<boolean>;
  },
  actions: { clearTimer: () => void; supersedeReads: () => void; runRead: () => Promise<void> },
  scope: { enabled: boolean; resetKey: string | null },
): () => Promise<void> {
  const { readControllerRef, pendingWhileSuspendedRef } = refs;
  const { clearTimer, supersedeReads, runRead } = actions;
  const { enabled, resetKey } = scope;

  useEffect(() => {
    return () => discardReads(supersedeReads, readControllerRef, clearTimer);
  }, [clearTimer, enabled, resetKey, supersedeReads, readControllerRef]);

  return useCallback(async () => {
    clearTimer();
    pendingWhileSuspendedRef.current = false;
    await runRead();
  }, [clearTimer, runRead, pendingWhileSuspendedRef]);
}

/** The returned view keeps its identity until a value in it changes. */
function useViewState<T>(
  state: Pick<LiveViewState<T>, 'data' | 'isStale' | 'error'> & {
    enabled: boolean;
    hasSettled: boolean;
    isRefreshing: boolean;
  },
  actions: Pick<LiveViewState<T>, 'refresh' | 'invalidate'> & {
    setDataExternally: LiveViewState<T>['setData'];
  },
): LiveViewState<T> {
  const { data, enabled, hasSettled, isRefreshing, isStale, error } = state;
  const { refresh, invalidate, setDataExternally } = actions;
  return useMemo<LiveViewState<T>>(
    () => ({
      data,
      isLoading: enabled && !hasSettled,
      isRefreshing: enabled && isRefreshing,
      isStale,
      error,
      refresh,
      invalidate,
      setData: setDataExternally,
    }),
    [data, enabled, hasSettled, isRefreshing, isStale, error, refresh, invalidate, setDataExternally],
  );
}

export function useLiveView<T>(options: UseLiveViewOptions<T>): LiveViewState<T> {
  const { tables, read, initialData, eventFilter, enabled = true, suspend = false } = options;
  const { coalesceWhileReading = false, resetKey = null } = options;

  const subscribe = useRealtimeSubscribe();
  const anyDialogOpen = useAnyDialogOpen();

  const [data, setData] = useState<T | undefined>(initialData);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const suspended = anyDialogOpen || suspend || (coalesceWhileReading && isRefreshing);
  const [isStale, setIsStale] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Settled means at least one read completed (or server data made a read
  // unnecessary): isLoading must not stay true after a failed first read.
  const [hasSettled, setHasSettled] = useState(initialData !== undefined);

  const generationRef = useRef(0);
  // Results at or below the floor are obsolete (invalidation, reset, unmount).
  // Data commits only above the last committed generation; stale/error follow
  // the newest completed read.
  const floorGenerationRef = useRef(0);
  const dataGenerationRef = useRef(0);
  const statusGenerationRef = useRef(0);
  const readControllerRef = useRef<AbortController | null>(null);
  const schedulerRef = useRef<TrailingScheduler | null>(null);
  const pendingWhileSuspendedRef = useHeldReadFlag();
  const liveRead = useLiveReadMarker();
  const suspendedRef = useRef(suspended);
  const readRef = useRef(read);
  const eventFilterRef = useRef(eventFilter);
  const hasDataRef = useRef(initialData !== undefined);
  const enabledRef = useRef(enabled);
  const invalidatedAtRef = useRef(0);

  useLatestOptions({ readRef, eventFilterRef, enabledRef }, { read, eventFilter, enabled });

  const clearTimer = useCallback(() => {
    schedulerRef.current?.cancel();
  }, []);

  /** Every read allocated so far becomes obsolete: its result must not commit. */
  const supersedeReads = useCallback(() => {
    floorGenerationRef.current = ++generationRef.current;
    // A superseded read can no longer clear its own marker.
    liveRead.reading(false);
  }, [liveRead]);

  const runRead = useCallback(
    () =>
      runGuardedRead(
        { generationRef, floorGenerationRef, dataGenerationRef, statusGenerationRef, readControllerRef },
        { readRef, enabledRef, invalidatedAtRef, hasDataRef, liveRead },
        { setData, setIsRefreshing, setIsStale, setError, setHasSettled },
      ),
    [liveRead],
  );

  useEventReads(
    { enabledRef, invalidatedAtRef, suspendedRef, pendingWhileSuspendedRef, schedulerRef, eventFilterRef },
    { runRead, liveRead, clearTimer, suspended },
    { subscribe, tables, enabled, serverData: initialData !== undefined },
  );

  // Initial read, reset handling, and enable transitions.
  const lastResetKeyRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (!enabled) return;
    const step = nextResetStep(lastResetKeyRef, resetKey, initialData !== undefined);
    if (step === 'reset') {
      supersedeReads();
      clearTimer();
      pendingWhileSuspendedRef.current = false;
      discardViewData(hasDataRef, { setData, setIsStale, setError, setHasSettled });
    }
    if (step !== 'skip') void runRead();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initialData is mount-time data only (freshness contract rule 3)
  }, [enabled, resetKey, clearTimer, runRead, supersedeReads]);

  const refresh = useScopeTeardown(
    { readControllerRef, pendingWhileSuspendedRef },
    { clearTimer, supersedeReads, runRead },
    { enabled, resetKey },
  );

  const invalidate = useCallback(() => {
    discardReads(supersedeReads, readControllerRef, clearTimer);
    // A discarded in-flight read can no longer clear this flag (its
    // generation no longer matches), so settle it here.
    setIsRefreshing(false);
  }, [clearTimer, supersedeReads]);

  const setDataExternally = useCallback(
    (updater: (previous: T | undefined) => T | undefined) =>
      applyLocalEcho(updater, hasDataRef, { setData, setIsStale, setError, setHasSettled }),
    [],
  );

  return useViewState(
    { data, enabled, hasSettled, isRefreshing, isStale, error },
    { refresh, invalidate, setDataExternally },
  );
}
