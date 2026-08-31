import { describe, expect, test } from "bun:test";

import {
  defaultTargetForSuite,
  evaluateFocusedIterationRerun,
  evaluateFullCertificationRerun,
  evaluateRequiredFocusedProofs,
  focusedGrepCoversToken,
  focusedProofToken,
  focusedProofTokenForFailure,
  parsePlaywrightListOutput,
  requiredFocusedProofsForChangedFiles,
  shouldRefreshStoredSession,
  validateFocusedSelection,
  validateRunRequest,
  validateSerialSelection,
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

  test("parses Playwright list output for pre-world selection checks", () => {
    expect(
      parsePlaywrightListOutput(
        [
          "Listing tests:",
          "  canary.spec.ts:41:7 › Cloud-Canary @CANARY › C1: Login",
          "  canary.spec.ts:183:7 › Cloud-Canary @CANARY › C9: Migrationen",
          "Total: 2 tests in 1 file",
        ].join("\n"),
      ),
    ).toEqual({
      titles: [
        "canary.spec.ts:41:7 › Cloud-Canary @CANARY › C1: Login",
        "canary.spec.ts:183:7 › Cloud-Canary @CANARY › C9: Migrationen",
      ],
      total: 2,
    });
  });

  test("rejects a known dependent serial test without its producer", () => {
    expect(
      validateSerialSelection({
        lane: "iteration",
        suite: "golden",
        selectedTitles: ["p1-04.spec.ts › P1-04 @P1-04 › dependent"],
      }),
    ).toContain(
      '@P1-04 requires its serial producer. Run: bun run test:golden:focused --grep "@P1-03|@P1-04".',
    );
    expect(
      validateSerialSelection({
        lane: "iteration",
        suite: "golden",
        selectedTitles: [
          "p1-03.spec.ts › P1-03 @P1-03 › producer",
          "p1-04.spec.ts › P1-04 @P1-04 › dependent",
        ],
      }),
    ).toEqual([]);
    expect(
      validateSerialSelection({
        lane: "iteration",
        suite: "audit",
        selectedTitles: [
          "@AUDIT-W1-A1 A1-02/A1-03 creates the inherited customer",
        ],
      }),
    ).toContain(
      'A1-02/A1-03 requires its serial producer. Run: bun run test:audit:focused --grep "A1-01/A1-07|A1-02/A1-03".',
    );
    expect(
      validateSerialSelection({
        lane: "iteration",
        suite: "audit",
        selectedTitles: [
          "@AUDIT-W1-A1 A1-01/A1-07 establishes the world",
          "@AUDIT-W1-A1 A1-02/A1-03 creates the inherited customer",
        ],
      }),
    ).toEqual([]);
    expect(
      validateSerialSelection({
        lane: "diagnostic",
        suite: "audit",
        selectedTitles: [
          "tests/audit/wave-1/a1-grundstock.spec.ts:1:1 › A1-02/A1-03 dependent",
        ],
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
        currentSourceFingerprint: "source-a",
      }),
    ).toEqual(requirements);
    expect(
      evaluateRequiredFocusedProofs({
        requirements,
        focusedVerifications: [
          {
            status: "passed",
            startedAt: "2026-08-29T19:00:00Z",
            sourceFingerprint: "source-a",
            suite: "golden",
            grep: "@P1-16-stage-setup|@P1-16-stage-execution",
            total: 2,
          },
        ],
        currentSourceFingerprint: "source-a",
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
      currentSourceFingerprint: "source-a",
      fullSuiteTestCount: 114,
      overrideReason: null,
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Classify failed full run failed-1");
  });

  test("requires focused proof after classification", () => {
    const result = evaluateFullCertificationRerun({
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
          sourceFingerprint: "old-source",
          suite: "golden",
          grep: "@P1-16",
          total: 1,
        },
      ],
      currentSourceFingerprint: "source-a",
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
    expect(focusedGrepCoversToken("@P1-16", "p1-16")).toBe(true);
    expect(focusedGrepCoversToken("@P1-16-stage-boundaries", "p1-16")).toBe(
      true,
    );
    expect(focusedGrepCoversToken("@P1-16", "p1-1")).toBe(false);
    expect(focusedGrepCoversToken("@P1-01", "p1-16")).toBe(false);
  });

  test("requires the focused proof to cover the failed spec", () => {
    const base = {
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
      currentSourceFingerprint: "source-a",
      fullSuiteTestCount: 114,
      overrideReason: null,
    };
    const unrelatedProof = evaluateFullCertificationRerun({
      ...base,
      focusedVerifications: [
        {
          status: "passed",
          startedAt: "2026-08-25T11:00:00Z",
          sourceFingerprint: "source-a",
          suite: "golden",
          grep: "@GG-00",
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
          sourceFingerprint: "source-a",
          suite: "golden",
          grep: "@P1-16-stage-boundaries",
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
        sourceFingerprint: "source-a",
        suite: "golden" as const,
        grep: "@P1-16",
        total: 4,
      },
    ];
    expect(
      evaluateFullCertificationRerun({
        attemptsSinceLastPass: attempts,
        focusedVerifications,
        currentSourceFingerprint: "source-a",
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
      attemptsSinceLastPass,
      focusedVerifications: [
        {
          status: "passed",
          startedAt: "2026-08-29T19:36:00Z",
          sourceFingerprint: "source-a",
          suite: "canary",
          grep: "@CANARY",
          total: 9,
        },
      ],
      currentSourceFingerprint: "source-a",
      fullSuiteTestCount: 9,
      overrideReason: null,
    });
    expect(suiteWideProof.allowed).toBe(false);

    const focusedC9Proof = evaluateFullCertificationRerun({
      attemptsSinceLastPass,
      focusedVerifications: [
        {
          status: "passed",
          startedAt: "2026-08-29T19:36:00Z",
          sourceFingerprint: "source-a",
          suite: "canary",
          grep: "C9:",
          total: 1,
        },
      ],
      currentSourceFingerprint: "source-a",
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
    sourceFingerprint: string;
    suite: "golden";
    grep: string;
    total: number;
  }>,
) {
  return {
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
        sourceFingerprint: "source-a",
        suite: "golden" as const,
        grep: "@P1-16",
        total: 4,
      },
    ],
    currentSourceFingerprint: "source-a",
    fullSuiteTestCount: 114,
  };
}
