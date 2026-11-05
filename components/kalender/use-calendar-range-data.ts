'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
} from 'react';

import { useLiveView } from '@/hooks/use-live-view';
import { EMPTY_CALENDAR_BOARD, type CalendarBoardContext } from '@/lib/calendar/board';
import { getCalendarBoard, fetchCalendarWindow } from '@/lib/calendar/client';
import {
  composeCalendarReadiness,
  createDatasetState,
  datasetNeedsRead,
  holdsUnconfirmedEdits,
  presentDataset,
  readCommitted,
  reduceCalendarRange,
  type CalendarRangeAction,
  type CalendarRangeState,
  type CalendarReadiness,
} from '@/lib/calendar/range-data';
import { rangeCovers, type CalendarFetchRange } from '@/lib/calendar/navigation';
import {
  canReuseWindowRead,
  followSupersededReads,
  planRunningWindowRead,
  windowRangeToRead,
  type WindowReadPurpose,
} from '@/lib/calendar/window-read-plan';
import type { CalendarJob } from '@/lib/jobs/types';
import { REALTIME_DEBOUNCE_MS, REALTIME_MAX_DEFER_MS } from '@/lib/realtime/events';
import { createTrailingScheduler } from '@/lib/realtime/scheduler';
import type { SicknessCalendarEntry } from '@/lib/sickness/actions';
import type { EntryChangeRequestMap, TimeEntry } from '@/lib/time-tracking/types';
import { EMPTY_HOLIDAY_CALENDAR, type OrganizationHolidayCalendar } from '@/lib/personnel/targets';
import { toLocalDateString } from '@/lib/utils';
import type { VacationCalendarEntry } from '@/lib/vacation/calendar-actions';

/**
 * The calendar's data owner (Step 2, PF-02 to PF-06, PF-23; P1-24a adds the
 * board context). One reducer state holds every range-scoped dataset with its
 * coverage and generation; the live-view primitive supplies the Realtime
 * signals, dialog suspension and catch-up; this hook adds range coverage,
 * mutation ownership and the one authoritative read after a mutation settles.
 * Five datasets arrive from the private window GET and the sixth from the
 * board GET, both started together and committed under one generation.
 * Nothing else in the calendar fetches range data.
 */

type CalendarDatasets = {
  entries: TimeEntry[];
  jobs: CalendarJob[];
  vacation: VacationCalendarEntry[];
  sickness: SicknessCalendarEntry[];
  holidays: OrganizationHolidayCalendar;
  board: CalendarBoardContext;
};
export type CalendarDataset = keyof CalendarDatasets;

const ALL_DATASETS: readonly CalendarDataset[] = [
  'entries',
  'jobs',
  'vacation',
  'sickness',
  'holidays',
  'board',
];
const EMPTY: CalendarDatasets = {
  entries: [],
  jobs: [],
  vacation: [],
  sickness: [],
  holidays: EMPTY_HOLIDAY_CALENDAR,
  board: EMPTY_CALENDAR_BOARD,
};

/** Server-rendered data with the exact range it was read for. */
export type CalendarInitialData = {
  range: CalendarFetchRange;
  entries?: TimeEntry[];
  changeRequestMap?: EntryChangeRequestMap;
  jobs?: CalendarJob[];
  vacation?: VacationCalendarEntry[];
  sickness?: SicknessCalendarEntry[];
  holidays?: OrganizationHolidayCalendar | undefined;
  board?: CalendarBoardContext;
};

type State = CalendarRangeState<CalendarDatasets>;
type Action = CalendarRangeAction<CalendarDatasets>;
type Generations = Record<CalendarDataset, number>;
/**
 * `superseded`: a newer read, a mutation, a scope change or navigation took
 * over before this read could commit. It is neither a success nor a failure.
 */
