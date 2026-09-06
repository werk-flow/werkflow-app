import { describe, expect, test } from "bun:test";

import {
  defaultTargetForSuite,
  evaluateFocusedIterationRerun,
  evaluateFullCertificationRerun,
  evaluateRequiredFocusedProofs,
  testIdentityCoversToken,
  focusedProofToken,
  focusedProofTokenForFailure,
  requiredFocusedProofsForChangedFiles,
  shouldRefreshStoredSession,
  validateFocusedSelection,
  validateRunRequest,
} from "./run-policy";

describe("Playwright run policy", () => {
  test("does not accept grep text as evidence that a required boundary executed", () => {
    const requirements = [{ suite: "golden" as const, token: "p1-16", reason: "Changed field pack" }];
    expect(evaluateRequiredFocusedProofs({
      requirements,
      currentCandidateFingerprint: "source-a",
      currentTarget: "local",
      focusedVerifications: [{
        status: "passed", startedAt: "2026-09-05T12:00:00Z", candidateFingerprint: "source-a",
        suite: "golden", target: "local", grep: "@GG-00|@P1-16", total: 1,
        passedTestIds: ["gg-00.spec.ts › unrelated @GG-00"],
      }],
    })).toEqual(requirements);
  });

  test("does not accept a different backend's focused proof", () => {
    const requirements = [{ suite: "golden" as const, token: "p1-16", reason: "Changed field pack" }];
    expect(evaluateRequiredFocusedProofs({
      requirements,
      currentCandidateFingerprint: "source-a",
      currentTarget: "local",
      focusedVerifications: [{
        status: "passed", startedAt: "2026-09-05T12:00:00Z", candidateFingerprint: "source-a",
        suite: "golden", target: "cloud", grep: "@P1-16", total: 1,
        passedTestIds: ["p1-16.spec.ts › field pack @P1-16"],
      }],
    })).toEqual(requirements);
  });

  test("requires the actual failed stage, even when another stage has the same spec tag", () => {
    const failedTestId = "tests/golden/p1-20.spec.ts › stage field @P1-20";
    const input = {
      attemptsSinceLastPass: [{ runKey: "failed-stage", status: "failed" as const, startedAt: "2026-09-05T10:00:00Z", classification: "harness" as const, classifiedAt: "2026-09-05T10:30:00Z", failedSpecFile: "tests/golden/p1-20.spec.ts", failedTestId }],
      currentCandidateFingerprint: "candidate", currentSuite: "golden" as const, currentTarget: "local" as const, fullSuiteTestCount: 142, overrideReason: null,
    };
    const proof = { status: "passed" as const, startedAt: "2026-09-05T11:00:00Z", candidateFingerprint: "candidate", suite: "golden" as const, target: "local" as const, grep: "@P1-20", total: 1, passedTestIds: ["tests/golden/p1-20.spec.ts › stage setup @P1-20"] };
    expect(evaluateFullCertificationRerun({ ...input, focusedVerifications: [proof] }).allowed).toBe(false);
    expect(evaluateFullCertificationRerun({ ...input, focusedVerifications: [{ ...proof, passedTestIds: [failedTestId] }] }).allowed).toBe(true);
    expect(evaluateFullCertificationRerun({ ...input, focusedVerifications: [{ ...proof, target: "cloud", passedTestIds: [failedTestId] }] }).allowed).toBe(false);
    expect(evaluateFullCertificationRerun({ ...input, focusedVerifications: [{ ...proof, suite: "audit", passedTestIds: [failedTestId] }] }).allowed).toBe(false);
  });
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
        lane: "certification",
        suite: "golden",
        target: "local",
        grep: "@P1-16",
        reuseRunKey: null,
      }),
    ).toHaveLength(1);
    expect(
      validateRunRequest({
        lane: "certification",
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
        lane: "certification",
        suite: "canary",
        target: "local",
        grep: null,
        reuseRunKey: null,
      }),
    ).toHaveLength(1);
    expect(
      validateRunRequest({
        lane: "certification",
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
      evaluateFocusedIterationRerun({
        attemptsSinceLastPass: [firstFailure],
        overrideReason: null,
      }).reason,
    ).toContain("Classify failed focused run focused-1");

    const classifiedFirst = {
      ...firstFailure,
      classification: "harness" as const,
      classifiedAt: "2026-08-29T17:20:00Z",
    };
    expect(
      evaluateFocusedIterationRerun({
        attemptsSinceLastPass: [classifiedFirst],
        overrideReason: null,
      }).allowed,
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
      overrideReason: null,
    });
    expect(repeated.allowed).toBe(false);
    expect(repeated.reason).toContain(
      "last two focused runs failed in the harness class",
    );
    expect(
      evaluateFocusedIterationRerun({
        attemptsSinceLastPass: [
          classifiedFirst,
          {
            ...classifiedFirst,
            runKey: "focused-2",
            classifiedAt: "2026-08-29T17:25:00Z",
          },
        ],
        overrideReason:
          "Retained traces isolate two independent remount defects.",
      }).allowed,
    ).toBe(true);
  });

  test("requires an affected-slice proof before first certification", () => {
    const requirements = requiredFocusedProofsForChangedFiles([
      "components/auftraege/field-work-pack-page.tsx",
      "docs/technical/testing.md",
    ]);
    expect(requirements).toEqual([
      {
        suite: "golden",
        token: "p1-16",
        reason: "The assigned field-work pack changed.",
      },
    ]);
    expect(
      evaluateRequiredFocusedProofs({
        requirements,
        focusedVerifications: [],
        currentCandidateFingerprint: "source-a",
      currentTarget: "local" as const,
      }),
    ).toEqual(requirements);
    expect(
      evaluateRequiredFocusedProofs({
        requirements,
        focusedVerifications: [
          {
            status: "passed",
            startedAt: "2026-08-29T19:00:00Z",
            candidateFingerprint: "source-a",
            suite: "golden",
            grep: "@P1-16-stage-setup|@P1-16-stage-execution",
            target: "local" as const,
            passedTestIds: ["@P1-16-stage-setup|@P1-16-stage-execution"],
            total: 2,
          },
        ],
        currentCandidateFingerprint: "source-a",
      currentTarget: "local" as const,
      }),
    ).toEqual([]);
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

  test("blocks an unclassified full-run retry", () => {
    const result = evaluateFullCertificationRerun({
      currentSuite: "golden",
      attemptsSinceLastPass: [
        {
          runKey: "failed-1",
          status: "failed",
          startedAt: "2026-08-25T10:00:00Z",
          classification: null,
          classifiedAt: null,
          failedSpecFile: null,
        },
      ],
      focusedVerifications: [],
      currentCandidateFingerprint: "source-a",
      currentTarget: "local" as const,
      fullSuiteTestCount: 114,
      overrideReason: null,
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Classify failed full run failed-1");
  });

  test("requires focused proof after classification", () => {
    const result = evaluateFullCertificationRerun({
      currentSuite: "golden",
      attemptsSinceLastPass: [
        {
          runKey: "failed-1",
          status: "failed",
          startedAt: "2026-08-25T10:00:00Z",
          classification: "harness",
          classifiedAt: "2026-08-25T10:30:00Z",
          failedSpecFile: null,
        },
      ],
      focusedVerifications: [
        {
          status: "passed",
          startedAt: "2026-08-25T11:00:00Z",
          candidateFingerprint: "old-source",
          suite: "golden",
          grep: "@P1-16",
          target: "local" as const,
          passedTestIds: ["@P1-16"],
          total: 1,
        },
      ],
      currentCandidateFingerprint: "source-a",
      currentTarget: "local" as const,
      overrideReason: null,
      fullSuiteTestCount: 114,
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("focused verification");
  });

  test("derives the proof token from the failed spec file", () => {
    expect(focusedProofToken("tests/golden/p1-16.spec.ts")).toBe("p1-16");
    expect(focusedProofToken("tests\\golden\\gg-00.spec.ts")).toBe("gg-00");
    expect(focusedProofToken("scripts/run-playwright.ts")).toBe(null);
    expect(focusedProofToken(null)).toBe(null);
    expect(
      focusedProofTokenForFailure({
        suite: "canary",
        failedTitle: "@CANARY C9: DEV-Migrationshistorie",
        failedSpecFile: "tests/canary/canary.spec.ts",
      }),
    ).toBe("C9:");
  });

  test("matches proof tokens at boundaries, not as bare substrings", () => {
    expect(testIdentityCoversToken("@P1-16", "p1-16")).toBe(true);
    expect(testIdentityCoversToken("@P1-16-stage-boundaries", "p1-16")).toBe(
      true,
    );
    expect(testIdentityCoversToken("@P1-16", "p1-1")).toBe(false);
    expect(testIdentityCoversToken("@P1-01", "p1-16")).toBe(false);
    expect(testIdentityCoversToken("@XP1-16", "p1-16")).toBe(false);
    expect(testIdentityCoversToken("tests/golden/notp1-16.spec.ts", "p1-16")).toBe(false);
    expect(testIdentityCoversToken("XC9: unrelated stage", "C9:")).toBe(false);
    expect(testIdentityCoversToken("tests/golden/p1-16.spec.ts › real stage", "p1-16")).toBe(true);
    expect(testIdentityCoversToken("@CANARY C9: migration stage", "C9:")).toBe(true);
  });

  test("requires the focused proof to cover the failed spec", () => {
    const base = {
      currentSuite: "golden" as const,
      attemptsSinceLastPass: [
        {
          runKey: "failed-1",
          status: "failed" as const,
          startedAt: "2026-08-25T10:00:00Z",
          classification: "harness" as const,
          classifiedAt: "2026-08-25T10:30:00Z",
          failedSpecFile: "tests/golden/p1-16.spec.ts",
        },
      ],
      currentCandidateFingerprint: "source-a",
      currentTarget: "local" as const,
      fullSuiteTestCount: 114,
      overrideReason: null,
    };
    const unrelatedProof = evaluateFullCertificationRerun({
      ...base,
      focusedVerifications: [
        {
          status: "passed",
          startedAt: "2026-08-25T11:00:00Z",
          candidateFingerprint: "source-a",
          suite: "golden",
          grep: "@GG-00",
          target: "local" as const,
          passedTestIds: ["@GG-00"],
          total: 13,
        },
      ],
    });
    expect(unrelatedProof.allowed).toBe(false);
    expect(unrelatedProof.reason).toContain("covering p1-16");

    const scopedProof = evaluateFullCertificationRerun({
      ...base,
      focusedVerifications: [
        {
          status: "passed",
          startedAt: "2026-08-25T11:00:00Z",
          candidateFingerprint: "source-a",
          suite: "golden",
          grep: "@P1-16-stage-boundaries",
          target: "local" as const,
          passedTestIds: ["@P1-16-stage-boundaries"],
          total: 1,
        },
      ],
    });
    expect(scopedProof.allowed).toBe(true);
  });

  test("allows one classified retry after focused proof and stops a repeated class", () => {
    const attempts = [
      {
        runKey: "failed-1",
        status: "failed" as const,
        startedAt: "2026-08-25T10:00:00Z",
        classification: "harness" as const,
        classifiedAt: "2026-08-25T10:30:00Z",
        failedSpecFile: null,
      },
    ];
    const focusedVerifications = [
      {
        status: "passed" as const,
        startedAt: "2026-08-25T11:00:00Z",
        candidateFingerprint: "source-a",
        suite: "golden" as const,
        grep: "@P1-16",
        target: "local" as const,
        passedTestIds: ["@P1-16"],
        total: 4,
      },
    ];
    expect(
      evaluateFullCertificationRerun({
        attemptsSinceLastPass: attempts,
        currentSuite: "golden",
        focusedVerifications,
        currentCandidateFingerprint: "source-a",
      currentTarget: "local" as const,
        overrideReason: null,
        fullSuiteTestCount: 114,
      }).allowed,
    ).toBe(true);

    const repeatedScenario = repeatedInput(attempts, focusedVerifications);
    const repeated = evaluateFullCertificationRerun({
      ...repeatedScenario,
      overrideReason: null,
    });
    expect(repeated.allowed).toBe(false);
    expect(repeated.reason).toContain("last two full runs");
    expect(
      evaluateFullCertificationRerun({
        ...repeatedScenario,
        overrideReason: "  ",
      }).allowed,
    ).toBe(false);
    expect(
      evaluateFullCertificationRerun({
        ...repeatedScenario,
        overrideReason:
          "Two unrelated server incidents were verified from archived logs.",
      }).allowed,
    ).toBe(true);
  });

  test("does not accept a suite-wide iteration as focused retry proof", () => {
    const attemptsSinceLastPass = [
      {
        runKey: "failed-canary",
        status: "failed" as const,
        startedAt: "2026-08-29T19:30:00Z",
        classification: "environment" as const,
        classifiedAt: "2026-08-29T19:34:00Z",
        failedSpecFile: "tests/canary/canary.spec.ts",
        focusedGrepToken: "C9:",
      },
    ];
    const suiteWideProof = evaluateFullCertificationRerun({
      currentSuite: "canary",
      attemptsSinceLastPass,
      focusedVerifications: [
        {
          status: "passed",
          startedAt: "2026-08-29T19:36:00Z",
          candidateFingerprint: "source-a",
          suite: "canary",
          grep: "@CANARY",
          target: "local" as const,
          passedTestIds: ["@CANARY"],
          total: 9,
        },
      ],
      currentCandidateFingerprint: "source-a",
      currentTarget: "local" as const,
      fullSuiteTestCount: 9,
      overrideReason: null,
    });
    expect(suiteWideProof.allowed).toBe(false);

    const focusedC9Proof = evaluateFullCertificationRerun({
      currentSuite: "canary",
      attemptsSinceLastPass,
      focusedVerifications: [
        {
          status: "passed",
          startedAt: "2026-08-29T19:36:00Z",
          candidateFingerprint: "source-a",
          suite: "canary",
          grep: "C9:",
          target: "local" as const,
          passedTestIds: ["C9:"],
          total: 1,
        },
      ],
      currentCandidateFingerprint: "source-a",
      currentTarget: "local" as const,
      fullSuiteTestCount: 9,
      overrideReason: null,
    });
    expect(focusedC9Proof.allowed).toBe(true);
  });
});

function repeatedInput(
  attempts: Array<{
    runKey: string;
    status: "failed";
    startedAt: string;
    classification: "harness";
    classifiedAt: string;
    failedSpecFile: string | null;
  }>,
  focusedVerifications: Array<{
    status: "passed";
    startedAt: string;
    candidateFingerprint: string;
    suite: "golden";
    grep: string;
    total: number;
    target: "local";
    passedTestIds: string[];
  }>,
) {
  return {
    currentSuite: "golden" as const,
    attemptsSinceLastPass: [
      ...attempts,
      {
        ...attempts[0],
        runKey: "failed-2",
        startedAt: "2026-08-25T12:00:00Z",
        classifiedAt: "2026-08-25T12:30:00Z",
      },
    ],
    focusedVerifications: [
      ...focusedVerifications,
      {
        status: "passed" as const,
        startedAt: "2026-08-25T13:00:00Z",
        candidateFingerprint: "source-a",
        suite: "golden" as const,
        grep: "@P1-16",
        target: "local" as const,
        passedTestIds: ["@P1-16"],
        total: 4,
      },
    ],
    currentCandidateFingerprint: "source-a",
      currentTarget: "local" as const,
    fullSuiteTestCount: 114,
  };
}
