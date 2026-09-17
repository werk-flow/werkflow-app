// "certification" is retired (pre-Wave-3 step 2, 2026-09-14, decision D4 of
// the testing-system review): acceptance is the group lane through test:verify.
// The value stays in the list so historical manifests still parse; the runner
// no longer accepts it.
export const PLAYWRIGHT_LANES = [
  "group",
  "iteration",
  "certification",
  "diagnostic",
  "direct",
] as const;
export type PlaywrightLane = (typeof PLAYWRIGHT_LANES)[number];
export const RUNNABLE_LANES = ["group", "iteration", "diagnostic"] as const satisfies readonly PlaywrightLane[];

export const PLAYWRIGHT_SUITES = ["golden", "audit", "canary"] as const;
export type PlaywrightSuite = (typeof PLAYWRIGHT_SUITES)[number];

// Where a run's authoritative backend lives (decision D8, docs/plans/
// platform-hardening.md): golden and audit batteries run against the local
// Supabase stack by default; the canary suite exists to prove cloud behavior
// and only ever runs against cloud DEV. `--target cloud` on golden/audit is
// the deliberate exception for wave-end and partner-milestone verification
// (decision D11).
export const PLAYWRIGHT_TARGETS = ["local", "cloud"] as const;
export type PlaywrightTarget = (typeof PLAYWRIGHT_TARGETS)[number];

export function defaultTargetForSuite(
  suite: PlaywrightSuite,
): PlaywrightTarget {
  return suite === "canary" ? "cloud" : "local";
}

export const INCIDENT_CLASSES = [
  "product",
  "harness",
  "environment",
  "transient",
] as const;
export type IncidentClass = (typeof INCIDENT_CLASSES)[number];

export type RunRequest = {
  lane: PlaywrightLane;
  suite: PlaywrightSuite;
  target: PlaywrightTarget;
  grep: string | null;
  reuseRunKey: string | null;
};

export type FocusedIterationAttempt = {
  runKey: string;
  status: "failed";
  classification: IncidentClass | null;
  classifiedAt: string | null;
};

export function validateRunRequest(request: RunRequest): string[] {
  const errors: string[] = [];
  if (request.suite === "canary" && request.target !== "cloud") {
    errors.push(
      "The canary suite proves cloud behavior; it only runs with target cloud.",
    );
  }
  if (request.lane === "iteration" && !request.grep?.trim()) {
    errors.push(
      "Iteration runs require --grep. Complete evidence comes from bun run test:verify.",
    );
  }
  if (request.lane === "diagnostic") {
    if (!request.grep?.trim()) errors.push("Diagnostic runs require --grep.");
    if (!request.reuseRunKey)
      errors.push("Diagnostic runs require --reuse-run <run-key>.");
  } else if (request.reuseRunKey) {
    errors.push("--reuse-run is available only in diagnostic mode.");
  }
  return errors;
}

export function validateFocusedSelection(input: {
  lane: PlaywrightLane;
  suite: PlaywrightSuite;
  selectedTestCount: number;
  fullSuiteTestCount: number;
}): string[] {
  if (!["iteration", "diagnostic"].includes(input.lane)) return [];
  if (input.selectedTestCount <= 0) {
    return [
      `${input.lane === "iteration" ? "Iteration" : "Diagnostic"} selected no tests.`,
    ];
  }
  if (input.selectedTestCount >= input.fullSuiteTestCount) {
    const laneName = input.lane === "iteration" ? "Iteration" : "Diagnostic";
    return [
      `${laneName} must select fewer than all ${input.fullSuiteTestCount} ${input.suite} tests.`,
    ];
  }
  return [];
}

// Two same-class focused failures in a row end the fresh-world loop: the next
// step is a retained-world diagnostic, never a third attempt. The rerun grant
// that used to override this left with the certification lane.
export function evaluateFocusedIterationRerun(input: {
  attemptsSinceLastPass: FocusedIterationAttempt[];
}): { allowed: boolean; reason: string | null } {
  const latestFailure = input.attemptsSinceLastPass.at(-1);
  if (!latestFailure) return { allowed: true, reason: null };
  if (!latestFailure.classification || !latestFailure.classifiedAt) {
    return {
      allowed: false,
      reason: `Classify failed focused run ${latestFailure.runKey} before another fresh-world iteration.`,
    };
  }

  const previousFailure = input.attemptsSinceLastPass.at(-2);
  const repeatedClass =
    previousFailure?.classification !== null &&
    previousFailure?.classification === latestFailure.classification;
  if (repeatedClass) {
    return {
      allowed: false,
      reason: `The last two focused runs failed in the ${latestFailure.classification} class. Replay the retained world with the diagnostic lane and repair the cause before another fresh-world run.`,
    };
  }
  return { allowed: true, reason: null };
}

export function shouldRefreshStoredSession(
  savedAtMilliseconds: number,
  nowMilliseconds: number,
  expectedOrganizationMatches: boolean,
  maxAgeMilliseconds = 15 * 60 * 1000,
): boolean {
  return (
    !expectedOrganizationMatches ||
    !Number.isFinite(savedAtMilliseconds) ||
    savedAtMilliseconds > nowMilliseconds ||
    nowMilliseconds - savedAtMilliseconds >= maxAgeMilliseconds
  );
}