type WindowReadOutcome = 'committed' | 'failed' | 'superseded';
type InFlightRead = {
  scopeKey: string;
  controller: AbortController;
  startedAt: number;
  generations: Generations;
  range: CalendarFetchRange;
  /** Upgraded to `freshness` when a catch-up, settlement or refresh shares the read. */
  purpose: WindowReadPurpose;
  promise: Promise<WindowReadOutcome>;
};

/** The window GET and the board GET for one range, started together; a transport failure is a failed read. */
function readWindowPair(organizationId: string, range: CalendarFetchRange, signal: AbortSignal) {
  const dates = { fromDate: toLocalDateString(range.start), toDate: toLocalDateString(range.end) };
  return Promise.all([
    fetchCalendarWindow(
      {
        organizationId,
        from: range.start.toISOString(),
        to: range.end.toISOString(),
        ...dates,
      },
      signal,
    ).catch(() => ({ success: false as const, error: 'unexpected_error' })),
    getCalendarBoard({ organizationId, ...dates }, signal).catch(() => ({
      success: false as const,
      error: 'unexpected_error',
    })),
  ]);
}

type WindowPair = Awaited<ReturnType<typeof readWindowPair>>;

/** The six datasets of one successful window pair. */
function windowDatasets(
  window: Extract<WindowPair[0], { success: true }>,
  board: Extract<WindowPair[1], { success: true }>,
): CalendarDatasets {
  return {
    entries: window.entries,
    jobs: window.jobs,
    vacation: window.vacation,
    sickness: window.sickness,
    holidays: window.holidays,
    board: {
      rows: board.rows,
      days: board.days,
      dispatch: board.dispatch,
      materialDemandJobIds: board.materialDemandJobIds,
    },
  };
}

/** Async ownership belongs to one caller scope, including its pending waiters. */
class CalendarMutationOwnership {
  active = true;
  count = 0;
  waiting: Array<(outcome: WindowReadOutcome) => void> = [];
  // The settlement read waits for the shared debounce and its maximum deferral.
  scheduled: (() => void) | null = null;
  readonly settlementRead = createTrailingScheduler({
    delayMs: REALTIME_DEBOUNCE_MS,
    maxWaitMs: REALTIME_MAX_DEFER_MS,
    run: () => {
      const callback = this.scheduled;
      this.scheduled = null;
      callback?.();
    },
  });

  constructor(readonly scopeKey: string) {}
  begin(): void {
    this.count += 1;
    this.cancelTimer();
  }
  settle(): void {
    this.count = Math.max(0, this.count - 1);
  }
  cancelTimer(): void {
    this.settlementRead.cancel();
    this.scheduled = null;
  }
  schedule(callback: () => void): void {
    this.scheduled = callback;
    this.settlementRead.schedule();
  }
  activate(): void {
    this.active = true;
  }
  dispose(): void {
    this.active = false;
    this.cancelTimer();
    for (const resolve of this.waiting.splice(0)) resolve('superseded');
  }
}

/**
 * Generation allocation is synchronous and monotonic per dataset. The
 * reducer keeps the current value (and bumps it itself on a scope reset);
 * `stateRef` mirrors the latest state so allocation and response matching
 * never read React state inside async code.
 */
function useRangeGenerations(state: State) {
  const stateRef = useRef(state);
  const generationsRef = useRef<Generations>({
    entries: 0,
    jobs: 0,
    vacation: 0,
    sickness: 0,
    holidays: 0,
    board: 0,
  });
  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  const currentGeneration = useCallback(
    (dataset: CalendarDataset): number =>
      Math.max(generationsRef.current[dataset], stateRef.current.datasets[dataset].generation),
    [],
  );
  const allocateGeneration = useCallback(
    (dataset: CalendarDataset): number => {
      const next = currentGeneration(dataset) + 1;
      generationsRef.current[dataset] = next;
      return next;
    },
    [currentGeneration],
  );
  return { stateRef, currentGeneration, allocateGeneration };
}

function reducer(state: State, action: Action): State {
  return reduceCalendarRange(state, action);
}

