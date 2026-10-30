import 'server-only';
import { logReadFailure } from '@/lib/data/read-request-cache';
import type { OrgRole } from '@/lib/roles';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { LIST_ROW_CAP, readCompleteRows, readInBatches } from '@/lib/supabase/query-batches';
import { toTimeSegmentFact, type TimeSegmentFact } from '@/lib/time-tracking/segments';
import { constrainedValue } from '@/lib/validation/constrained-value';
import { createSegmentCorrectionSnapshot } from './segment-snapshot';
import {
  isTimeCorrectionSnapshot,
  normalizeTimestampSourceVersion,
  type TimeCorrectionSnapshot,
  type TimeCorrectionSource,
} from './types';
import { timeEntryTypeSchema, type SubmitTimeCorrectionInput } from './validation';

// The reads a correction submission starts from: who each employee record
// belongs to, and the facts and version of each source it names.

export type EmployeeIdentity = {
  id: string;
  userId: string;
  role: OrgRole;
};

export type SourceContext = {
  source: TimeCorrectionSource | null;
  snapshot: TimeCorrectionSnapshot;
  segment?: TimeSegmentFact;
};

/** Why a source has no context: it is gone or foreign, or a read of it failed. */
export type SourceRefusal = 'source_not_found' | 'correction_timeline_unavailable';

type SourceQuery = {
  organizationId: string;
  subject: EmployeeIdentity;
  sourceId: string;
};

export async function loadEmployeeIdentities(
  organizationId: string,
  employeeRecordIds: readonly string[],
): Promise<Map<string, EmployeeIdentity> | null> {
  const uniqueIds = [...new Set(employeeRecordIds)];
  if (uniqueIds.length === 0) return new Map();
  const admin = createSupabaseAdminClient();
  const { data: employees, error: employeeError } = await readInBatches(uniqueIds, (batch) =>
    admin
      .from('employee_records')
      .select('id, user_id')
      .eq('organization_id', organizationId)
      .in('id', [...batch])
      .not('user_id', 'is', null),
  );
  if (employeeError) logReadFailure('loadEmployeeIdentities: employee records failed', employeeError);
  if (employeeError || employees.length !== uniqueIds.length) return null;
  // The query selects only linked records, so every row carries a user id.
  const linked = employees.flatMap(({ id, user_id: userId }) => (userId !== null ? [{ id, userId }] : []));
  const userIds = linked.map((employee) => employee.userId);
  const { data: memberships, error: membershipError } = await readInBatches(userIds, (batch) =>
    admin
      .from('organization_members')
      .select('user_id, role')
      .eq('organization_id', organizationId)
      .in('user_id', [...batch]),
  );
  if (membershipError) logReadFailure('loadEmployeeIdentities: memberships failed', membershipError);
  if (membershipError || memberships.length !== uniqueIds.length) return null;
  const roleByUser = new Map(memberships.map((membership) => [membership.user_id, membership.role]));
  const identities = new Map<string, EmployeeIdentity>();
  // One record per person and one membership per person: the counts above leave no user without a role.
  for (const employee of linked) {
    const role = roleByUser.get(employee.userId);
    if (!role) return null;
    identities.set(employee.id, { ...employee, role });
  }
  return identities;
}

async function loadLegacyEntryContext(input: SourceQuery): Promise<SourceContext | SourceRefusal> {
  const { data: entry, error } = await createSupabaseAdminClient()
    .from('time_entries')
    .select('id, user_id, entry_type, timestamp, job_id, is_manual, updated_at')
    .eq('id', input.sourceId)
    .eq('organization_id', input.organizationId)
    .maybeSingle();
  if (error) {
    logReadFailure('loadSourceContext: legacy entry failed', error);
    return 'correction_timeline_unavailable';
  }
  if (!entry || entry.user_id !== input.subject.userId) return 'source_not_found';
  return {
    source: {
      kind: 'legacy_entry',
      id: entry.id,
      version: normalizeTimestampSourceVersion(entry.updated_at),
    },
    snapshot: {
      schemaVersion: 1,
      facts: [
        {
          factId: entry.id,
          employeeRecordId: input.subject.id,
          userId: input.subject.userId,
          entryType: constrainedValue(
            timeEntryTypeSchema.options,
            entry.entry_type,
            'time_entries.entry_type',
          ),
          timestamp: entry.timestamp,
          jobId: entry.job_id,
          activityKind: null,
          isManual: entry.is_manual,
        },
      ],
    },
  };
}

