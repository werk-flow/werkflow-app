import 'server-only';

import { createHash } from 'node:crypto';

import type { AdminClient } from '@/lib/supabase/admin';
import type { Json } from '@/lib/supabase/database.types';
import { toJson } from '@/lib/supabase/json';
import { readCompleteRows, readInBatches } from '@/lib/supabase/query-batches';

import { MAX_HANDOVER_SOURCE_ROWS } from './sources';
import type { WorkHandoverTarget } from './types';

// The time and material summaries a handover release freezes. The actions in
// actions.ts establish the handover holder before they load them.

const MAX_HANDOVER_SUMMARY_ROWS = 5_000;
const MATERIAL_SELECTION = 'id, planned_quantity, taken_quantity, returned_quantity, status';

type TimeRow = { id: string; timestamp: string };
type MaterialRow = {
  id: string;
  planned_quantity: number;
  taken_quantity: number;
  returned_quantity: number;
};

async function readTargetJobIds(
  admin: AdminClient,
  organizationId: string,
  target: WorkHandoverTarget,
): Promise<string[]> {
  if (target.targetType === 'job') return [target.targetId];
  const projectJobsResult = await admin
    .from('jobs')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('project_id', target.targetId)
    .limit(MAX_HANDOVER_SOURCE_ROWS + 1);
  if (projectJobsResult.error) throw new Error('work_handover_summary_load_failed');
  if ((projectJobsResult.data?.length ?? 0) > MAX_HANDOVER_SOURCE_ROWS) {
    throw new Error('work_handover_sources_overflow');
  }
  return (projectJobsResult.data ?? []).map((job) => job.id);
}

// Read in pages: `.limit()` alone stops at PostgREST's 1,000 rows without
// an error, so the overflow check below never saw a longer result.
function readSummaryRows(
  admin: AdminClient,
  organizationId: string,
  target: WorkHandoverTarget,
  jobIds: string[],
) {
  return Promise.all([
    readInBatches(jobIds, (batch) =>
      readCompleteRows(
        (from, to) =>
          admin
            .from('time_entries')
            .select('id, timestamp, status')
            .eq('organization_id', organizationId)
            .in('job_id', [...batch])
            .neq('status', 'rejected')
            .neq('status', 'pending_delete')
            .order('timestamp')
            .order('id')
            .range(from, to),
        MAX_HANDOVER_SUMMARY_ROWS,
      ),
    ),
    readCompleteRows(
      (from, to) =>
        admin
          .from('job_material_lines')
          .select(MATERIAL_SELECTION)
          .eq('organization_id', organizationId)
          .eq(target.targetType === 'job' ? 'job_id' : 'project_id', target.targetId)
          .order('id')
          .range(from, to),
      MAX_HANDOVER_SUMMARY_ROWS,
    ),
    ...(target.targetType === 'project'
      ? [
          readInBatches(jobIds, (batch) =>
            readCompleteRows(
              (from, to) =>
                admin
                  .from('job_material_lines')
                  .select(MATERIAL_SELECTION)
                  .eq('organization_id', organizationId)
                  .in('job_id', [...batch])
                  .order('id')
                  .range(from, to),
              MAX_HANDOVER_SUMMARY_ROWS,
            ),
          ),
        ]
      : []),
  ]);
}

function fingerprint(rows: unknown[]): string {
  return createHash('sha256').update(JSON.stringify(rows), 'utf8').digest('hex');
}

function summarize(
  timeRows: TimeRow[],
  materialRows: MaterialRow[],
): { timeSummary: Json; materialSummary: Json } {
  return {
    timeSummary: toJson({
      'Erfasste Buchungen': timeRows.length,
      'Erste Buchung': timeRows.at(0)?.timestamp ?? null,
      'Letzte Buchung': timeRows.at(-1)?.timestamp ?? null,
      Quellenfingerabdruck: fingerprint(timeRows),
      Hinweis: 'Die Vollständigkeit der Zeitsegmente ist in Phase 1 nicht automatisch bewertet.',
    }),
    materialSummary: toJson({
      Materialpositionen: materialRows.length,
      'Geplante Menge': materialRows.reduce((sum, row) => sum + row.planned_quantity, 0),
      'Entnommene Menge': materialRows.reduce((sum, row) => sum + row.taken_quantity, 0),
      'Zurückgegebene Menge': materialRows.reduce((sum, row) => sum + row.returned_quantity, 0),
      Quellenfingerabdruck: fingerprint(materialRows),
      Hinweis: 'Verbrauch und Abrechenbarkeit werden in Phase 1 nicht automatisch bewertet.',
    }),
  };
}

export async function loadFrozenSummaries(
  admin: AdminClient,
  organizationId: string,
  target: WorkHandoverTarget,
): Promise<{ timeSummary: Json; materialSummary: Json }> {
  const jobIds = await readTargetJobIds(admin, organizationId, target);
  const [timeResult, ...materialResults] = await readSummaryRows(admin, organizationId, target, jobIds);
  const summaryError = timeResult.error ?? materialResults.find((result) => result.error)?.error;
  if (summaryError) {
    throw new Error(
      summaryError.code === 'row_overflow'
        ? 'work_handover_summary_overflow'
        : 'work_handover_summary_load_failed',
    );
  }
  if (timeResult.data.length > MAX_HANDOVER_SUMMARY_ROWS) {
    throw new Error('work_handover_summary_overflow');
  }
  // The database order (`timestamp`, then `id`), restored across job batches.
  const timeRows = timeResult.data.toSorted((left, right) =>
    left.timestamp === right.timestamp
      ? left.id < right.id
        ? -1
        : 1
      : left.timestamp < right.timestamp
        ? -1
        : 1,
  );
  const materialRows = [
    ...new Map(materialResults.flatMap((result) => result.data).map((row) => [row.id, row])).values(),
  ].toSorted((left, right) => left.id.localeCompare(right.id));
  if (materialRows.length > MAX_HANDOVER_SUMMARY_ROWS) {
    throw new Error('work_handover_summary_overflow');
  }
  return summarize(timeRows, materialRows);
}
