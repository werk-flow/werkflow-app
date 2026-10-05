import type { PlanningActionFailure, PlanningConflict } from './types';

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

/**
 * A conflicting planning write needs an override reason and the fingerprint
 * of the assessment the manager saw; otherwise the warning is returned again.
 */
export function rejectUnacknowledgedConflicts(
  assessment: AssessedConflicts,
  acknowledgement: ConflictAcknowledgement,
): PlanningActionFailure | null {
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
