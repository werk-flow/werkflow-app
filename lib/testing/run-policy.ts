export const PLAYWRIGHT_LANES = [
  "group",
  "iteration",
  "certification",
  "diagnostic",
  "direct",
] as const;
export type PlaywrightLane = (typeof PLAYWRIGHT_LANES)[number];

export const PLAYWRIGHT_SUITES = ["golden", "audit", "canary"] as const;
export type PlaywrightSuite = (typeof PLAYWRIGHT_SUITES)[number];

// Where a run's authoritative backend lives (decision D8, docs/plans/
// platform-hardening.md): golden and audit batteries run against the local
// Supabase stack by default; the canary suite exists to prove cloud behavior
// and only ever runs against cloud DEV. `--target cloud` on golden/audit is
// the deliberate exception for wave-end and partner-milestone certifications
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

export type CertificationAttempt = {
  runKey: string;
  status: "passed" | "failed";
  startedAt: string;
  classification: IncidentClass | null;
  classifiedAt: string | null;
  failedSpecFile: string | null;
  focusedGrepToken?: string | null;
  failedTestId?: string | null;
};

export type FocusedVerification = {
  status: "passed" | "failed";
  startedAt: string;
  candidateFingerprint: string;
  suite: PlaywrightSuite;
  grep: string;
  total: number;
  target: PlaywrightTarget;
  passedTestIds: readonly string[];
};

export type FocusedIterationAttempt = {
  runKey: string;
  status: "failed";
  classification: IncidentClass | null;
  classifiedAt: string | null;
};

export type FocusedProofRequirement = {
  suite: PlaywrightSuite;
  token: string;
  reason: string;
};

const FOCUSED_PROOF_IMPACT_RULES = [
  {
    path: "components/auftraege/field-work-pack-page.tsx",
    requirement: {
      suite: "golden",
      token: "p1-16",
      reason: "The assigned field-work pack changed.",
    },
  },
] as const satisfies ReadonlyArray<{
  path: string;
  requirement: FocusedProofRequirement;
}>;

// "tests/golden/p1-16.spec.ts" -> "p1-16"; null when the failure has no spec
// file (runner or setup failures), in which case any focused proof qualifies.
export function focusedProofToken(
  failedSpecFile: string | null,
): string | null {
  if (!failedSpecFile) return null;
  const match = /([^\\/]+)\.spec\.ts$/.exec(failedSpecFile);
  return match ? match[1].toLowerCase() : null;
}

export function focusedProofTokenForFailure(input: {
  suite: PlaywrightSuite;
  failedTitle: string | null;
  failedSpecFile: string | null;
}): string | null {
  if (input.suite === "canary" && input.failedTitle) {
    return /\bC\d+:/i.exec(input.failedTitle)?.[0] ?? null;
  }
  return focusedProofToken(input.failedSpecFile);
}

