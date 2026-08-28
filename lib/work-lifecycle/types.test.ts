import { describe, expect, test } from "bun:test";

import {
  getAllowedWorkTransitions,
  getWorkNextAction,
  parseWorkLifecycleSnapshot,
  WORK_TRANSITIONS,
  type WorkLifecycleSnapshot,
} from "./types";

const snapshot = (
  overrides: Partial<WorkLifecycleSnapshot>,
): WorkLifecycleSnapshot => ({
  targetType: "job",
  targetId: "00000000-0000-4000-8000-000000000001",
  executionState: "not_started",
  executionVersion: 0,
  isLegacy: false,
  isPlanned: false,
  gates: {
    incompleteRequiredInstructions: 0,
    reopenedInstructionPredecessors: 0,
    incompleteInstructionEvidence: 0,
    openBlockers: 0,
    openStartDependencies: 0,
    openCompletionDependencies: 0,
    activeJobClocks: 0,
    incompleteProjectChildren: 0,
    measurementArtifacts: 0,
    openDefects: 0,
    pendingFormalApprovals: 0,
    requiredCustomerDecisions: 0,
    requiredSignatures: 0,
    artifactFacts: [],
    notAssessable: [],
  },
  blockers: [],
  resolvedBlockers: [],
  dependencies: [],
  history: [],
  readiness: null,
  readinessLoadFailed: false,
  ownOwnerId: null,
  ownerOptions: [],
  predecessorOptions: { job: [], project: [], instruction: [], declared: [] },
  ...overrides,
});

const databaseSnapshot = {
  targetType: "job",
  targetId: "00000000-0000-4000-8000-000000000001",
  executionState: "not_started",
  executionVersion: 0,
  isLegacy: false,
  isPlanned: false,
  gates: snapshot({}).gates,
  blockers: [],
  dependencies: [],
  history: [
    {
      id: "00000000-0000-4000-8000-000000000002",
      organization_id: "00000000-0000-4000-8000-000000000003",
      job_id: "00000000-0000-4000-8000-000000000001",
      project_id: null,
      event_type: "transitioned",
      from_state: "not_started",
      to_state: "in_progress",
      previous_version: 0,
      resulting_version: 1,
      reason: null,
      gate_snapshot: {},
      gate_fingerprint: "a".repeat(64),
      event_payload: {},
      created_by: "00000000-0000-4000-8000-000000000004",
      created_at: "2026-08-23T12:00:00Z",
    },
  ],
};

describe("work lifecycle", () => {
  test("defines only the approved directed execution transitions", () => {
    expect(WORK_TRANSITIONS).toEqual({
      not_started: ["in_progress", "cancelled"],
      in_progress: ["interrupted", "execution_complete", "cancelled"],
      interrupted: ["in_progress", "cancelled"],
      execution_complete: ["handed_over", "in_progress"],
      handed_over: ["execution_complete"],
      cancelled: ["not_started"],
    });
  });

  test("keeps cancellation manager-owned and routes handover through its package workflow", () => {
    expect(getAllowedWorkTransitions("in_progress", false)).toEqual([
      "interrupted",
      "execution_complete",
    ]);
    expect(getAllowedWorkTransitions("execution_complete", false)).toEqual([]);
    expect(getAllowedWorkTransitions("cancelled", false)).toEqual([]);
    expect(getAllowedWorkTransitions("execution_complete", true)).toEqual(["in_progress"]);
    expect(getAllowedWorkTransitions("handed_over", true)).toEqual([]);
    expect(getAllowedWorkTransitions("in_progress", true)).toEqual([
      "interrupted",
      "execution_complete",
      "cancelled",
    ]);
    expect(getAllowedWorkTransitions("cancelled", true)).toEqual(["not_started"]);
  });

  test("prioritizes parking, blockers, and prerequisites over state guidance", () => {
    expect(
      getWorkNextAction(
        snapshot({
          blockers: [
            { kind: "parking", state: "open" } as WorkLifecycleSnapshot["blockers"][number],
          ],
        }),
      ),
    ).toBe("Parkgrund prüfen und Arbeit wieder einplanen");
    expect(
      getWorkNextAction(
        snapshot({
          blockers: [
            { kind: "blocker", state: "open" } as WorkLifecycleSnapshot["blockers"][number],
          ],
        }),
      ),
    ).toBe("Offene Blocker klären");
    expect(
      getWorkNextAction(
        snapshot({
          dependencies: [
            {
              effect: "blocks_start",
              is_satisfied: false,
            } as WorkLifecycleSnapshot["dependencies"][number],
          ],
        }),
      ),
    ).toBe("Voraussetzungen klären");
  });

  test("warning-only prerequisites do not replace the execution guidance", () => {
    expect(
      getWorkNextAction(
        snapshot({
          executionState: "interrupted",
          dependencies: [
            {
              effect: "warning",
              is_satisfied: false,
            } as WorkLifecycleSnapshot["dependencies"][number],
          ],
        }),
      ),
    ).toBe("Arbeit fortsetzen");
  });

  test("accepts a complete database snapshot and rejects missing gates", () => {
    expect(parseWorkLifecycleSnapshot(databaseSnapshot).success).toBe(true);
    const withoutGates = Object.fromEntries(
      Object.entries(databaseSnapshot).filter(([key]) => key !== "gates"),
    );
    expect(parseWorkLifecycleSnapshot(withoutGates).success).toBe(false);
  });

  test("validates populated artifact gate facts", () => {
    const artifactFact = {
      artifactId: "00000000-0000-4000-8000-000000000005", version: 2,
      revisionId: "00000000-0000-4000-8000-000000000006", status: "approved",
      kind: "defect", latestActionId: null, defectState: "resolved",
    };
    const populated = { ...databaseSnapshot, gates: {
      ...databaseSnapshot.gates, artifactFacts: [artifactFact],
    } };
    expect(parseWorkLifecycleSnapshot(populated).success).toBe(true);
    expect(parseWorkLifecycleSnapshot({ ...populated, gates: {
      ...populated.gates, artifactFacts: [{ ...artifactFact, kind: "unknown" }],
    } }).success).toBe(false);
  });

  test("rejects a transition fingerprint with the wrong size", () => {
    expect(
      parseWorkLifecycleSnapshot({
        ...databaseSnapshot,
        history: [
          { ...databaseSnapshot.history[0], gate_fingerprint: "too-short" },
        ],
      }).success,
    ).toBe(false);
  });
});