function createInitialState(input: {
  organizationId: string;
  initial?: CalendarInitialData | undefined;
}): State {
  const { initial } = input;
  const seeded = <Value>(value: Value | undefined, empty: Value) =>
    createDatasetState<Value>(value ?? empty, value !== undefined && initial ? initial.range : null);
  return {
    scopeKey: input.organizationId,
    datasets: {
      entries: seeded(initial?.entries, EMPTY.entries),
      jobs: seeded(initial?.jobs, EMPTY.jobs),
      vacation: seeded(initial?.vacation, EMPTY.vacation),
      sickness: seeded(initial?.sickness, EMPTY.sickness),
      holidays: seeded(initial?.holidays, EMPTY.holidays),
      board: seeded(initial?.board, EMPTY.board),
    },
  };
}

type WindowRead = (
  requestedRange: CalendarFetchRange,
  purpose: WindowReadPurpose,
  invalidatedAt?: number,
) => Promise<WindowReadOutcome>;

/** The scope one window read belongs to and the refs it reads and writes. */
type WindowReadScope = {
  organizationId: string;
  scopeKey: string;
  ownership: CalendarMutationOwnership;
  stateRef: RefObject<State>;
  inFlightRef: RefObject<InFlightRead | null>;
  onReadFailedRef: RefObject<() => void>;
};

/** What a window read commits through: the reducer, the change requests and the generation owner. */
type WindowReadCommit = {
  dispatch: Dispatch<Action>;
  setChangeRequestMap: Dispatch<EntryChangeRequestMap>;
  currentGeneration: (dataset: CalendarDataset) => number;
  allocateGeneration: (dataset: CalendarDataset) => number;
};

/** Awaits the pair of one read and commits it, unless a newer read, a mutation or a scope change took over. */
async function settleWindowRead(
  { organizationId, scopeKey, ownership, stateRef, inFlightRef, onReadFailedRef }: WindowReadScope,
  { dispatch, setChangeRequestMap, currentGeneration }: WindowReadCommit,
  range: CalendarFetchRange,
  generations: Generations,
  signal: AbortSignal,
): Promise<WindowReadOutcome> {
  const [window, board] = await readWindowPair(organizationId, range, signal);
  if (inFlightRef.current?.generations === generations) inFlightRef.current = null;
  // A superseded generation is ignored by the reducer; only the newest
  // request may report a failure banner or commit data.
  const current = ALL_DATASETS.filter((dataset) => currentGeneration(dataset) === generations[dataset]);
  if (!ownership.active || stateRef.current.scopeKey !== scopeKey || current.length === 0)
    return 'superseded';
  if (!window.success || !board.success) {
    for (const dataset of current) {
      dispatch({ type: 'read-failed', scopeKey, dataset, generation: generations[dataset], range });
    }
    onReadFailedRef.current();
    return 'failed';
  }
  const data = windowDatasets(window, board);
  for (const dataset of current) {
    dispatch(
      readCommitted<CalendarDatasets, typeof dataset>({
        scopeKey,
        dataset,
        generation: generations[dataset],
        range,
        data: data[dataset],
      }),
    );
  }
  if (current.includes('entries')) {
    setChangeRequestMap(window.changeRequestMap);
  }
  return current.length === ALL_DATASETS.length ? 'committed' : 'superseded';
}

/**
 * Starts one generation-guarded read of the whole window: the window GET
 * and the board GET together. A read for the same range whose generations
 * are all still current is reused instead of duplicated, so the mutation
 * catch-up, a queued Realtime catch-up and the range effect firing together
 * cost one request pair.
 */
