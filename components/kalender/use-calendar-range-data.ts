"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";

import { useLiveView } from "@/hooks/use-live-view";
import { EMPTY_CALENDAR_BOARD, type CalendarBoardContext } from "@/lib/calendar/board";
import { getCalendarBoard, getCalendarWindow } from "@/lib/calendar/client";
import {
  composeCalendarReadiness,
  createDatasetState,
  datasetNeedsRead,
  presentDataset,
  readCommitted,
  reduceCalendarRange,
  type CalendarRangeAction,
  type CalendarRangeState,
  type CalendarReadiness,
} from "@/lib/calendar/range-data";
import { rangesEqual, type CalendarFetchRange } from "@/lib/calendar/navigation";
import type { CalendarJob } from "@/lib/jobs/types";
import { REALTIME_DEBOUNCE_MS } from "@/lib/realtime/events";
import type { SicknessCalendarEntry } from "@/lib/sickness/actions";
import type {
  EntryChangeRequestMap,
  TimeEntry,
} from "@/lib/time-tracking/types";
import { EMPTY_HOLIDAY_CALENDAR, type OrganizationHolidayCalendar } from "@/lib/personnel/targets";
import { toLocalDateString } from "@/lib/utils";
import type { VacationCalendarEntry } from "@/lib/vacation/actions";

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
  "entries",
  "jobs",
  "vacation",
  "sickness",
  "holidays",
  "board",
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

/** Async ownership belongs to one caller scope, including its pending waiters. */
class CalendarMutationOwnership {
  active = true;
  count = 0;
  timer: ReturnType<typeof setTimeout> | null = null;
  waiting: Array<(committed: boolean) => void> = [];

  constructor(readonly scopeKey: string) {}
  begin(): void { this.count += 1; this.cancelTimer(); }
  settle(): void { this.count = Math.max(0, this.count - 1); }
  cancelTimer(): void { if (this.timer) clearTimeout(this.timer); this.timer = null; }
  schedule(callback: () => void): void {
    this.cancelTimer();
    this.timer = setTimeout(() => { this.timer = null; callback(); }, REALTIME_DEBOUNCE_MS);
  }
  activate(): void { this.active = true; }
  dispose(): void {
    this.active = false;
    this.cancelTimer();
    for (const resolve of this.waiting.splice(0)) resolve(false);
  }
}

function reducer(state: State, action: Action): State {
  return reduceCalendarRange(state, action);
}

function createInitialState(input: {
  organizationId: string;
  initial?: CalendarInitialData | undefined;
}): State {
  const { initial } = input;
  const seeded = <Key extends CalendarDataset>(key: Key) => {
    const value = initial?.[key];
    return createDatasetState<CalendarDatasets[Key]>(
      (value ?? EMPTY[key]) as CalendarDatasets[Key],
      value !== undefined && initial ? initial.range : null,
    );
  };
  return {
    scopeKey: input.organizationId,
    datasets: {
      entries: seeded("entries"),
      jobs: seeded("jobs"),
      vacation: seeded("vacation"),
      sickness: seeded("sickness"),
      holidays: seeded("holidays"),
      board: seeded("board"),
    },
  };
}

// Every table whose change can alter one of the six datasets. Provisional
// corrections are projected from `time_correction_requests` (PF-05); the
// board context follows schedules, teams, memberships and dispatches.
const CALENDAR_TABLES = [
  "organization_closure_days",
  "organization_settings",
  "time_entries",
  "time_sessions",
  "time_segments",
  "entry_change_requests",
  "time_correction_requests",
  "jobs",
  "projects",
  "clients",
  "job_assignments",
  "planning_series",
  "planning_occurrences",
  "planning_occurrence_assignments",
  "planning_dispatches",
  "planning_dispatch_acknowledgements",
  "organization_members",
  "employee_records",
  "work_schedules",
  "team_memberships",
  "vacation_requests",
  "sickness_reports",
] as const;

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
  updateEntries: (update: (previous: TimeEntry[]) => TimeEntry[]) => void;
  updateJobs: (update: (previous: CalendarJob[]) => CalendarJob[]) => void;
  /** Takes ownership and returns this operation's idempotent, scope-bound release. */
  beginMutation: () => () => void;
  /** Reads the current window; awaited by the refresh control. */
  refreshAll: () => Promise<void>;
};

