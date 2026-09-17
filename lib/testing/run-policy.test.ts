import { describe, expect, test } from "bun:test";

import {
  defaultTargetForSuite,
  evaluateFocusedIterationRerun,
  shouldRefreshStoredSession,
  validateFocusedSelection,
  validateRunRequest,
} from "./run-policy";

describe("Playwright run policy", () => {
  test("keeps iteration and diagnostic runs focused", () => {
    expect(
      validateRunRequest({
        lane: "iteration",
        suite: "golden",
        target: "local",
        grep: null,
        reuseRunKey: null,
      }),
    ).toHaveLength(1);
    expect(
      validateRunRequest({
        lane: "iteration",
        suite: "golden",
        target: "local",
        grep: "  ",
        reuseRunKey: null,
      }),
    ).toHaveLength(1);
    expect(
      validateRunRequest({
        lane: "diagnostic",
        suite: "golden",
        target: "local",
        grep: "@P1-16-stage-boundaries",
        reuseRunKey: "run-1",
      }),
    ).toEqual([]);
    expect(
      validateRunRequest({
        lane: "diagnostic",
        suite: "golden",
        target: "local",
        grep: null,
        reuseRunKey: null,
      }),
    ).toHaveLength(2);
    expect(
      validateRunRequest({
        lane: "group",
        suite: "golden",
        target: "local",
        grep: null,
        reuseRunKey: "run-1",
      }),
    ).toHaveLength(1);
  });

  test("pins the canary suite to the cloud target", () => {
    expect(
      validateRunRequest({
        lane: "group",
        suite: "canary",
        target: "local",
        grep: null,
        reuseRunKey: null,
      }),
    ).toHaveLength(1);
    expect(
      validateRunRequest({
        lane: "group",
        suite: "canary",
        target: "cloud",
        grep: null,
        reuseRunKey: null,
      }),
    ).toEqual([]);
    expect(defaultTargetForSuite("canary")).toBe("cloud");
    expect(defaultTargetForSuite("golden")).toBe("local");
    expect(defaultTargetForSuite("audit")).toBe("local");
  });

  test("rejects a suite-wide grep in focused lanes", () => {
    expect(
      validateFocusedSelection({
        lane: "iteration",
        suite: "canary",
        selectedTestCount: 9,
        fullSuiteTestCount: 9,
      }),
    ).toContain("Iteration must select fewer than all 9 canary tests.");
    expect(
      validateFocusedSelection({
        lane: "iteration",
        suite: "canary",
        selectedTestCount: 1,
        fullSuiteTestCount: 9,
      }),
    ).toEqual([]);
  });

  test("classifies focused failures and stops two same-class fresh-world attempts", () => {
    const firstFailure = {
      runKey: "focused-1",
      status: "failed" as const,
      classification: null,
      classifiedAt: null,
    };
    expect(
      evaluateFocusedIterationRerun({ attemptsSinceLastPass: [firstFailure] }).reason,
    ).toContain("Classify failed focused run focused-1");

    const classifiedFirst = {
      ...firstFailure,
      classification: "harness" as const,
      classifiedAt: "2026-08-29T17:20:00Z",
    };
    expect(
      evaluateFocusedIterationRerun({ attemptsSinceLastPass: [classifiedFirst] }).allowed,
    ).toBe(true);

    const repeated = evaluateFocusedIterationRerun({
      attemptsSinceLastPass: [
        classifiedFirst,
        {
          ...classifiedFirst,
          runKey: "focused-2",
          classifiedAt: "2026-08-29T17:25:00Z",
        },
      ],
    });
    expect(repeated.allowed).toBe(false);
    expect(repeated.reason).toContain(
      "last two focused runs failed in the harness class",
    );
  });

  test("refreshes old, future-dated, and wrong-organization sessions", () => {
    const now = Date.parse("2026-08-25T12:00:00Z");
    expect(shouldRefreshStoredSession(now - 14 * 60_000, now, true)).toBe(
      false,
    );
    expect(shouldRefreshStoredSession(now - 15 * 60_000, now, true)).toBe(true);
    expect(shouldRefreshStoredSession(now + 1, now, true)).toBe(true);
    expect(shouldRefreshStoredSession(Number.NaN, now, true)).toBe(true);
    expect(shouldRefreshStoredSession(now, now, false)).toBe(true);
  });
});