// Token-boundary match: "@P1-16-stage-boundaries" covers token "p1-16", but a
// bare substring must not let "p1-1" cover "@P1-16".
export function testIdentityCoversToken(testId: string, token: string): boolean {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?![a-z0-9])`, "i").test(testId);
}

export function validateRunRequest(request: RunRequest): string[] {
  const errors: string[] = [];
  if (request.suite === "canary" && request.target !== "cloud") {
    errors.push(
      "The canary suite proves cloud behavior; it only runs with target cloud.",
    );
  }
  if (request.lane === "iteration" && !request.grep?.trim()) {
    errors.push(
      "Iteration runs require --grep. Use certification for a complete battery.",
    );
  }
  if (request.lane === "certification" && request.grep?.trim()) {
    errors.push("Certification runs cannot use --grep.");
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

export function evaluateFocusedIterationRerun(input: {
  attemptsSinceLastPass: FocusedIterationAttempt[];
  overrideReason: string | null;
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
  if (repeatedClass && !input.overrideReason?.trim()) {
    return {
      allowed: false,
      reason: `The last two focused runs failed in the ${latestFailure.classification} class. Use a retained-world diagnostic, or issue one investigated extension with test:runs campaign-extend and pass its --rerun-grant.`,
    };
  }
  return { allowed: true, reason: null };
}

export function requiredFocusedProofsForChangedFiles(
  changedFiles: readonly string[],
): FocusedProofRequirement[] {
  const normalizedFiles = new Set(
    changedFiles.map((file) => file.replaceAll("\\", "/")),
  );
  const requirements = new Map<string, FocusedProofRequirement>();
  for (const rule of FOCUSED_PROOF_IMPACT_RULES) {
    if (!normalizedFiles.has(rule.path)) continue;
    const requirement = { ...rule.requirement };
    requirements.set(`${requirement.suite}:${requirement.token}`, requirement);
  }
  return [...requirements.values()];
}

export function evaluateRequiredFocusedProofs(input: {
  requirements: readonly FocusedProofRequirement[];
  focusedVerifications: readonly FocusedVerification[];
  currentCandidateFingerprint: string;
  currentTarget: PlaywrightTarget;
}): FocusedProofRequirement[] {
  return input.requirements.filter(
    (requirement) =>
      !input.focusedVerifications.some(
        (verification) =>
          verification.status === "passed" &&
          verification.candidateFingerprint === input.currentCandidateFingerprint &&
          verification.suite === requirement.suite &&
          verification.target === input.currentTarget &&
          verification.total > 0 &&
          verification.passedTestIds.some((id) => testIdentityCoversToken(id, requirement.token)),
      ),
  );
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

export function evaluateFullCertificationRerun(input: {
  attemptsSinceLastPass: CertificationAttempt[];
  focusedVerifications: FocusedVerification[];
  currentCandidateFingerprint: string;
  currentSuite: PlaywrightSuite;
  fullSuiteTestCount: number;
  overrideReason: string | null;
  currentTarget: PlaywrightTarget;
}): { allowed: boolean; reason: string | null } {
  const failedAttempts = input.attemptsSinceLastPass.filter(
    (attempt) => attempt.status === "failed",
  );
  const latestFailure = failedAttempts.at(-1);
  if (!latestFailure) return { allowed: true, reason: null };

  if (!latestFailure.classification || !latestFailure.classifiedAt) {
    return {
      allowed: false,
      reason: `Classify failed full run ${latestFailure.runKey} before another full certification.`,
    };
  }

  const classifiedAt = Date.parse(latestFailure.classifiedAt);
  const requiredToken =
    latestFailure.focusedGrepToken ??
    focusedProofToken(latestFailure.failedSpecFile);
  const focusedProofExists =
    Number.isFinite(classifiedAt) &&
    input.focusedVerifications.some(
      (verification) =>
        verification.status === "passed" &&
        verification.suite === input.currentSuite &&
        verification.candidateFingerprint === input.currentCandidateFingerprint &&
        verification.target === input.currentTarget &&
        verification.total > 0 &&
        verification.total < input.fullSuiteTestCount &&
        Date.parse(verification.startedAt) > classifiedAt &&
        verification.passedTestIds.length > 0 &&
        (latestFailure.failedTestId
          ? verification.passedTestIds.includes(latestFailure.failedTestId)
          : requiredToken === null || verification.passedTestIds.some((id) => testIdentityCoversToken(id, requiredToken))),
    );
  if (!focusedProofExists) {
    const scope = requiredToken
      ? ` covering ${requiredToken} (the failed stage must actually execute)`
      : "";
    return {
      allowed: false,
      reason: `Run a focused verification${scope} on the current source after classifying ${latestFailure.runKey}.`,
    };
  }

  const repeatedClass =
    failedAttempts.length >= 2 &&
    failedAttempts.at(-2)?.classification === latestFailure.classification;
  if (repeatedClass && !input.overrideReason?.trim()) {
    return {
      allowed: false,
      reason: `The last two full runs failed in the ${latestFailure.classification} class. Investigate before overriding the rerun budget.`,
    };
  }

  return { allowed: true, reason: null };
}
