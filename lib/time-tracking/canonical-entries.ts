import 'server-only';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { readCompleteRows, readInBatches, LIST_ROW_CAP } from '@/lib/supabase/query-batches';
import { logReadFailure } from '@/lib/data/read-request-cache';
import { logError } from '@/lib/logging';
import type { ActionResult } from '@/lib/action-result';
import {
  projectTimeSegmentsToLegacyTransitions,
  splitSegmentAtLocalDayBoundaries,
  toTimeSegmentFact,
} from './segments';
import type { TimeEntry } from './types';

/** Internal reader. Callers establish organization and employee authorization first. */
export async function getCanonicalTimeEntries(params: {
  organizationId: string;
  from: string;
  to: string;
  userId?: string | undefined;
  userIds?: readonly string[];
  jobId?: string;
  referenceTime?: string;
}): Promise<ActionResult<{ entries: TimeEntry[] }, 'load_failed'>> {
  if (params.userIds?.length === 0) return { success: true, entries: [] };
  const admin = createSupabaseAdminClient();
  const employeeQuery = () => {
    const query = admin
      .from('employee_records')
      .select('id, user_id')
      .eq('organization_id', params.organizationId)
      .not('user_id', 'is', null);
    return params.userId ? query.eq('user_id', params.userId) : query;
  };
  const { data: employees, error: employeeError } = params.userIds
    ? await readInBatches(params.userIds, (batch) =>
        readCompleteRows(
          (from, to) =>
            employeeQuery()
              .in('user_id', [...batch])
              .order('id')
              .range(from, to),
          LIST_ROW_CAP,
        ),
      )
    : await readCompleteRows((from, to) => employeeQuery().order('id').range(from, to), LIST_ROW_CAP);
  if (employeeError) {
    logReadFailure('Error fetching employees for canonical time entries:', employeeError);
    return { success: false, error: 'load_failed' };
  }
  if (!employees.length) return { success: true, entries: [] };
  const userByEmployee = new Map(employees.map((employee) => [employee.id, employee.user_id as string]));
  const { data: rows, error } = await readInBatches([...userByEmployee.keys()], (employeeIds) => {
    let segmentQuery = admin
      .from('time_segments')
      .select(
        'id, session_id, organization_id, employee_record_id, kind, allocation_kind, job_id, internal_type, travel_route, travel_role, standby_context, started_at, ended_at, created_at, updated_at',
      )
      .eq('organization_id', params.organizationId)
      .in('employee_record_id', [...employeeIds])
      .lte('started_at', params.to)
      .or(`ended_at.is.null,ended_at.gte.${params.from}`)
      .order('started_at', { ascending: true })
      .order('id');
    if (params.jobId) segmentQuery = segmentQuery.eq('job_id', params.jobId);
    return readCompleteRows((from, to) => segmentQuery.range(from, to), LIST_ROW_CAP);
  });
  if (error) {
    logReadFailure('Error fetching canonical time segments:', error);
    return { success: false, error: 'load_failed' };
  }
  if (rows.length > LIST_ROW_CAP) {
    logError('Canonical time segment window exceeds the row cap', 'row_cap_exceeded');
    return { success: false, error: 'load_failed' };
  }

  const rangeStart = new Date(params.from);
  const rangeEnd = new Date(params.to);
  const canonicalRows = rows
    .sort((left, right) => left.started_at.localeCompare(right.started_at) || left.id.localeCompare(right.id))
    .map((row) => ({
      row,
      segment: toTimeSegmentFact(row as never),
    }));
  const entryContextBySegmentId = new Map(
    canonicalRows.map(({ row, segment }) => [segment.id, { row, segment }]),
  );
  const entries: TimeEntry[] = [];

  if (!params.jobId) {
    const points = projectTimeSegmentsToLegacyTransitions(
      canonicalRows.map(({ segment }) => segment),
      rangeStart,
      rangeEnd,
      params.referenceTime ? new Date(params.referenceTime) : new Date(),
    );
    for (const [pointIndex, point] of points.entries()) {
      const context = entryContextBySegmentId.get(point.segmentId);
      if (!context) continue;
      const { row, segment } = context;
      const userId = userByEmployee.get(segment.employeeRecordId);
      if (!userId) continue;
      entries.push({
        id: `${segment.id}:${point.sliceIndex}:${pointIndex}:${point.entryType}`,
        userId,
        organizationId: segment.organizationId,
        entryType: point.entryType,
        timestamp: point.timestamp,
        isManual: false,
        jobId: segment.jobId ?? null,
        status: 'approved',
        reviewedBy: null,
        reviewedAt: null,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        activityKind: segment.kind,
        canonicalSegmentId: segment.id,
        sourceKind: 'canonical_segment',
        sourceVersion: row.updated_at,
      });
    }
    return { success: true, entries };
  }

  for (const { row, segment } of canonicalRows) {
    const userId = userByEmployee.get(segment.employeeRecordId);
    if (!userId) continue;
    const slices = splitSegmentAtLocalDayBoundaries(
      segment,
      rangeStart,
      rangeEnd,
      params.referenceTime ? new Date(params.referenceTime) : new Date(),
    );
    for (const [sliceIndex, slice] of slices.entries()) {
      const startType = segment.kind === 'break' ? 'break_start' : 'clock_in';
      const endType = segment.kind === 'break' ? 'break_end' : 'clock_out';
      const common = {
        userId,
        organizationId: segment.organizationId,
        isManual: false,
        jobId: segment.jobId ?? null,
        status: 'approved' as const,
        reviewedBy: null,
        reviewedAt: null,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        activityKind: segment.kind,
        canonicalSegmentId: segment.id,
        sourceKind: 'canonical_segment' as const,
        sourceVersion: row.updated_at,
      };
      entries.push({
        ...common,
        id: `${segment.id}:${sliceIndex}:start`,
        entryType: startType,
        timestamp: slice.startedAt,
      });
      if (slice.endedAt) {
        entries.push({
          ...common,
          id: `${segment.id}:${sliceIndex}:end`,
          entryType: endType,
          timestamp: slice.endedAt,
        });
      }
    }
  }
  return { success: true, entries };
}
