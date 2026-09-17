import { describe, expect, test } from "bun:test";

import { getCalendarFetchRange, type CalendarFetchRange } from "./navigation";
import {
  composeCalendarReadiness,
  createDatasetState,
  datasetNeedsRead,
  presentDataset,
  reduceCalendarRange,
  type CalendarRangeAction,
  type CalendarRangeState,
} from "./range-data";

type Data = { entries: string[]; jobs: number[] };

const day = getCalendarFetchRange(new Date(2026, 8, 8, 12), "day");
const week = getCalendarFetchRange(new Date(2026, 8, 8, 12), "week");
const month = getCalendarFetchRange(new Date(2026, 8, 8, 12), "month");

function initial(): CalendarRangeState<Data> {
  return {
    scopeKey: "org-a",
    datasets: { entries: createDatasetState<string[]>([]), jobs: createDatasetState<number[]>([]) },
  };
}

function apply(
  state: CalendarRangeState<Data>,
  ...actions: CalendarRangeAction<Data>[]
): CalendarRangeState<Data> {
  return actions.reduce(reduceCalendarRange, state);
}

function readiness(state: CalendarRangeState<Data>, needed: CalendarFetchRange) {
  return composeCalendarReadiness([
    presentDataset(state.datasets.entries, needed),
    presentDataset(state.datasets.jobs, needed),
  ]);
}

