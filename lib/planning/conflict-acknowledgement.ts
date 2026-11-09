import type { ActionFailure } from '@/lib/action-result';
import type { PlanningConflict } from './types';

/** The part of a planning assessment the acknowledgement rule reads. */
export type AssessedConflicts = {
  conflicts: PlanningConflict[];
  assessmentFingerprint: string;
};

/** What a manager sends to confirm the conflicts of the assessment they saw. */
export type ConflictAcknowledgement = {
  overrideReason: string | null;
  assessmentFingerprint: string | null;
};

/** A manager's confirmation of the planning conflicts they saw, as a job-page save sends it. */
export type PlanningConflictApproval = { fingerprint: string; reason: string };

/** The acknowledgement a job save sends for the planning conflicts of the visit it plans. */
export function planningAcknowledgement(
  approval: PlanningConflictApproval | null | undefined,
): ConflictAcknowledgement {
  return { overrideReason: approval?.reason ?? null, assessmentFingerprint: approval?.fingerprint ?? null };
}

/** The refusal of a conflicting write: the conflicts and the fingerprint the manager must confirm. */
export type PlanningWarningFailure = ActionFailure<'planning_warning' | 'stale_assessment'> & {
  conflicts: PlanningConflict[];
  fingerprint: string;
};

/**
 * A conflicting planning write needs an override reason and the fingerprint
 * of the assessment the manager saw; otherwise the warning is returned again.
 */
export function rejectUnacknowledgedConflicts(
  assessment: AssessedConflicts,
  acknowledgement: ConflictAcknowledgement,
): PlanningWarningFailure | null {
  if (assessment.conflicts.length === 0) return null;
  if (!acknowledgement.overrideReason) {
    return {
      success: false,
      error: 'planning_warning',
      conflicts: assessment.conflicts,
      fingerprint: assessment.assessmentFingerprint,
    };
  }
  if (acknowledgement.assessmentFingerprint !== assessment.assessmentFingerprint) {
    return {
      success: false,
      error: 'stale_assessment',
      conflicts: assessment.conflicts,
      fingerprint: assessment.assessmentFingerprint,
    };
  }
  return null;
}
