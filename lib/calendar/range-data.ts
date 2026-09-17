import { rangeCovers, type CalendarFetchRange } from "./navigation";

/**
 * The calendar's one data owner (Step 2, PF-02/PF-03). Each dataset records
 * the range its array is authoritative for, the generation of the newest
 * request that may still commit, and its last read outcome. A response can
 * only commit when it carries the current generation, so an older range,
 * a superseded refresh, or a read discarded by a mutation can never overwrite
 * newer data. Readiness is derived per needed range, never stored: old data
 * cannot masquerade as coverage of dates it was not read for.
 */

type DatasetRead =
  | { kind: "idle" }
  | { kind: "in-flight"; generation: number; range: CalendarFetchRange }
  | { kind: "failed"; range: CalendarFetchRange };

export type DatasetState<TData> = {
  data: TData;
  /** Range `data` was read for; null until the first committed read. */
  coverage: CalendarFetchRange | null;
  /** Newest request generation that may still commit. */
  generation: number;
  read: DatasetRead;
};

export type DatasetMap = Record<string, unknown>;

export type CalendarRangeState<TData extends DatasetMap> = {
  scopeKey: string;
  datasets: { [K in keyof TData]: DatasetState<TData[K]> };
};

type PerDataset<TData extends DatasetMap, TAction> = {
  [K in keyof TData]: TAction & { dataset: K };
}[keyof TData];

type CalendarDatasetAction<TData extends DatasetMap> =
  | PerDataset<TData, { type: "read-started"; generation: number; range: CalendarFetchRange }>
  | {
      [K in keyof TData]: {
        type: "read-committed";
        dataset: K;
        generation: number;
        range: CalendarFetchRange;
        data: TData[K];
      };
    }[keyof TData]
  | PerDataset<TData, { type: "read-failed"; generation: number; range: CalendarFetchRange }>
  | PerDataset<TData, { type: "reads-invalidated"; generation: number }>
  | {
      [K in keyof TData]: {
        type: "data-updated";
        dataset: K;
        update: (previous: TData[K]) => TData[K];
      };
    }[keyof TData]
;

export type CalendarRangeAction<TData extends DatasetMap> =
  | (CalendarDatasetAction<TData> & { scopeKey: string })
  | { type: "scope-reset"; scopeKey: string; empty: TData };

export function createDatasetState<TData>(
  data: TData,
  coverage: CalendarFetchRange | null = null,
): DatasetState<TData> {
  return { data, coverage, generation: 0, read: { kind: "idle" } };
}

function reduceDataset<TData>(
  state: DatasetState<TData>,
  action: Exclude<CalendarRangeAction<Record<string, TData>>, { type: "scope-reset" }>,
): DatasetState<TData> {
  switch (action.type) {
    case "read-started":
      if (action.generation <= state.generation) return state;
      return {
        ...state,
        generation: action.generation,
        read: { kind: "in-flight", generation: action.generation, range: action.range },
      };
    case "read-committed":
      if (action.generation !== state.generation) return state;
      return {
        data: action.data,
        coverage: action.range,
        generation: state.generation,
        read: { kind: "idle" },
      };
    case "read-failed":
      if (action.generation !== state.generation) return state;
      return { ...state, read: { kind: "failed", range: action.range } };
    case "reads-invalidated":
      return {
        ...state,
        generation: Math.max(state.generation, action.generation),
        // A mutation supersedes the last outcome: an in-flight response can no
        // longer commit and a failure is no longer current, so the next read
        // (the settlement's catch-up) decides the presentation.
        read: { kind: "idle" },
      };
    case "data-updated":
      return { ...state, data: action.update(state.data) };
    default: {
      const exhaustive: never = action;
      return exhaustive;
    }
  }
}