async function loadSegmentContext(input: SourceQuery): Promise<SourceContext | SourceRefusal> {
  const admin = createSupabaseAdminClient();
  const { data: segment, error } = await admin
    .from('time_segments')
    .select('*')
    .eq('id', input.sourceId)
    .eq('organization_id', input.organizationId)
    .maybeSingle();
  if (error) {
    logReadFailure('loadSourceContext: segment failed', error);
    return 'correction_timeline_unavailable';
  }
  if (!segment || segment.employee_record_id !== input.subject.id) return 'source_not_found';
  const session = await readCompleteRows(
    (from, to) =>
      admin
        .from('time_segments')
        .select('*')
        .eq('organization_id', input.organizationId)
        .eq('employee_record_id', input.subject.id)
        .eq('session_id', segment.session_id)
        .order('started_at')
        .order('id')
        .range(from, to),
    LIST_ROW_CAP,
  );
  if (session.error) {
    logReadFailure('loadSourceContext: session segments failed', session.error);
    return 'correction_timeline_unavailable';
  }
  if (!session.data.length) return 'source_not_found';
  const segmentFact = toTimeSegmentFact(segment);
  return {
    source: {
      kind: 'canonical_segment',
      id: segment.id,
      version: normalizeTimestampSourceVersion(segment.updated_at),
    },
    snapshot: createSegmentCorrectionSnapshot(
      segmentFact,
      session.data.map(toTimeSegmentFact),
      input.subject.userId,
    ),
    segment: segmentFact,
  };
}

async function loadApplicationContext(input: SourceQuery): Promise<SourceContext | SourceRefusal> {
  const admin = createSupabaseAdminClient();
  const { data: application, error } = await admin
    .from('time_correction_applications')
    .select('id, source_fingerprint, applied_snapshot, request_id')
    .eq('id', input.sourceId)
    .eq('organization_id', input.organizationId)
    .maybeSingle();
  if (error) {
    logReadFailure('loadSourceContext: correction application failed', error);
    return 'correction_timeline_unavailable';
  }
  if (!application || !isTimeCorrectionSnapshot(application.applied_snapshot)) {
    return 'source_not_found';
  }
  const { data: request, error: requestError } = await admin
    .from('time_correction_requests')
    .select('subject_employee_record_id')
    .eq('id', application.request_id)
    .eq('organization_id', input.organizationId)
    .maybeSingle();
  if (requestError) {
    logReadFailure('loadSourceContext: correction request failed', requestError);
    return 'correction_timeline_unavailable';
  }
  const effectiveOwners = new Set(application.applied_snapshot.facts.map((fact) => fact.employeeRecordId));
  const effectiveOwner =
    effectiveOwners.size === 1 ? effectiveOwners.values().next().value : request?.subject_employee_record_id;
  if (effectiveOwner !== input.subject.id) return 'source_not_found';
  return {
    source: {
      kind: 'correction_application',
      id: application.id,
      version: application.source_fingerprint,
    },
    snapshot: application.applied_snapshot,
  };
}

/** The facts and version of one named source; no source reads as an empty snapshot. */
export async function loadSourceContext(input: {
  organizationId: string;
  subject: EmployeeIdentity;
  source: SubmitTimeCorrectionInput['source'];
}): Promise<SourceContext | SourceRefusal> {
  if (!input.source) return { source: null, snapshot: { schemaVersion: 1, facts: [] } };
  const query = { organizationId: input.organizationId, subject: input.subject, sourceId: input.source.id };
  if (input.source.kind === 'legacy_entry') return loadLegacyEntryContext(query);
  if (input.source.kind === 'canonical_segment') return loadSegmentContext(query);
  if (input.source.kind === 'correction_application') return loadApplicationContext(query);
  return 'source_not_found';
}
