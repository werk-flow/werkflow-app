import type { WorkLifecycleSnapshot } from "@/lib/work-lifecycle/types";

type LifecycleActions = typeof import("@/lib/work-lifecycle/actions");

export const ROUTE_REFRESH_EVENT = "ui-contract:route-refresh";

type LifecycleBoundaryState = {
  snapshot: WorkLifecycleSnapshot;
  rejectTransition: boolean;
  transitions: number;
};

declare global {
  interface Window {
    uiContractFixture: "default" | "lifecycle" | "personnel" | "own-personnel";
    uiContractLifecycle: LifecycleBoundaryState;
  }
}

export function initializeLifecycleBoundary(): void {
  window.uiContractLifecycle = {
    rejectTransition: false,
    transitions: 0,
    snapshot: {
      targetType: "job",
      targetId: "contract-job",
      executionState: "not_started",
      executionVersion: 0,
      isLegacy: false,
      isPlanned: true,
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
      predecessorOptions: {
        job: [],
        project: [],
        instruction: [],
        declared: [],
      },
    },
  };
}

/** No events or synthetic catch-up: local success must reconcile its owner. */
export function useRealtimeSubscribe(): null {
  return null;
}

export async function getWorkLifecycleSnapshot(): Promise<{
  success: true;
  snapshot: WorkLifecycleSnapshot;
}> {
  window.uiContractServices.navigation.push("read-work-lifecycle");
  return {
    success: true,
    snapshot: structuredClone(window.uiContractLifecycle.snapshot),
  };
}

export async function transitionWorkExecution(
  input: Parameters<LifecycleActions["transitionWorkExecution"]>[0],
): ReturnType<LifecycleActions["transitionWorkExecution"]> {
  const state = window.uiContractLifecycle;
  if (state.rejectTransition)
    return { success: false, error: "work_transition_not_authorized" };
  if (
    input.targetType !== state.snapshot.targetType ||
    input.targetId !== state.snapshot.targetId ||
    input.expectedVersion !== state.snapshot.executionVersion
  ) {
    return { success: false, error: "work_transition_stale_version" };
  }
  state.transitions += 1;
  state.snapshot = {
    ...state.snapshot,
    executionState: input.toState,
    executionVersion: state.snapshot.executionVersion + 1,
  };
  // Deliberately no RSC patch or event: those independent channels can be absent.
  return {
    success: true,
    transition: {
      event_id: "contract-transition",
      execution_state: state.snapshot.executionState,
      execution_version: state.snapshot.executionVersion,
      gate_fingerprint: "contract-gates",
      gate_snapshot: {},
    },
  };
}

async function unexpectedLifecycleAction(): Promise<never> {
  throw new Error("Unexpected lifecycle operation in isolated UI contracts.");
}

export const clearProjectWorkExecutionOverride = unexpectedLifecycleAction;
export const getApprovedArtifactActionsForTarget = unexpectedLifecycleAction;
export const linkWorkDependencyArtifactApproval = unexpectedLifecycleAction;
export const parkWorkTarget = unexpectedLifecycleAction;
export const removeWorkDependency = unexpectedLifecycleAction;
export const reopenWorkBlocker = unexpectedLifecycleAction;
export const saveWorkBlocker = unexpectedLifecycleAction;
export const saveWorkDependency = unexpectedLifecycleAction;
export const searchWorkPredecessors = unexpectedLifecycleAction;
export const setDeclaredWorkDependencyState = unexpectedLifecycleAction;
export const setWorkBlockerResolved = unexpectedLifecycleAction;
export const unparkWorkTarget = unexpectedLifecycleAction;
