import type { Database, Json } from '@/lib/supabase/database.types';

export type PlanningEntryKind =
  Database['public']['Enums']['planning_entry_kind'];
export type PlanningInternalType =
  Database['public']['Enums']['planning_internal_type'];
export type PlanningTimeKind =
  Database['public']['Enums']['planning_time_kind'];
export type PlanningOccurrenceStatus =
  Database['public']['Enums']['planning_occurrence_status'];

export type RecurrenceFrequency = 'daily' | 'weekly' | 'monthly';
export type PlanningMutationScope = 'one' | 'future' | 'series';
export type DstResolution = 'exact' | 'shifted_forward' | 'first_ambiguous';

export type PlanningRecurrenceRule = {
  frequency: RecurrenceFrequency;
  interval: number;
  weekdays: number[] | null;
  monthDay: number | null;
  occurrenceCount: number | null;
  untilLocalDate: string | null;
};

export type PlanningSeriesDraft = PlanningRecurrenceRule & {
  entryKind: PlanningEntryKind;
  internalType: PlanningInternalType | null;
  jobId: string | null;
  title: string | null;
  description: string | null;
  location: string | null;
  timeKind: PlanningTimeKind;
  startsAtLocal: string;
  durationMinutes: number | null;
  durationDays: number | null;
  timezone: 'Europe/Berlin';
};

export type MaterializedOccurrence = {
  originalStartLocal: string;
  timeKind: PlanningTimeKind;
  startAt: string | null;
  endAt: string | null;
  startDate: string | null;
  endDateExclusive: string | null;
  dstResolution: DstResolution;
};

export type PlanningAssignmentDraft = {
  employeeRecordId: string;
  teamSourceId: string | null;
};

export type PlanningAssessmentSnapshot = {
  capacityFingerprint: string;
  capacitySnapshot: Json;
  qualificationFingerprint: string;
  qualificationSnapshot: Json;
  overrideReason: string | null;
};

export type PlanningConflictKind =
  | 'no_schedule'
  | 'holiday_or_closure'
  | 'approved_absence'
  | 'pending_absence'
  | 'overlap'
  | 'over_capacity'
  | 'qualification';

export type PlanningConflict = {
  kind: PlanningConflictKind;
  severity: 'warning';
  employeeRecordId: string | null;
  // Display name resolved server-side AFTER fingerprinting, so warnings can
  // explain the affected person without name changes altering fingerprints.
  employeeName?: string | null;
  localDate: string | null;
  message: string;
  details: Record<string, string | number | boolean | null>;
};

// German labels for non-scheduled occurrence statuses. Skipped/cancelled
// occurrences stay traceably visible in the calendar instead of disappearing.
export const PLANNING_OCCURRENCE_STATUS_LABELS: Partial<
  Record<PlanningOccurrenceStatus, string>
> = {
  skipped: 'Ausgelassen',
  cancelled: 'Abgesagt',
};

export type CapacityDayContext = {
  employeeRecordId: string;
  localDate: string;
  targetMinutes: number | null;
  targetSource: string;
  approvedAbsenceMinutes: number;
  pendingAbsenceMinutes: number;
  existingPlannedMinutes: number;
  overlapMinutes: number;
};

export type CapacityEvaluation = {
  conflicts: PlanningConflict[];
  employeeDays: Array<
    CapacityDayContext & {
      proposedMinutes: number;
      remainingMinutes: number | null;
    }
  >;
};

export type PlanningCalendarEntry = {
  id: string;
  occurrenceId: string;
  jobId: string | null;
  seriesId: string | null;
  seriesLineageId: string | null;
  entryKind: PlanningEntryKind;
  internalType: PlanningInternalType | null;
  timeKind: PlanningTimeKind;
  status: PlanningOccurrenceStatus;
  version: number;
  isException: boolean;
  title: string;
  description: string | null;
  location: string | null;
  plannedDate: string | null;
  plannedTime: string | null;
  startAt: string | null;
  endDateExclusive: string | null;
  endAt: string | null;
  estimatedDurationMinutes: number | null;
  assignedEmployeeRecordIds: string[];
  assignedUserIds: string[];
  jobNumber: string | null;
  jobStatus: Database['public']['Enums']['job_status'] | null;
  jobExecutionVersion: number;
  priority: Database['public']['Enums']['job_priority'] | null;
  clientName: string | null;
  clientAddress: string | null;
  projectName: string | null;
  projectNumber: string | null;
};

export type PlanningActionResult =
  | { success: true; occurrenceIds: string[] }
  | {
      success: false;
      error: string;
      conflicts?: PlanningConflict[];
      fingerprint?: string;
    };
