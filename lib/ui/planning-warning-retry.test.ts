import { describe, expect, test } from 'bun:test';
import { saveUntilPlanningSettled } from '@/components/auftraege/forms/planning-warning-result';
import type { ActionFailure } from '@/lib/action-result';
import type {
  PlanningConflictApproval,
  PlanningWarningFailure,
} from '@/lib/planning/conflict-acknowledgement';
import type { PlanningConflict } from '@/lib/planning/types';

type Result = { success: true; jobId: string } | PlanningWarningFailure | ActionFailure;

const conflict: PlanningConflict = {
  kind: 'approved_absence',
  severity: 'warning',
  employeeRecordId: 'record-1',
  employeeName: 'Mehmet Aydın',
  localDate: '2099-11-04',
  message: 'Genehmigte Abwesenheit',
  details: {},
};
const warning = (error: 'planning_warning' | 'stale_assessment', fingerprint: string): Result => ({
  success: false,
  error,
  conflicts: [conflict],
  fingerprint,
});

/** A save that answers with the given results in turn and records the approval of each call. */
function scriptedSave(results: Result[]) {
  const approvals: (PlanningConflictApproval | null)[] = [];
  return {
    approvals,
    save: async (approval: PlanningConflictApproval | null) => {
      approvals.push(approval);
      const next = results.shift();
      if (!next) throw new Error('the save ran more often than scripted');
      return next;
    },
  };
}

describe('a job save that plans a visit asks for the reason of each planning assessment', () => {
  test('a save without conflicts runs once and asks nothing', async () => {
    const { save, approvals } = scriptedSave([{ success: true, jobId: 'job-1' }]);
    const asked: string[] = [];
    const result = await saveUntilPlanningSettled(save, async (_conflicts, fingerprint) => {
      asked.push(fingerprint);
      return null;
    });
    expect(result).toEqual({ success: true, jobId: 'job-1' });
    expect(approvals).toEqual([null]);
    expect(asked).toEqual([]);
  });

  test('a confirmed reason saves again with the fingerprint of the assessment it answers, also after a stale one', async () => {
    const { save, approvals } = scriptedSave([
      warning('planning_warning', 'a'.repeat(64)),
      warning('stale_assessment', 'b'.repeat(64)),
      { success: true, jobId: 'job-1' },
    ]);
    const result = await saveUntilPlanningSettled(save, async (conflicts, fingerprint) => ({
      fingerprint,
      reason: `Abgestimmt: ${conflicts[0]?.employeeName}`,
    }));
    expect(result).toEqual({ success: true, jobId: 'job-1' });
    expect(approvals).toEqual([
      null,
      { fingerprint: 'a'.repeat(64), reason: 'Abgestimmt: Mehmet Aydın' },
      { fingerprint: 'b'.repeat(64), reason: 'Abgestimmt: Mehmet Aydın' },
    ]);
  });

  test('a change taken back ends with the warning and saves nothing more', async () => {
    const { save, approvals } = scriptedSave([warning('planning_warning', 'a'.repeat(64))]);
    const result = await saveUntilPlanningSettled(save, async () => null);
    expect(result).toEqual(warning('planning_warning', 'a'.repeat(64)));
    expect(approvals).toEqual([null]);
  });

  test('any other failure ends the loop as it is', async () => {
    const { save } = scriptedSave([{ success: false, error: 'stale_occurrence' }]);
    expect(await saveUntilPlanningSettled(save, async () => null)).toEqual({
      success: false,
      error: 'stale_occurrence',
    });
  });
});
