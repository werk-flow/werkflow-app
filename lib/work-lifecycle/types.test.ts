import { describe, expect, test } from 'bun:test';

import {
  getAllowedWorkTransitions,
  getWorkNextAction,
  parseWorkLifecycleSnapshot,
  WORK_EXECUTION_LABELS,
  WORK_EXECUTION_STATES,
  WORK_TRANSITIONS,
  workTransitionActionLabel,
  type WorkBlocker,
  type WorkDependency,
  type WorkLifecycleSnapshot,
} from './types';

const snapshot = (overrides: Partial<WorkLifecycleSnapshot>): WorkLifecycleSnapshot => ({
  targetType: 'job',
  targetId: '00000000-0000-4000-8000-000000000001',
  executionState: 'not_started',
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

/** An open blocker row of the job; the next action reads only its kind and state. */
const openBlocker = (kind: WorkBlocker['kind']): WorkBlocker => ({
  id: '00000000-0000-4000-8000-000000000005',
  organization_id: '00000000-0000-4000-8000-000000000003',
  job_id: '00000000-0000-4000-8000-000000000001',
  project_id: null,
  instruction_item_id: null,
  parent_project_parking_blocker_id: null,
  kind,
  state: 'open',
  reason: null,
  details: null,
  next_review_date: null,
  responsible_employee_record_id: null,
  resolution_note: null,
  resolved_at: null,
  resolved_by: null,
  is_legacy: false,
  legacy_source: null,
  version: 1,
  created_at: '2026-08-23T12:00:00Z',
  created_by: null,
  updated_at: '2026-08-23T12:00:00Z',
  updated_by: null,
});

/** An unsatisfied prerequisite of the job; the next action reads only its effect and satisfaction. */
const unsatisfiedDependency = (effect: WorkDependency['effect']): WorkDependency => ({
  id: '00000000-0000-4000-8000-000000000006',
  organization_id: '00000000-0000-4000-8000-000000000003',
  dependent_job_id: '00000000-0000-4000-8000-000000000001',
  dependent_project_id: null,
  predecessor_job_id: null,
  predecessor_project_id: null,
  predecessor_instruction_item_id: null,
  artifact_approval_action_id: null,
  declared_kind: null,
  description: null,
  effect,
  manual_state: null,
  removed_at: null,
  removed_by: null,
  version: 1,
  created_at: '2026-08-23T12:00:00Z',
  created_by: null,
  updated_at: '2026-08-23T12:00:00Z',
  updated_by: null,
  is_satisfied: false,
});

const databaseSnapshot = {
  targetType: 'job',
  targetId: '00000000-0000-4000-8000-000000000001',
  executionState: 'not_started',
  executionVersion: 0,
  isLegacy: false,
  isPlanned: false,
  gates: snapshot({}).gates,
  blockers: [],
  dependencies: [],
  history: [
    {
      id: '00000000-0000-4000-8000-000000000002',
      organization_id: '00000000-0000-4000-8000-000000000003',
      job_id: '00000000-0000-4000-8000-000000000001',
      project_id: null,
      event_type: 'transitioned',
      from_state: 'not_started',
      to_state: 'in_progress',
      previous_version: 0,
      resulting_version: 1,
      reason: null,
      gate_snapshot: {},
      gate_fingerprint: 'a'.repeat(64),
      event_payload: {},
      created_by: '00000000-0000-4000-8000-000000000004',
      created_at: '2026-08-23T12:00:00Z',
    },
  ],
};

describe('work lifecycle', () => {
  test('defines only the approved directed execution transitions', () => {
    expect(WORK_TRANSITIONS).toEqual({
      not_started: ['in_progress', 'cancelled'],
      in_progress: ['interrupted', 'execution_complete', 'cancelled'],
      interrupted: ['in_progress', 'cancelled'],
      execution_complete: ['handed_over', 'in_progress'],
      handed_over: ['execution_complete'],
      cancelled: ['not_started'],
    });
  });

  test('keeps cancellation manager-owned and routes handover through its package workflow', () => {
    expect(getAllowedWorkTransitions('in_progress', false)).toEqual(['interrupted', 'execution_complete']);
    expect(getAllowedWorkTransitions('execution_complete', false)).toEqual([]);
    expect(getAllowedWorkTransitions('cancelled', false)).toEqual([]);
    expect(getAllowedWorkTransitions('execution_complete', true)).toEqual(['in_progress']);
    expect(getAllowedWorkTransitions('handed_over', true)).toEqual([]);
    expect(getAllowedWorkTransitions('in_progress', true)).toEqual([
      'interrupted',
      'execution_complete',
      'cancelled',
    ]);
    expect(getAllowedWorkTransitions('cancelled', true)).toEqual(['not_started']);
  });

  test('names every offered transition as a step, never as the state it ends in', () => {
    const offered = WORK_EXECUTION_STATES.flatMap((from) =>
      [true, false].flatMap((isManager) =>
        getAllowedWorkTransitions(from, isManager).map((to) => workTransitionActionLabel(from, to)),
      ),
    );
    for (const label of offered) expect(Object.values(WORK_EXECUTION_LABELS)).not.toContain(label);
    expect(workTransitionActionLabel('not_started', 'in_progress')).toBe('Ausführung starten');
    expect(workTransitionActionLabel('interrupted', 'in_progress')).toBe('Ausführung fortsetzen');
    expect(workTransitionActionLabel('in_progress', 'cancelled')).toBe('Stornieren');
    expect(workTransitionActionLabel('cancelled', 'not_started')).toBe('Wieder öffnen');
  });

  test('prioritizes parking, blockers, and prerequisites over state guidance', () => {
    expect(
      getWorkNextAction(
        snapshot({
          blockers: [openBlocker('parking')],
        }),
      ),
    ).toBe('Parkgrund prüfen und Arbeit wieder einplanen');
    expect(
      getWorkNextAction(
        snapshot({
          blockers: [openBlocker('blocker')],
        }),
      ),
    ).toBe('Offene Blocker klären');
    expect(
      getWorkNextAction(
        snapshot({
          dependencies: [unsatisfiedDependency('blocks_start')],
        }),
      ),
    ).toBe('Voraussetzungen klären');
  });

  test('warning-only prerequisites do not replace the execution guidance', () => {
    expect(
      getWorkNextAction(
        snapshot({
          executionState: 'interrupted',
          dependencies: [unsatisfiedDependency('warning')],
        }),
      ),
    ).toBe('Arbeit fortsetzen');
  });

  test('accepts a complete database snapshot and rejects missing gates', () => {
    expect(parseWorkLifecycleSnapshot(databaseSnapshot).success).toBe(true);
    const withoutGates = Object.fromEntries(
      Object.entries(databaseSnapshot).filter(([key]) => key !== 'gates'),
    );
    expect(parseWorkLifecycleSnapshot(withoutGates).success).toBe(false);
  });

  test('validates populated artifact gate facts', () => {
    const artifactFact = {
      artifactId: '00000000-0000-4000-8000-000000000005',
      version: 2,
      revisionId: '00000000-0000-4000-8000-000000000006',
      status: 'approved',
      kind: 'defect',
      latestActionId: null,
      defectState: 'resolved',
    };
    const populated = {
      ...databaseSnapshot,
      gates: {
        ...databaseSnapshot.gates,
        artifactFacts: [artifactFact],
      },
    };
    expect(parseWorkLifecycleSnapshot(populated).success).toBe(true);
    expect(
      parseWorkLifecycleSnapshot({
        ...populated,
        gates: {
          ...populated.gates,
          artifactFacts: [{ ...artifactFact, kind: 'unknown' }],
        },
      }).success,
    ).toBe(false);
  });

  test('rejects a transition fingerprint with the wrong size', () => {
    expect(
      parseWorkLifecycleSnapshot({
        ...databaseSnapshot,
        history: [{ ...databaseSnapshot.history[0], gate_fingerprint: 'too-short' }],
      }).success,
    ).toBe(false);
  });
});
