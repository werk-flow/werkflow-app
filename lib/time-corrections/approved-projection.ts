import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/database.types';
import { LIST_ROW_CAP, readCompleteRows, readInBatches } from '@/lib/supabase/query-batches';
import { isTimeCorrectionSnapshot, type TimeCorrectionSource, type TimeCorrectionApplicationProjection } from './types';

/** Called only after the action establishes membership and the effective subject. */
export async function loadApprovedCorrectionProjection(
  admin: SupabaseClient<Database>,
  input: { organizationId: string; userId?: string | undefined },
): Promise<TimeCorrectionApplicationProjection[]> {
  const requests = await readCompleteRows((from, to) => {
    let query = admin.from('time_correction_requests').select('id')
      .eq('organization_id', input.organizationId).eq('status', 'approved').order('id').range(from, to);
    if (input.userId) query = query.eq('subject_user_id', input.userId);
    return query;
  }, LIST_ROW_CAP);
  if (requests.error) throw new Error('Approved time correction requests could not be read completely.');
  if (!requests.data.length) return [];
  const requestIds = requests.data.map((request) => request.id);
  const [applications, sources] = await Promise.all([
    readInBatches(requestIds, (batch) => readCompleteRows((from, to) => admin.from('time_correction_applications').select('*')
      .eq('organization_id', input.organizationId).in('request_id', [...batch]).order('id').range(from, to), LIST_ROW_CAP)),
    readInBatches(requestIds, (batch) => readCompleteRows((from, to) => admin.from('time_correction_request_sources').select('*')
      .eq('organization_id', input.organizationId).in('request_id', [...batch])
      .order('request_id').order('revision').order('ordinal').range(from, to), LIST_ROW_CAP)),
  ]);
  if (applications.error || sources.error || applications.data.length > LIST_ROW_CAP || sources.data.length > LIST_ROW_CAP) {
    throw new Error('Approved time correction history could not be read completely.');
  }
  const sourcesByRevision = new Map<string, TimeCorrectionSource[]>();
  for (const source of sources.data) {
    const sourceId = source.time_entry_id ?? source.time_session_id ?? source.time_segment_id ?? source.correction_application_id;
    if (!sourceId) throw new Error('Approved time correction source is invalid.');
    const key = `${source.request_id}:${source.revision}`;
    const list = sourcesByRevision.get(key) ?? [];
    list.push({ kind: source.source_kind, id: sourceId, version: source.source_version });
    sourcesByRevision.set(key, list);
  }
  return applications.data.map((application) => {
    if (!isTimeCorrectionSnapshot(application.applied_snapshot)) throw new Error('Approved time correction snapshot is invalid.');
    return {
      applicationId: application.id, requestId: application.request_id, appliedAt: application.applied_at,
      appliedBy: application.applied_by, sourceFingerprint: application.source_fingerprint,
      snapshot: application.applied_snapshot,
      sources: sourcesByRevision.get(`${application.request_id}:${application.revision}`) ?? [],
    };
  });
}