function startWindowRead(
  scope: WindowReadScope,
  commit: WindowReadCommit,
  {
    requestedRange,
    purpose,
    invalidatedAt,
  }: {
    requestedRange: CalendarFetchRange;
    purpose: WindowReadPurpose;
    invalidatedAt: number | undefined;
  },
): Promise<WindowReadOutcome> {
  const { scopeKey, ownership, stateRef, inFlightRef } = scope;
  const { dispatch, currentGeneration, allocateGeneration } = commit;
  if (!ownership.active || stateRef.current.scopeKey !== scopeKey) return Promise.resolve('superseded');
  if (ownership.count > 0) {
    return new Promise<WindowReadOutcome>((resolve) => ownership.waiting.push(resolve));
  }
  // Refresh the one committed window instead of shrinking week/month
  // coverage after a day-view edit. Never combine separate windows.
  const range = windowRangeToRead(
    ALL_DATASETS.map((dataset) => stateRef.current.datasets[dataset].coverage),
    requestedRange,
  );
  const running = inFlightRef.current;
  if (
    running &&
    canReuseWindowRead({
      running,
      scopeKey,
      range,
      invalidatedAt,
      datasets: ALL_DATASETS,
      currentGeneration,
    })
  ) {
    if (purpose === 'freshness') running.purpose = 'freshness';
    return running.promise;
  }
  const generations = {
    entries: allocateGeneration('entries'),
    jobs: allocateGeneration('jobs'),
    vacation: allocateGeneration('vacation'),
    sickness: allocateGeneration('sickness'),
    holidays: allocateGeneration('holidays'),
    board: allocateGeneration('board'),
  };
  for (const dataset of ALL_DATASETS) {
    dispatch({ type: 'read-started', scopeKey, dataset, generation: generations[dataset], range });
  }
  // Only obsolete generations are cancelled; a reused current read keeps its transport.
  running?.controller.abort();
  const controller = new AbortController();
  const startedAt = performance.now();
  const promise = settleWindowRead(scope, commit, range, generations, controller.signal);
  inFlightRef.current = { scopeKey, controller, startedAt, generations, range, purpose, promise };
  return promise;
}

/**
 * Keeps the needed window covered. When a required dataset does not cover
 * it, the whole window is read; in-flight and failed reads covering the
 * window do not restart, so this cannot loop. Returning to a covered window
 * cancels a read for another window before it replaces the covered data.
 * Returns the cancellation, which a mutation uses as well.
 */
function useWindowCoverage({
  scopeKey,
  needed,
  requiredDatasets,
  state,
  readWindow,
  inFlightRef,
  dispatch,
  allocateGeneration,
}: {
  scopeKey: string;
  needed: CalendarFetchRange;
  requiredDatasets: readonly CalendarDataset[];
  state: State;
  readWindow: WindowRead;
  inFlightRef: RefObject<InFlightRead | null>;
  dispatch: Dispatch<Action>;
  allocateGeneration: (dataset: CalendarDataset) => number;
}): () => void {
  /** Moves every generation past the running read, so it can neither commit nor report a failure. */
  const cancelRunningRead = useCallback(() => {
    const obsolete = inFlightRef.current;
    inFlightRef.current = null;
    for (const dataset of ALL_DATASETS) {
      dispatch({ type: 'reads-invalidated', scopeKey, dataset, generation: allocateGeneration(dataset) });
    }
    obsolete?.controller.abort();
  }, [allocateGeneration, dispatch, inFlightRef, scopeKey]);

  useEffect(() => {
    const running = inFlightRef.current;
    const plan = planRunningWindowRead({
      running: running?.scopeKey === scopeKey ? running : null,
      needed,
      neededCovered: requiredDatasets.every((dataset) => {
        const coverage = state.datasets[dataset].coverage;
        return coverage !== null && rangeCovers(coverage, needed);
      }),
    });
    if (plan !== 'keep') {
      cancelRunningRead();
      if (plan === 'replace') void readWindow(needed, 'freshness');
      return;
    }
    if (requiredDatasets.some((dataset) => datasetNeedsRead(state.datasets[dataset], needed))) {
      void readWindow(needed, 'coverage');
    }
  }, [needed, requiredDatasets, state, readWindow, cancelRunningRead, scopeKey, inFlightRef]);

  return cancelRunningRead;
}

