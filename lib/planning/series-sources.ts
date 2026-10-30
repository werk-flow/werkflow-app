import 'server-only';

import type { ActionFailure } from '@/lib/action-result';
import { logError } from '@/lib/logging';
import type { AdminClient } from '@/lib/supabase/admin';
import type { Tables } from '@/lib/supabase/database.types';
import { LIST_ROW_CAP, readCompleteRows } from '@/lib/supabase/query-batches';

type SeriesRow = Tables<'planning_series'>;
type OccurrenceRow = Tables<'planning_occurrences'>;
type RescheduleSelection = Pick<
  OccurrenceRow,
  | 'id'
  | 'series_id'
  | 'series_lineage_id'
  | 'original_start_local'
  | 'job_id'
  | 'time_kind'
  | 'start_at'
  | 'end_at'
  | 'start_date'
  | 'end_date_exclusive'
  | 'version'
>;
type LineageOccurrence = Pick<
  OccurrenceRow,
  'id' | 'series_id' | 'original_start_local' | 'start_at' | 'start_date' | 'status' | 'is_exception'
>;

/** The series a horizon extension continues, and its latest regular occurrence, whose assignments it copies. */
export async function loadSeriesExtensionSource(
  admin: AdminClient,
  orgId: string,
  seriesId: string,
): Promise<
  | { success: true; series: SeriesRow; generatedThroughLocal: string; sourceOccurrenceId: string }
  | ActionFailure<'series_not_found' | 'series_not_materialized'>
> {
  const { data: series, error: seriesError } = await admin
    .from('planning_series')
    .select('*')
    .eq('organization_id', orgId)
    .eq('id', seriesId)
    .single();
  if (seriesError || !series) {
    return { success: false, error: 'series_not_found' };
  }
  if (!series.generated_through_local) {
    return { success: false, error: 'series_not_materialized' };
  }

  const { data: sourceOccurrence, error: sourceError } = await admin
    .from('planning_occurrences')
    .select('id')
    .eq('organization_id', orgId)
    .eq('series_id', series.id)
    .eq('is_exception', false)
    .order('original_start_local', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (sourceError || !sourceOccurrence) {
    return { success: false, error: 'series_not_materialized' };
  }
  return {
    success: true,
    series,
    generatedThroughLocal: series.generated_through_local,
    sourceOccurrenceId: sourceOccurrence.id,
  };
}

/** The selected occurrence, its series and the series lineage a reschedule starts from. */
export async function loadRescheduleSource(
  admin: AdminClient,
  orgId: string,
  occurrenceId: string,
): Promise<
  | {
      success: true;
      selected: RescheduleSelection;
      selectedOriginalStartLocal: string;
      series: SeriesRow;
      lineageOccurrences: LineageOccurrence[];
    }
  | ActionFailure<'series_not_found' | 'invalid_occurrence' | 'load_failed'>
> {
  const { data: selected, error: selectedError } = await admin
    .from('planning_occurrences')
    .select(
      'id, series_id, series_lineage_id, original_start_local, job_id, time_kind, start_at, end_at, start_date, end_date_exclusive, version',
    )
    .eq('organization_id', orgId)
    .eq('id', occurrenceId)
    .single();
  if (
    selectedError ||
    !selected?.series_id ||
    !selected.series_lineage_id ||
    !selected.original_start_local
  ) {
    return { success: false as const, error: 'series_not_found' };
  }
  if (!selected.start_at && !selected.start_date) {
    return { success: false as const, error: 'invalid_occurrence' };
  }
  const { data: series, error: seriesError } = await admin
    .from('planning_series')
    .select('*')
    .eq('organization_id', orgId)
    .eq('id', selected.series_id)
    .single();
  if (seriesError || !series) {
    return { success: false as const, error: 'series_not_found' };
  }
  const seriesLineageId = selected.series_lineage_id;
  const { data: lineageOccurrences, error: lineageError } = await readCompleteRows(
    (from, to) =>
      admin
        .from('planning_occurrences')
        .select('id, series_id, original_start_local, start_at, start_date, status, is_exception')
        .eq('organization_id', orgId)
        .eq('series_lineage_id', seriesLineageId)
        .not('original_start_local', 'is', null)
        .order('original_start_local', { ascending: true })
        .order('id')
        .range(from, to),
    LIST_ROW_CAP,
  );
  if (lineageError) {
    logError('Failed to load the series lineage', lineageError);
    return { success: false as const, error: 'load_failed' };
  }
  return {
    success: true as const,
    selected,
    selectedOriginalStartLocal: selected.original_start_local,
    series,
    lineageOccurrences: lineageOccurrences ?? [],
  };
}