export function useCalendarRangeData(
  options: UseCalendarRangeDataOptions,
): CalendarRangeData {
  const { organizationId, needed, requiredDatasets, onReadFailed, readPlanningExtras } =
    options;
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

  // Generation allocation is synchronous and monotonic per dataset. The
  // reducer keeps the current value (and bumps it itself on a scope reset);
  // `stateRef` mirrors the latest state so allocation and response matching
  // never read React state inside async code.
  const stateRef = useRef(state);
  const generationsRef = useRef<Generations>({ entries: 0, jobs: 0, vacation: 0, sickness: 0, holidays: 0, board: 0 });
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

  const inFlightRef = useRef<{
    scopeKey: string;
    startedAt: number;
    generations: Generations;
    range: CalendarFetchRange;
    promise: Promise<boolean>;
  } | null>(null);
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
    dispatch({ type: "scope-reset", scopeKey, empty: EMPTY });
    setChangeRequestMap({});
    setMutationCount(0);
  }

  /**
   * Starts one generation-guarded read of the whole window: the window GET
   * and the board GET together. A read for the same range whose generations
   * are all still current is reused instead of duplicated, so the mutation
   * catch-up, a queued Realtime catch-up and the range effect firing together
   * cost one request pair. Resolves true when the window committed.
   */
  const readWindow = useCallback(
    (range: CalendarFetchRange, invalidatedAt?: number): Promise<boolean> => {
      if (!ownership.active || stateRef.current.scopeKey !== scopeKey) return Promise.resolve(false);
      if (ownership.count > 0) {
        return new Promise<boolean>((resolve) => ownership.waiting.push(resolve));
      }
      const running = inFlightRef.current;
      if (
        running && running.scopeKey === scopeKey &&
        (invalidatedAt === undefined || running.startedAt > invalidatedAt) &&
        rangesEqual(running.range, range) &&
        ALL_DATASETS.every((dataset) => running.generations[dataset] === currentGeneration(dataset))
      ) {
        return running.promise;
      }
      const generations = {
        entries: allocateGeneration("entries"),
        jobs: allocateGeneration("jobs"),
        vacation: allocateGeneration("vacation"),
        sickness: allocateGeneration("sickness"),
        holidays: allocateGeneration("holidays"),
        board: allocateGeneration("board"),
      };
      for (const dataset of ALL_DATASETS) {
        dispatch({ type: "read-started", scopeKey, dataset, generation: generations[dataset], range });
      }
      const startedAt = performance.now();
      const dates = { fromDate: toLocalDateString(range.start), toDate: toLocalDateString(range.end) };
      const promise = (async (): Promise<boolean> => {
        const [window, board] = await Promise.all([
          getCalendarWindow({
            organizationId,
            from: range.start.toISOString(),
            to: range.end.toISOString(),
            ...dates,
          }).catch(() => ({ success: false as const, error: "unexpected_error" })),
          getCalendarBoard({ organizationId, ...dates }).catch(() => ({ success: false as const, error: "unexpected_error" })),
        ]);
        if (inFlightRef.current?.generations === generations) inFlightRef.current = null;
        // A superseded generation is ignored by the reducer; only the newest
        // request may report a failure banner or commit data.
        const current = ALL_DATASETS.filter(
          (dataset) => currentGeneration(dataset) === generations[dataset],
        );
        if (!ownership.active || stateRef.current.scopeKey !== scopeKey || current.length === 0) return false;
        if (!window.success || !board.success) {
          for (const dataset of current) {
            dispatch({ type: "read-failed", scopeKey, dataset, generation: generations[dataset], range });
          }
          onReadFailedRef.current();
          return false;
        }
        const data: CalendarDatasets = {
          entries: window.entries,
          jobs: window.jobs,
          vacation: window.vacation,
          sickness: window.sickness,
          holidays: window.holidays,
          board: { rows: board.rows, days: board.days, dispatch: board.dispatch, materialDemandJobIds: board.materialDemandJobIds },
        };
        for (const dataset of current) {
          dispatch(
            readCommitted<CalendarDatasets, typeof dataset>({
              scopeKey, dataset,
              generation: generations[dataset],
              range,
              data: data[dataset],
            }),
          );
        }
        if (current.includes("entries")) {
          setChangeRequestMap(window.changeRequestMap);
        }
        return current.length === ALL_DATASETS.length;
      })();
      inFlightRef.current = { scopeKey, startedAt, generations, range, promise };
      return promise;
    },
    [organizationId, scopeKey, ownership, allocateGeneration, currentGeneration],
  );

  // Range effect: when a required dataset does not cover the needed window,
  // the whole window is read. In-flight and failed reads covering the window
  // do not restart, so this cannot loop.
  useEffect(() => {
    if (requiredDatasets.some((dataset) => datasetNeedsRead(state.datasets[dataset], needed))) {
      void readWindow(needed);
    }
  }, [needed, requiredDatasets, state, readWindow]);

  const isMutating = mutationCount > 0;

  const settleMutation = useCallback(() => {
    if (!ownership.active) return;
    ownership.settle();
    setMutationCount(ownership.count);
    if (ownership.count > 0) return;
    // The one guaranteed authoritative read after the user's own change: the
    // server action has already committed, so the shared debounce is the only
    // delay, and it coalesces a chain of undo/redo settlements.
    ownership.schedule(() => {
      if (ownership.count > 0) return;
      const waiting = ownership.waiting.splice(0);
      void readWindow(neededRef.current).then((committed) => {
        for (const resolve of waiting) resolve(committed);
      });
      // The extras reader reports its own failed reads and answers `false` for a
      // superseded or out-of-scope read, which is not a failure (A1-30 showed the
      // stale notice replacing the success banner when it was treated as one).
      // Only a rejected promise is an unreported failure.
      void readPlanningExtrasRef.current?.().catch(() => onReadFailedRef.current());
    });
  }, [readWindow, ownership]);

  const beginMutation = useCallback((): (() => void) => {
    if (!ownership.active) return () => {};
    ownership.begin();
    setMutationCount(ownership.count);
    inFlightRef.current = null;
    for (const dataset of ALL_DATASETS) {
      dispatch({ type: "reads-invalidated", scopeKey, dataset, generation: allocateGeneration(dataset) });
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      settleMutation();
    };
  }, [allocateGeneration, ownership, scopeKey, settleMutation]);

  useEffect(() => {
    ownership.activate();
    return () => ownership.dispose();
  }, [ownership]);

  // Realtime consumption: one adapter for every calendar table, reporting the
  // real read outcome. `suspend` queues events during the user's own mutation
  // instead of dropping them; exactly one catch-up follows when ownership
  // ends (PF-04).
  useLiveView<null>({
    tables: CALENDAR_TABLES,
    read: async ({ invalidatedAt }) => {
      const windowOk = await readWindow(neededRef.current, invalidatedAt);
      const extrasOk = ownership.active
        ? await (readPlanningExtrasRef.current?.() ?? Promise.resolve(true))
        : false;
      return windowOk && extrasOk ? { ok: true, data: null } : { ok: false };
    },
    initialData: null,
    suspend: isMutating,
  });

  const refreshAll = useCallback(async () => {
    await readWindow(neededRef.current);
    if (ownership.active) await readPlanningExtrasRef.current?.();
  }, [readWindow, ownership]);

  const updateEntries = useCallback(
    (update: (previous: TimeEntry[]) => TimeEntry[]) =>
      dispatch({ type: "data-updated", scopeKey, dataset: "entries", update }),
    [scopeKey],
  );
  const updateJobs = useCallback(
    (update: (previous: CalendarJob[]) => CalendarJob[]) =>
      dispatch({ type: "data-updated", scopeKey, dataset: "jobs", update }),
    [scopeKey],
  );

  const readiness = useMemo(
    () =>
      composeCalendarReadiness(
        requiredDatasets.map((dataset) => presentDataset(state.datasets[dataset], needed)),
      ),
    [requiredDatasets, state, needed],
  );

  return {
    entries: state.datasets.entries.data,
    jobs: state.datasets.jobs.data,
    vacation: state.datasets.vacation.data,
    sickness: state.datasets.sickness.data,
    holidays: state.datasets.holidays.data,
    board: state.datasets.board.data,
    changeRequestMap,
    readiness,
    isMutating,
    updateEntries,
    updateJobs,
    beginMutation,
    refreshAll,
  };
}
