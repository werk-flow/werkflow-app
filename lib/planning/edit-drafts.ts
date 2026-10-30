import type { ActionFailure } from '@/lib/action-result';
import {
  addLocalDays,
  addLocalMonthsClamped,
  BERLIN_TIME_ZONE,
  formatBerlinLocalDateTime,
  resolveBerlinWallTime,
} from '@/lib/date-time/berlin';
import type { Tables } from '@/lib/supabase/database.types';
import { constrainedValue } from '@/lib/validation/constrained-value';
import { materializeSeries } from './recurrence';
import type { ParsedPlanningCalendarInput } from './schemas';
import {
  RECURRENCE_FREQUENCIES,
  type MaterializedOccurrence,
  type PlanningAssignmentDraft,
  type PlanningSeriesDraft,
} from './types';

type SeriesRow = Tables<'planning_series'>;
type OccurrenceRow = Tables<'planning_occurrences'>;
type EditedOccurrence = Pick<
  OccurrenceRow,
  'time_kind' | 'start_at' | 'end_at' | 'start_date' | 'end_date_exclusive' | 'original_start_local'
>;
type RescheduleSelectedOccurrence = Pick<
  OccurrenceRow,
  'time_kind' | 'start_at' | 'end_at' | 'start_date' | 'end_date_exclusive'
>;
type LineageOccurrence = Pick<
  OccurrenceRow,
  'id' | 'original_start_local' | 'start_at' | 'start_date' | 'is_exception'
>;

/** The series row as the draft its occurrences materialize from. */
function seriesDraftFromRow(series: SeriesRow): PlanningSeriesDraft {
  return {
    entryKind: series.entry_kind,
    internalType: series.internal_type,
    jobId: series.job_id,
    title: series.title,
    description: series.description,
    location: series.location,
    timeKind: series.time_kind,
    startsAtLocal: series.starts_at_local,
    durationMinutes: series.duration_minutes,
    durationDays: series.duration_days,
    timezone: BERLIN_TIME_ZONE,
    frequency: constrainedValue(RECURRENCE_FREQUENCIES, series.recurrence_frequency, 'recurrence_frequency'),
    interval: series.recurrence_interval,
    weekdays: series.weekdays,
    monthDay: series.month_day,
    occurrenceCount: series.occurrence_count,
    untilLocalDate: series.until_local_date,
  };
}

/** The occurrences six more months of the series segment add after `generatedThroughLocal`. */
export function seriesExtensionOccurrences(
  series: SeriesRow,
  generatedThroughLocal: string,
): MaterializedOccurrence[] {
  const horizon = addLocalMonthsClamped(generatedThroughLocal.slice(0, 10), 6);
  return materializeSeries(seriesDraftFromRow(series), horizon).filter(
    (occurrence) =>
      occurrence.originalStartLocal > generatedThroughLocal &&
      occurrence.originalStartLocal >= series.segment_start_local &&
      (!series.segment_end_before_local || occurrence.originalStartLocal < series.segment_end_before_local),
  );
}

/** The occurrence an edit moves or resizes, or the failure code of an unusable edit. */
export function materializeOccurrenceEdit(
  occurrence: EditedOccurrence,
  input: ParsedPlanningCalendarInput,
):
  | { success: true; materialized: MaterializedOccurrence }
  | ActionFailure<'invalid_occurrence' | 'invalid_input'> {
  if (occurrence.time_kind === 'timed') {
    if (!occurrence.start_at || !occurrence.end_at) {
      return { success: false as const, error: 'invalid_occurrence' };
    }
    const currentLocal = formatBerlinLocalDateTime(occurrence.start_at);
    const date = input.plannedDate ?? currentLocal.slice(0, 10);
    const time = input.plannedTime ?? currentLocal.slice(11, 16);
    const resolved = resolveBerlinWallTime(`${date}T${time}`);
    if (!resolved) return { success: false as const, error: 'invalid_input' };
    const durationMinutes =
      input.estimatedDurationMinutes ??
      Math.round((new Date(occurrence.end_at).getTime() - new Date(occurrence.start_at).getTime()) / 60_000);
    return {
      success: true,
      materialized: {
        originalStartLocal: occurrence.original_start_local ?? `${date}T${time}`,
        timeKind: 'timed',
        startAt: resolved.instant.toISOString(),
        endAt: new Date(resolved.instant.getTime() + durationMinutes * 60_000).toISOString(),
        startDate: null,
        endDateExclusive: null,
        dstResolution: resolved.resolution,
      },
    };
  }
  if (!occurrence.start_date || !occurrence.end_date_exclusive) {
    return { success: false as const, error: 'invalid_occurrence' };
  }
  const durationDays =
    input.durationDays ??
    Math.round(
      (new Date(`${occurrence.end_date_exclusive}T00:00:00Z`).getTime() -
        new Date(`${occurrence.start_date}T00:00:00Z`).getTime()) /
        86_400_000,
    );
  const startDate = input.plannedDate ?? occurrence.start_date;
  return {
    success: true,
    materialized: {
      originalStartLocal: occurrence.original_start_local ?? `${startDate}T00:00`,
      timeKind: 'all_day',
      startAt: null,
      endAt: null,
      startDate,
      endDateExclusive: new Date(new Date(`${startDate}T00:00:00Z`).getTime() + durationDays * 86_400_000)
        .toISOString()
        .slice(0, 10),
      dstResolution: 'exact',
    },
  };
}