/** The one authoritative read after the user's own change, joined by every read that waited for it. */
function runSettlementRead(
  ownership: CalendarMutationOwnership,
  readWindow: WindowRead,
  neededRef: RefObject<CalendarFetchRange>,
  readPlanningExtrasRef: RefObject<(() => Promise<boolean>) | undefined>,
  onReadFailedRef: RefObject<() => void>,
): void {
  if (ownership.count > 0) return;
  const waiting = ownership.waiting.splice(0);
  void readWindow(neededRef.current, 'freshness').then((outcome) => {
    for (const resolve of waiting) resolve(outcome);
  });
  // The extras reader reports its own failed reads and answers `false` for a
  // superseded or out-of-scope read, which is not a failure (A1-30 showed the
  // stale notice replacing the success banner when it was treated as one).
  // Only a rejected promise is an unreported failure.
  void readPlanningExtrasRef.current?.().catch(() => onReadFailedRef.current());
}

/** Ends the owner with its scope: waiters resolve as superseded and its running read aborts. */
function useOwnershipLifetime(
  ownership: CalendarMutationOwnership,
  inFlightRef: RefObject<InFlightRead | null>,
): void {
  useEffect(() => {
    ownership.activate();
    return () => {
      ownership.dispose();
      const obsolete = inFlightRef.current;
      if (obsolete?.scopeKey === ownership.scopeKey) {
        inFlightRef.current = null;
        obsolete.controller.abort();
      }
    };
  }, [ownership, inFlightRef]);
}

/** The optimistic local edits of the two editable datasets, bound to the current scope. */
function useDatasetUpdaters(scopeKey: string, dispatch: Dispatch<Action>) {
  const updateEntries = useCallback(
    (update: (previous: TimeEntry[]) => TimeEntry[]) =>
      dispatch({ type: 'data-updated', scopeKey, dataset: 'entries', update }),
    [dispatch, scopeKey],
  );
  const updateJobs = useCallback(
    (update: (previous: CalendarJob[]) => CalendarJob[]) =>
      dispatch({ type: 'data-updated', scopeKey, dataset: 'jobs', update }),
    [dispatch, scopeKey],
  );
  return { updateEntries, updateJobs };
}

// Every table whose change can alter one of the six datasets. Provisional
// corrections are projected from `time_correction_requests` (PF-05); the
// board context follows schedules, teams, memberships and dispatches.
const CALENDAR_TABLES = [
  'organization_closure_days',
  'organization_settings',
  'time_entries',
  'time_sessions',
  'time_segments',
  'entry_change_requests',
  'time_correction_requests',
  'jobs',
  'projects',
  'clients',
  'job_assignments',
  'planning_series',
  'planning_occurrences',
  'planning_occurrence_assignments',
  'planning_dispatches',
  'planning_dispatch_acknowledgements',
  'organization_members',
  'employee_records',
  'work_schedules',
  'team_memberships',
  'vacation_requests',
  'sickness_reports',
] as const;

/**
 * Realtime consumption: one adapter for every calendar table, reporting the
 * real read outcome. `suspend` queues events during the user's own mutation
 * instead of dropping them; exactly one catch-up follows when ownership
 * ends (PF-04).
 */
function useCalendarLiveRead({
  readWindow,
  ownership,
  stateRef,
  scopeKey,
  neededRef,
  readPlanningExtrasRef,
  isMutating,
}: {
  readWindow: WindowRead;
  ownership: CalendarMutationOwnership;
  stateRef: RefObject<State>;
  scopeKey: string;
  neededRef: RefObject<CalendarFetchRange>;
  readPlanningExtrasRef: RefObject<(() => Promise<boolean>) | undefined>;
  isMutating: boolean;
}): void {
  useLiveView<null>({
    tables: CALENDAR_TABLES,
    read: async ({ invalidatedAt }) => {
      const outcome = await followSupersededReads(
        () => readWindow(neededRef.current, 'freshness', invalidatedAt),
        () => ownership.active && stateRef.current.scopeKey === scopeKey,
      );
      const extrasOk = ownership.active
        ? await (readPlanningExtrasRef.current?.() ?? Promise.resolve(true))
        : false;
      return outcome === 'committed' && extrasOk ? { ok: true, data: null } : { ok: false };
    },
    initialData: null,
    suspend: isMutating,
  });
}