export function reduceCalendarRange<TData extends DatasetMap>(
  state: CalendarRangeState<TData>,
  action: CalendarRangeAction<TData>,
): CalendarRangeState<TData> {
  if (action.type === "scope-reset") {
    const datasets = {} as { [K in keyof TData]: DatasetState<TData[K]> };
    for (const key of Object.keys(state.datasets) as (keyof TData)[]) {
      datasets[key] = {
        data: action.empty[key],
        coverage: null,
        // Every in-flight response predates the new scope: move past it.
        generation: state.datasets[key].generation + 1,
        read: { kind: "idle" },
      };
    }
    return { scopeKey: action.scopeKey, datasets };
  }
  if (action.scopeKey !== state.scopeKey) return state;
  const key = action.dataset;
  const current = state.datasets[key];
  const next = reduceDataset(
    current,
    action as Exclude<CalendarRangeAction<Record<string, TData[typeof key]>>, { type: "scope-reset" }>,
  );
  if (next === current) return state;
  return { ...state, datasets: { ...state.datasets, [key]: next } };
}

/**
 * What one dataset can truthfully show for `needed`:
 * - `ready`: coverage contains the range and nothing is pending.
 * - `refreshing`: covered data stays visible while a newer read runs.
 * - `stale`: covered data stays visible, but the latest refresh failed.
 * - `reloading`: the range is not covered, but the dataset holds data for
 *   another window; the grid stays mounted while the read runs.
 * - `loading`: the range is not covered and the dataset holds no data yet.
 * - `unavailable`: the range is not covered and its read failed.
 */
export type DatasetPresentation =
  | "ready"
  | "refreshing"
  | "stale"
  | "reloading"
  | "loading"
  | "unavailable";

export function presentDataset(
  state: DatasetState<unknown>,
  needed: CalendarFetchRange,
): DatasetPresentation {
  const covered = state.coverage !== null && rangeCovers(state.coverage, needed);
  if (covered) {
    if (state.read.kind === "in-flight") return "refreshing";
    if (state.read.kind === "failed") return "stale";
    return "ready";
  }
  if (state.read.kind === "failed" && rangeCovers(state.read.range, needed)) {
    return "unavailable";
  }
  return state.coverage === null ? "loading" : "reloading";
}

/** True when the effect must start a read to cover `needed`. */
export function datasetNeedsRead(
  state: DatasetState<unknown>,
  needed: CalendarFetchRange,
): boolean {
  if (state.coverage !== null && rangeCovers(state.coverage, needed)) return false;
  if (state.read.kind === "in-flight" && rangeCovers(state.read.range, needed)) return false;
  if (state.read.kind === "failed" && rangeCovers(state.read.range, needed)) return false;
  return true;
}

export type CalendarReadiness =
  | { kind: "ready"; isRefreshing: boolean; isStale: boolean }
  /**
   * The window is not covered. `hasData` is true when every required dataset
   * holds data for some other window: the grid stays mounted and marked busy
   * instead of being replaced by the skeleton (navigation must not unmount
   * the calendar, which is what the golden month steps and users rely on).
   */
  | { kind: "loading"; hasData: boolean }
  | { kind: "unavailable" };

/** Composes the datasets a view requires; one uncovered dataset blocks readiness. */
export function composeCalendarReadiness(
  presentations: readonly DatasetPresentation[],
): CalendarReadiness {
  if (presentations.includes("unavailable")) return { kind: "unavailable" };
  if (presentations.includes("loading")) return { kind: "loading", hasData: false };
  if (presentations.includes("reloading")) return { kind: "loading", hasData: true };
  return {
    kind: "ready",
    isRefreshing: presentations.includes("refreshing"),
    isStale: presentations.includes("stale"),
  };
}

/**
 * Builds the committed-read action for one dataset. The parameter types tie
 * `data` to `dataset`; the single cast below is the one place the
 * distributive action union is assembled from a generic key.
 */
export function readCommitted<TData extends DatasetMap, K extends keyof TData>(input: {
  scopeKey: string;
  dataset: K;
  generation: number;
  range: CalendarFetchRange;
  data: TData[K];
}): CalendarRangeAction<TData> {
  return { type: "read-committed", ...input } as CalendarRangeAction<TData>;
}