function buildRescheduledSeriesDraft(input: {
  series: SeriesRow;
  selected: RescheduleSelectedOccurrence;
  request: ParsedPlanningCalendarInput;
  startsAtLocal: string;
  remainingOccurrenceCount: number | null;
}): PlanningSeriesDraft {
  const { series, selected, startsAtLocal, remainingOccurrenceCount } = input;
  const existingDurationMinutes =
    selected.start_at && selected.end_at
      ? Math.round((new Date(selected.end_at).getTime() - new Date(selected.start_at).getTime()) / 60_000)
      : null;
  const existingDurationDays =
    selected.start_date && selected.end_date_exclusive
      ? Math.round(
          (new Date(`${selected.end_date_exclusive}T00:00:00Z`).getTime() -
            new Date(`${selected.start_date}T00:00:00Z`).getTime()) /
            86_400_000,
        )
      : null;
  return {
    ...seriesDraftFromRow(series),
    startsAtLocal,
    durationMinutes:
      series.time_kind === 'timed'
        ? (input.request.estimatedDurationMinutes ?? existingDurationMinutes ?? series.duration_minutes)
        : null,
    durationDays:
      series.time_kind === 'all_day'
        ? (input.request.durationDays ?? existingDurationDays ?? series.duration_days)
        : null,
    occurrenceCount: remainingOccurrenceCount,
  };
}

type PlannedSeriesReschedule = {
  success: true;
  /** The ids of the lineage occurrences the reschedule replaces. */
  replacedOccurrenceIds: string[];
  /** The original starts the regenerated occurrences keep, in order. */
  identityOriginals: string[];
  draft: PlanningSeriesDraft;
  generated: MaterializedOccurrence[];
};
type SeriesReschedulePlan =
  | PlannedSeriesReschedule
  | ActionFailure<'no_mutable_occurrences' | 'invalid_recurrence'>;

/**
 * The reschedule of a series from the selected occurrence: the lineage occurrences still in the
 * future (all of them, or those from the selection on), shifted by the selection's move.
 */
export function planSeriesReschedule(input: {
  series: SeriesRow;
  selected: RescheduleSelectedOccurrence;
  selectedOriginalStartLocal: string;
  lineageOccurrences: LineageOccurrence[];
  scope: 'future' | 'series';
  request: ParsedPlanningCalendarInput;
  now: number;
  today: string;
}): SeriesReschedulePlan {
  const { series, selected, lineageOccurrences, request } = input;
  const mutable = lineageOccurrences.filter((occurrence) => {
    if (!occurrence.original_start_local || occurrence.is_exception) return false;
    if (input.scope === 'future' && occurrence.original_start_local < input.selectedOriginalStartLocal) {
      return false;
    }
    return occurrence.start_at
      ? new Date(occurrence.start_at).getTime() > input.now
      : Boolean(occurrence.start_date && occurrence.start_date > input.today);
  });
  if (mutable.length === 0) {
    return { success: false as const, error: 'no_mutable_occurrences' };
  }
  const identityOriginals = mutable.flatMap((occurrence) =>
    occurrence.original_start_local ? [occurrence.original_start_local] : [],
  );
  const selectedCurrentLocal = selected.start_at
    ? formatBerlinLocalDateTime(selected.start_at)
    : `${selected.start_date}T00:00`;
  const requestedDate = request.plannedDate ?? selectedCurrentLocal.slice(0, 10);
  const requestedTime =
    selected.time_kind === 'timed' ? (request.plannedTime ?? selectedCurrentLocal.slice(11, 16)) : '00:00';
  const dayShift = Math.round(
    (new Date(`${requestedDate}T00:00:00Z`).getTime() -
      new Date(`${selectedCurrentLocal.slice(0, 10)}T00:00:00Z`).getTime()) /
      86_400_000,
  );
  const boundaryOriginal = identityOriginals[0];
  if (boundaryOriginal === undefined) {
    return { success: false as const, error: 'no_mutable_occurrences' };
  }
  const positionsBeforeBoundary = lineageOccurrences.filter(
    (occurrence) => occurrence.original_start_local && occurrence.original_start_local < boundaryOriginal,
  ).length;
  const remainingOccurrenceCount = series.occurrence_count
    ? Math.max(identityOriginals.length, series.occurrence_count - positionsBeforeBoundary)
    : null;
  const startsAtLocal = `${addLocalDays(boundaryOriginal.slice(0, 10), dayShift)}T${requestedTime}`;
  const draft = buildRescheduledSeriesDraft({
    series,
    selected,
    request,
    startsAtLocal,
    remainingOccurrenceCount,
  });
  const horizon = addLocalMonthsClamped(startsAtLocal.slice(0, 10), 18);
  const generated = materializeSeries(draft, horizon).slice(0, identityOriginals.length);
  if (generated.length !== identityOriginals.length) {
    return { success: false as const, error: 'invalid_recurrence' };
  }
  return {
    success: true,
    replacedOccurrenceIds: mutable.map((occurrence) => occurrence.id),
    identityOriginals,
    draft,
    generated,
  };
}

/** The regenerated occurrences, each under the original start it replaces, and their assignments. */
export function seriesReschedulePayload(
  plan: PlannedSeriesReschedule,
  assignmentsByOriginalStartLocal: ReadonlyMap<string, PlanningAssignmentDraft[]>,
): {
  occurrences: Array<MaterializedOccurrence & { identityOriginalStartLocal: string }>;
  assignments: Array<PlanningAssignmentDraft & { occurrenceOriginalStartLocal: string }>;
} {
  const occurrences = plan.generated.map((occurrence, index) => ({
    ...occurrence,
    identityOriginalStartLocal: plan.identityOriginals[index] ?? occurrence.originalStartLocal,
  }));
  const assignments = occurrences.flatMap((occurrence) =>
    (assignmentsByOriginalStartLocal.get(occurrence.originalStartLocal) ?? []).map((assignment) => ({
      ...assignment,
      occurrenceOriginalStartLocal: occurrence.identityOriginalStartLocal,
    })),
  );
  return { occurrences, assignments };
}