/** The refresh control's read: the current window, then the extras while the owner lives. */
function useRefreshAll(
  readWindow: WindowRead,
  ownership: CalendarMutationOwnership,
  neededRef: RefObject<CalendarFetchRange>,
  readPlanningExtrasRef: RefObject<(() => Promise<boolean>) | undefined>,
): () => Promise<void> {
  return useCallback(async () => {
    await readWindow(neededRef.current, 'freshness');
    if (ownership.active) await readPlanningExtrasRef.current?.();
  }, [readWindow, ownership, neededRef, readPlanningExtrasRef]);
}

/** The composed readiness of the datasets the view renders. */
function useRangeReadiness(
  requiredDatasets: readonly CalendarDataset[],
  state: State,
  needed: CalendarFetchRange,
): CalendarReadiness {
  return useMemo(
    () =>
      composeCalendarReadiness(
        requiredDatasets.map((dataset) => presentDataset(state.datasets[dataset], needed)),
      ),
    [requiredDatasets, state, needed],
  );
}

export type UseCalendarRangeDataOptions = {
  organizationId: string;
  /** Verified caller and role identity; permission changes discard retained data. */
  identityKey: string;
  /** The window the current view renders. */
  needed: CalendarFetchRange;
  /** Datasets the current view renders; only these gate readiness. */
  requiredDatasets: readonly CalendarDataset[];
  initial?: CalendarInitialData | undefined;
  /** Called once per failed read so the surface can show its persistent banner. */
  onReadFailed: () => void;
  /**
   * Extra reads that belong to the planning invalidation set but are not
   * range-scoped (parked jobs). Their outcome joins the adapter's
   * truthfulness; they never gate range readiness.
   */
  readPlanningExtras?: () => Promise<boolean>;
};

export type CalendarRangeData = {
  entries: TimeEntry[];
  jobs: CalendarJob[];
  vacation: VacationCalendarEntry[];
  sickness: SicknessCalendarEntry[];
  holidays: OrganizationHolidayCalendar;
  board: CalendarBoardContext;
  changeRequestMap: EntryChangeRequestMap;
  readiness: CalendarReadiness;
  /** True while the initiating user's own mutation still owns the data. */
  isMutating: boolean;
  /** True from an optimistic edit until a committed read replaced it (lib/ui/unconfirmed.ts). */
  isUnconfirmed: boolean;
  updateEntries: (update: (previous: TimeEntry[]) => TimeEntry[]) => void;
  updateJobs: (update: (previous: CalendarJob[]) => CalendarJob[]) => void;
  /** Takes ownership and returns this operation's idempotent, scope-bound release. */
  beginMutation: () => () => void;
  /** Reads the current window; awaited by the refresh control. */
  refreshAll: () => Promise<void>;
};

/** An operation's idempotent release. */
function releaseOnce(release: () => void): () => void {
  let released = false;
  return () => {
    if (released) return;
    released = true;
    release();
  };
}

/** The six datasets' current data and whether an optimistic edit still waits for a committed read. */
function datasetValues(state: State) {
  return {
    entries: state.datasets.entries.data,
    jobs: state.datasets.jobs.data,
    vacation: state.datasets.vacation.data,
    sickness: state.datasets.sickness.data,
    holidays: state.datasets.holidays.data,
    board: state.datasets.board.data,
    isUnconfirmed: holdsUnconfirmedEdits(ALL_DATASETS.map((dataset) => state.datasets[dataset])),
  };
}

