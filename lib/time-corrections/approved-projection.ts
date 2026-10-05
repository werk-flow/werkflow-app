import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/database.types';
import { LIST_ROW_CAP, readCompleteRows, readInBatches } from '@/lib/supabase/query-batches';
import {
  isTimeCorrectionSnapshot,
  type TimeCorrectionSource,
  type TimeCorrectionApplicationProjection,
} from './types';

/** Server-internal organization history. Callers authorize first and filter effective facts before returning data.
 * Subject filtering here loses corrections reassigned to another employee. */
export async function loadApprovedCorrectionProjection(
  admin: SupabaseClient<Database>,
  input: { organizationId: string; userIds?: string[]; from?: string; to?: string },
): Promise<TimeCorrectionApplicationProjection[]> {
  const applications = await readCompleteRows(
    (from, to) =>
      admin
        .rpc('read_time_correction_applications', {
          p_organization_id: input.organizationId,
          ...(input.userIds ? { p_user_ids: input.userIds } : {}),
          ...(input.from ? { p_from: input.from } : {}),
          ...(input.to ? { p_to: input.to } : {}),
        })
        .order('id')
        .range(from, to),
    LIST_ROW_CAP,
  );
  if (applications.error) throw new Error('Approved time correction history could not be read completely.');
  if (!applications.data.length) return [];
  const requestIds = applications.data.map((application) => application.request_id);
  const sources = await readInBatches(requestIds, (batch) =>
    readCompleteRows(
      (from, to) =>
        admin
          .from('time_correction_request_sources')
          .select('*')
          .eq('organization_id', input.organizationId)
          .in('request_id', [...batch])
          .order('request_id')
          .order('revision')
          .order('ordinal')
          .range(from, to),
      LIST_ROW_CAP,
    ),
  );
  if (sources.error || sources.data.length > LIST_ROW_CAP)
    throw new Error('Approved time correction history could not be read completely.');
  const sourcesByRevision = new Map<string, TimeCorrectionSource[]>();
  for (const source of sources.data) {
    const sourceId =
      source.time_entry_id ??
      source.time_session_id ??
      source.time_segment_id ??
      source.correction_application_id;
    if (!sourceId) throw new Error('Approved time correction source is invalid.');
    const key = `${source.request_id}:${source.revision}`;
    const list = sourcesByRevision.get(key) ?? [];
    list.push({ kind: source.source_kind, id: sourceId, version: source.source_version });
    sourcesByRevision.set(key, list);
  }
  return applications.data.map((application) => {
    if (!isTimeCorrectionSnapshot(application.applied_snapshot))
      throw new Error('Approved time correction snapshot is invalid.');
    return {
      applicationId: application.id,
      requestId: application.request_id,
      appliedAt: application.applied_at,
      appliedBy: application.applied_by,
      sourceFingerprint: application.source_fingerprint,
      snapshot: application.applied_snapshot,
      sources: sourcesByRevision.get(`${application.request_id}:${application.revision}`) ?? [],
    };
  });
}