describe("calendar range data (PF-02, PF-03)", () => {
  test("a superseded response cannot commit over a newer generation (A -> B -> A)", () => {
    let state = apply(
      initial(),
      { type: "read-started", scopeKey: "org-a", dataset: "entries", generation: 1, range: day },
      { type: "read-started", scopeKey: "org-a", dataset: "entries", generation: 2, range: week },
      { type: "read-started", scopeKey: "org-a", dataset: "entries", generation: 3, range: day },
    );
    // Responses arrive out of order: the week (2), then the first day (1), then the last day (3).
    state = apply(state, { type: "read-committed", scopeKey: "org-a", dataset: "entries", generation: 2, range: week, data: ["week"] });
    expect(state.datasets.entries.data).toEqual([]);
    state = apply(state, { type: "read-committed", scopeKey: "org-a", dataset: "entries", generation: 1, range: day, data: ["stale day"] });
    expect(state.datasets.entries.data).toEqual([]);
    expect(presentDataset(state.datasets.entries, day)).toBe("loading");
    state = apply(state, { type: "read-committed", scopeKey: "org-a", dataset: "entries", generation: 3, range: day, data: ["day"] });
    expect(state.datasets.entries.data).toEqual(["day"]);
    expect(presentDataset(state.datasets.entries, day)).toBe("ready");
  });

  test("wider -> narrower -> wider: a covered narrower range needs no read, a wider one does", () => {
    let state = apply(
      initial(),
      { type: "read-started", scopeKey: "org-a", dataset: "entries", generation: 1, range: week },
      { type: "read-committed", scopeKey: "org-a", dataset: "entries", generation: 1, range: week, data: ["w"] },
    );
    expect(datasetNeedsRead(state.datasets.entries, day)).toBe(false);
    expect(presentDataset(state.datasets.entries, day)).toBe("ready");
    expect(datasetNeedsRead(state.datasets.entries, month)).toBe(true);
    // Uncovered, but the dataset holds week data: the grid stays mounted.
    expect(presentDataset(state.datasets.entries, month)).toBe("reloading");
    state = apply(state, { type: "read-started", scopeKey: "org-a", dataset: "entries", generation: 2, range: month });
    expect(datasetNeedsRead(state.datasets.entries, month)).toBe(false);
    // The week data stays visible for the week while the month loads; the
    // month itself is honest about not being covered yet.
    expect(presentDataset(state.datasets.entries, week)).toBe("refreshing");
    expect(presentDataset(state.datasets.entries, month)).toBe("reloading");
  });

  test("one dataset failing while the other succeeds blocks readiness for the uncovered range only", () => {
    const state = apply(
      initial(),
      { type: "read-started", scopeKey: "org-a", dataset: "entries", generation: 1, range: month },
      { type: "read-started", scopeKey: "org-a", dataset: "jobs", generation: 1, range: month },
      { type: "read-committed", scopeKey: "org-a", dataset: "entries", generation: 1, range: month, data: ["m"] },
      { type: "read-failed", scopeKey: "org-a", dataset: "jobs", generation: 1, range: month },
    );
    expect(readiness(state, month)).toEqual({ kind: "unavailable" });
    expect(datasetNeedsRead(state.datasets.jobs, month)).toBe(false);
    // A month failure covers every day inside it: no read loop, still unavailable.
    expect(presentDataset(state.datasets.jobs, day)).toBe("unavailable");
    // A day outside the failed month starts fresh.
    const nextMonthDay = getCalendarFetchRange(new Date(2026, 10, 3, 12), "day");
    expect(datasetNeedsRead(state.datasets.jobs, nextMonthDay)).toBe(true);
    expect(presentDataset(state.datasets.jobs, nextMonthDay)).toBe("loading");
  });

  test("a failed refresh keeps covered data and marks it stale", () => {
    const state = apply(
      initial(),
      { type: "read-started", scopeKey: "org-a", dataset: "jobs", generation: 1, range: day },
      { type: "read-committed", scopeKey: "org-a", dataset: "jobs", generation: 1, range: day, data: [1] },
      { type: "read-started", scopeKey: "org-a", dataset: "jobs", generation: 2, range: day },
      { type: "read-failed", scopeKey: "org-a", dataset: "jobs", generation: 2, range: day },
    );
    expect(state.datasets.jobs.data).toEqual([1]);
    expect(presentDataset(state.datasets.jobs, day)).toBe("stale");
    expect(composeCalendarReadiness(["ready", "stale"])).toEqual({ kind: "ready", isRefreshing: false, isStale: true });
  });

  test("a successful empty result is ready, not loading", () => {
    const state = apply(
      initial(),
      { type: "read-started", scopeKey: "org-a", dataset: "entries", generation: 1, range: day },
      { type: "read-committed", scopeKey: "org-a", dataset: "entries", generation: 1, range: day, data: [] },
      { type: "read-started", scopeKey: "org-a", dataset: "jobs", generation: 1, range: day },
      { type: "read-committed", scopeKey: "org-a", dataset: "jobs", generation: 1, range: day, data: [] },
    );
    expect(readiness(state, day)).toEqual({ kind: "ready", isRefreshing: false, isStale: false });
  });

  test("a mutation discards the in-flight read and keeps optimistic edits over a late response", () => {
    let state = apply(
      initial(),
      { type: "read-started", scopeKey: "org-a", dataset: "jobs", generation: 1, range: day },
      { type: "read-committed", scopeKey: "org-a", dataset: "jobs", generation: 1, range: day, data: [1, 2] },
      { type: "read-started", scopeKey: "org-a", dataset: "jobs", generation: 2, range: day },
      { type: "reads-invalidated", scopeKey: "org-a", dataset: "jobs", generation: 3 },
      { type: "data-updated", scopeKey: "org-a", dataset: "jobs", update: (jobs) => [...jobs, 3] },
    );
    expect(state.datasets.jobs.read).toEqual({ kind: "idle" });
    expect(presentDataset(state.datasets.jobs, day)).toBe("ready");
    state = apply(state, { type: "read-committed", scopeKey: "org-a", dataset: "jobs", generation: 2, range: day, data: [1, 2] });
    expect(state.datasets.jobs.data).toEqual([1, 2, 3]);
    // The authoritative catch-up read after the mutation carries the new generation.
    state = apply(
      state,
      { type: "read-started", scopeKey: "org-a", dataset: "jobs", generation: 4, range: day },
      { type: "read-committed", scopeKey: "org-a", dataset: "jobs", generation: 4, range: day, data: [1, 2, 3] },
    );
    expect(state.datasets.jobs.data).toEqual([1, 2, 3]);
  });

  test("a mutation clears a failed outcome so the catch-up read is required again", () => {
    const state = apply(
      initial(),
      { type: "read-started", scopeKey: "org-a", dataset: "jobs", generation: 1, range: day },
      { type: "read-failed", scopeKey: "org-a", dataset: "jobs", generation: 1, range: day },
      { type: "reads-invalidated", scopeKey: "org-a", dataset: "jobs", generation: 2 },
    );
    expect(state.datasets.jobs.read).toEqual({ kind: "idle" });
    expect(datasetNeedsRead(state.datasets.jobs, day)).toBe(true);
    expect(presentDataset(state.datasets.jobs, day)).toBe("loading");
  });

  test("a scope reset clears data and coverage immediately and invalidates every in-flight read", () => {
    let state = apply(
      initial(),
      { type: "read-started", scopeKey: "org-a", dataset: "entries", generation: 1, range: week },
      { type: "read-committed", scopeKey: "org-a", dataset: "entries", generation: 1, range: week, data: ["org-a"] },
      { type: "read-started", scopeKey: "org-a", dataset: "jobs", generation: 1, range: week },
    );
    state = apply(state, {
      type: "scope-reset",
      scopeKey: "org-b",
      empty: { entries: [], jobs: [] },
    });
    expect(state.scopeKey).toBe("org-b");
    expect(state.datasets.entries.data).toEqual([]);
    expect(readiness(state, day)).toEqual({ kind: "loading", hasData: false });
    state = apply(state, { type: "read-committed", scopeKey: "org-a", dataset: "jobs", generation: 1, range: week, data: [99] });
    expect(state.datasets.jobs.data).toEqual([]);
  });

  test("a response from another scope is rejected even with a matching generation", () => {
    const state = apply(initial(), { type: "read-started", scopeKey: "org-a", dataset: "jobs", generation: 1, range: day });
    const next = reduceCalendarRange(state, { type: "read-committed", scopeKey: "org-b", dataset: "jobs", generation: 1, range: day, data: [99] });
    expect(next).toBe(state);
  });

  test("readiness composition: unavailable beats loading beats ready", () => {
    expect(composeCalendarReadiness(["ready", "loading", "unavailable"])).toEqual({ kind: "unavailable" });
    expect(composeCalendarReadiness(["refreshing", "loading"])).toEqual({ kind: "loading", hasData: false });
    // One dataset without any data (first month open needs the absence
    // datasets) still shows the skeleton; navigation with data on every
    // required dataset keeps the grid mounted.
    expect(composeCalendarReadiness(["reloading", "loading"])).toEqual({ kind: "loading", hasData: false });
    expect(composeCalendarReadiness(["reloading", "ready"])).toEqual({ kind: "loading", hasData: true });
    expect(composeCalendarReadiness(["refreshing", "ready"])).toEqual({ kind: "ready", isRefreshing: true, isStale: false });
  });

  test("an out-of-order start cannot roll the generation back", () => {
    const state = apply(
      initial(),
      { type: "read-started", scopeKey: "org-a", dataset: "entries", generation: 5, range: day },
      { type: "read-started", scopeKey: "org-a", dataset: "entries", generation: 4, range: week },
    );
    expect(state.datasets.entries.generation).toBe(5);
    expect(state.datasets.entries.read).toEqual({ kind: "in-flight", generation: 5, range: day });
  });
});