export function useCalendarRangeData(options: UseCalendarRangeDataOptions): CalendarRangeData {
  const { organizationId, needed, requiredDatasets, onReadFailed, readPlanningExtras } = options;
  const scopeKey = `${organizationId}:${options.identityKey}`;
  const ownership = useMemo(() => new CalendarMutationOwnership(scopeKey), [scopeKey]);
  const [state, dispatch] = useReducer(
    reducer,
    { organizationId: scopeKey, initial: options.initial },
    createInitialState,
  );
  const [changeRequestMap, setChangeRequestMap] = useState<EntryChangeRequestMap>(
    options.initial?.changeRequestMap ?? {},
  );
  const [mutationCount, setMutationCount] = useState(0);

  const { stateRef, currentGeneration, allocateGeneration } = useRangeGenerations(state);

  const inFlightRef = useRef<InFlightRead | null>(null);
  const neededRef = useRef(needed);
  const onReadFailedRef = useRef(onReadFailed);
  const readPlanningExtrasRef = useRef(readPlanningExtras);
  useEffect(() => {
    neededRef.current = needed;
    onReadFailedRef.current = onReadFailed;
    readPlanningExtrasRef.current = readPlanningExtras;
  });

  // Organization switches must never show the previous organization's data:
  // reset synchronously during render (React's adjust-state-on-prop-change
  // pattern). The reducer moves every generation past in-flight responses.
  if (state.scopeKey !== scopeKey) {
    dispatch({ type: 'scope-reset', scopeKey, empty: EMPTY });
    setChangeRequestMap({});
    setMutationCount(0);
  }

  const readWindow = useCallback<WindowRead>(
    (requestedRange, purpose, invalidatedAt) =>
      startWindowRead(
        { organizationId, scopeKey, ownership, stateRef, inFlightRef, onReadFailedRef },
        { dispatch, setChangeRequestMap, currentGeneration, allocateGeneration },
        { requestedRange, purpose, invalidatedAt },
      ),
    [organizationId, scopeKey, ownership, allocateGeneration, currentGeneration, stateRef],
  );

  const coverage = { scopeKey, needed, requiredDatasets, state, readWindow, inFlightRef };
  const cancelRunningRead = useWindowCoverage({ ...coverage, dispatch, allocateGeneration });

  const isMutating = mutationCount > 0;

  const settleMutation = useCallback(() => {
    if (!ownership.active) return;
    ownership.settle();
    setMutationCount(ownership.count);
    if (ownership.count > 0) return;
    // The one guaranteed authoritative read after the user's own change: the
    // server action has already committed, so the shared debounce is the only
    // delay, and it coalesces a chain of undo/redo settlements.
    ownership.schedule(() =>
      runSettlementRead(ownership, readWindow, neededRef, readPlanningExtrasRef, onReadFailedRef),
    );
  }, [readWindow, ownership]);

  const beginMutation = useCallback((): (() => void) => {
    if (!ownership.active) return () => {};
    ownership.begin();
    setMutationCount(ownership.count);
    cancelRunningRead();
    return releaseOnce(settleMutation);
  }, [cancelRunningRead, ownership, settleMutation]);

  useOwnershipLifetime(ownership, inFlightRef);
  useCalendarLiveRead({
    readWindow,
    ownership,
    stateRef,
    scopeKey,
    neededRef,
    readPlanningExtrasRef,
    isMutating,
  });
  const refreshAll = useRefreshAll(readWindow, ownership, neededRef, readPlanningExtrasRef);
  const { updateEntries, updateJobs } = useDatasetUpdaters(scopeKey, dispatch);
  const readiness = useRangeReadiness(requiredDatasets, state, needed);

  return {
    ...datasetValues(state),
    changeRequestMap,
    readiness,
    isMutating,
    updateEntries,
    updateJobs,
    beginMutation,
    refreshAll,
  };
}
