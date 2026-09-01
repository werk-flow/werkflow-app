import type { Database, Json } from '@/lib/supabase/database.types';
import type {
  TimeEntry,
  TimeEntryType,
  TimeSegmentKind,
} from '@/lib/time-tracking/types';

export type TimeCorrectionKind =
  Database['public']['Enums']['time_correction_kind'];
export type TimeCorrectionStatus =
  Database['public']['Enums']['time_correction_status'];
export type TimeCorrectionSourceKind =
  Database['public']['Enums']['time_correction_source_kind'];

export const TIME_CORRECTION_KIND_LABELS = {
  add: 'Zeit nachtragen',
  edit: 'Zeit ändern',
  delete: 'Zeit entfernen',
  split: 'Zeit aufteilen',
  reclassify: 'Tätigkeit ändern',
  reallocate: 'Auftrag ändern',
  reassign: 'Mitarbeiter ändern',
  missed_clock: 'Vergessene Buchung nachtragen',
} as const satisfies Record<TimeCorrectionKind, string>;

export const TIME_CORRECTION_STATUS_LABELS = {
  submitted: 'Zur Prüfung',
  clarification_required: 'Rückfrage',
  approved: 'Freigegeben',
  rejected: 'Abgelehnt',
  withdrawn: 'Zurückgezogen',
  application_failed: 'Anwendung fehlgeschlagen',
} as const satisfies Record<TimeCorrectionStatus, string>;

export type TimeCorrectionFact = {
  factId: string;
  employeeRecordId: string;
  userId: string;
  entryType: TimeEntryType;
  timestamp: string;
  jobId: string | null;
  activityKind: TimeSegmentKind | null;
  isManual: boolean;
};

export type TimeCorrectionSnapshot = {
  schemaVersion: 1;
  facts: TimeCorrectionFact[];
};

export type TimeCorrectionSource = {
  kind: TimeCorrectionSourceKind;
  id: string;
  version: string;
};

export type TimeCorrectionApplicationProjection = {
  applicationId: string;
  requestId: string;
  appliedAt: string;
  appliedBy: string;
  sourceFingerprint: string;
  snapshot: TimeCorrectionSnapshot;
  sources: TimeCorrectionSource[];
};

export type TimeCorrectionRevision = {
  revision: number;
  reason: string;
  beforeSnapshot: TimeCorrectionSnapshot;
  proposedSnapshot: TimeCorrectionSnapshot;
  createdBy: string;
  createdAt: string;
};

export type TimeCorrectionRequest = {
  id: string;
  organizationId: string;
  subjectEmployeeRecordId: string;
  subjectUserId: string;
  requestedBy: string;
  kind: TimeCorrectionKind;
  status: TimeCorrectionStatus;
  currentRevision: number;
  reviewedBy: string | null;
  reviewedAt: string | null;
  decisionComment: string | null;
  createdAt: string;
  updatedAt: string;
  revision: TimeCorrectionRevision;
  requesterName: string;
  subjectName: string;
  canReview: boolean;
  canWithdraw: boolean;
};

export type TimeCorrectionResult =
  | {
      success: true;
      requestId: string;
      status: TimeCorrectionStatus;
      applicationId?: string | null;
      replayed: boolean;
    }
  | { success: false; error: string };

export const TIME_CORRECTION_ERROR_CODES = [
  'invalid_input',
  'invalid_shape',
  'invalid_time_order',
  'source_required',
  'source_not_found',
  'not_authenticated',
  'not_a_member',
  'not_responsible',
  'self_approval_not_allowed',
  'stale_source',
  'stale_revision',
  // Reserved for P1-23. P1-22 does not invent a close state.
  'period_closed',
] as const;

export type TimeCorrectionListResult =
  | { success: true; requests: TimeCorrectionRequest[] }
  | { success: false; error: string };

export function isTimeCorrectionSnapshot(value: Json): value is TimeCorrectionSnapshot {
  if (!value || Array.isArray(value) || typeof value !== 'object') return false;
  const record = value as Record<string, Json | undefined>;
  return record.schemaVersion === 1 && Array.isArray(record.facts);
}

export function correctionFactToEntry(
  fact: TimeCorrectionFact,
  application: Pick<
    TimeCorrectionApplicationProjection,
    'applicationId' | 'appliedAt' | 'appliedBy' | 'sourceFingerprint'
  >
): TimeEntry {
  return {
    id: `correction:${application.applicationId}:${fact.factId}`,
    userId: fact.userId,
    organizationId: '',
    entryType: fact.entryType,
    timestamp: fact.timestamp,
    isManual: fact.isManual,
    jobId: fact.jobId,
    status: 'approved',
    reviewedBy: application.appliedBy,
    reviewedAt: application.appliedAt,
    createdAt: application.appliedAt,
    updatedAt: application.appliedAt,
    activityKind: fact.activityKind ?? undefined,
    correctionApplicationId: application.applicationId,
    correctionSourceFingerprint: application.sourceFingerprint,
  };
}
