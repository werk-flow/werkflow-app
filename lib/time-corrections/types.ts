import type { ActionFailure } from '@/lib/action-result';
import type { Database, Json } from '@/lib/supabase/database.types';
import { isJsonRecord } from '@/lib/supabase/json';
import { timeActivitySelectionSchema } from '@/lib/time-tracking/activity-selection-schema';
import type {
  TimeEntry,
  TimeEntryType,
  TimeSegmentKind,
  TimeActivitySelection,
} from '@/lib/time-tracking/types';

export type TimeCorrectionKind = Database['public']['Enums']['time_correction_kind'];
export type TimeCorrectionStatus = Database['public']['Enums']['time_correction_status'];
type TimeCorrectionSourceKind = Database['public']['Enums']['time_correction_source_kind'];

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
  activity?: TimeActivitySelection;
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

type TimeCorrectionRevision = {
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
      applicationId?: string | null | undefined;
      replayed: boolean;
    }
  | ActionFailure;

export type TimeCorrectionListResult = { success: true; requests: TimeCorrectionRequest[] } | ActionFailure;

/** One page of the correction history and how many requests the caller sees in all. */
export type TimeCorrectionHistoryResult =
  | { success: true; page: { requests: TimeCorrectionRequest[]; total: number } }
  | ActionFailure;

/** A source version as the database writes a timestamp: `2026-01-02 03:04:05+00`. */
export function normalizeTimestampSourceVersion(value: string): string {
  return value
    .replace('T', ' ')
    .replace(/Z$/, '+00')
    .replace(/\+00:00$/, '+00');
}

/** The source a request source row links, whichever of its id columns is set. */
export function correctionSourceId(
  source: Pick<
    Database['public']['Tables']['time_correction_request_sources']['Row'],
    'time_entry_id' | 'time_session_id' | 'time_segment_id' | 'correction_application_id'
  >,
): string | null {
  return (
    source.time_entry_id ??
    source.time_session_id ??
    source.time_segment_id ??
    source.correction_application_id
  );
}

export function isTimeCorrectionSnapshot(value: Json): value is TimeCorrectionSnapshot {
  if (!isJsonRecord(value)) return false;
  const facts = value.facts;
  return (
    value.schemaVersion === 1 &&
    Array.isArray(facts) &&
    facts.every(
      (fact: unknown) =>
        isJsonRecord(fact) &&
        (fact.activity === undefined || timeActivitySelectionSchema.safeParse(fact.activity).success),
    )
  );
}

export function correctionFactToEntry(
  fact: TimeCorrectionFact,
  application: Pick<
    TimeCorrectionApplicationProjection,
    'applicationId' | 'appliedAt' | 'appliedBy' | 'sourceFingerprint'
  >,
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
    ...(fact.activity ? { activitySelection: fact.activity } : {}),
    correctionApplicationId: application.applicationId,
    correctionSourceFingerprint: application.sourceFingerprint,
  };
}
