import { z } from '@/lib/zod';
import { addLocalDays, splitTimedIntervalByBerlinDate } from '@/lib/date-time/berlin';
import { DEFAULT_DAILY_TARGET_MINUTES, type DailyTarget } from '@/lib/personnel/targets';
import { evaluateCapacity } from './capacity';
import type { DailyTargetsByRecord } from './server';
import type {
  CapacityDayContext,
  CapacityEvaluation,
  MaterializedOccurrence,
  PlanningAssignmentDraft,
  PlanningConflict,
} from './types';

export const assignedOccurrenceRowsSchema = z.array(
  z.object({
    id: z.string(),
    time_kind: z.enum(['timed', 'all_day']),
    start_at: z.string().nullable(),
    end_at: z.string().nullable(),
    start_date: z.string().nullable(),
    end_date_exclusive: z.string().nullable(),
    assigned: z.array(z.object({ employee_record_id: z.string() })),
  }),
);

type AssignedOccurrenceRow = z.infer<typeof assignedOccurrenceRowsSchema>[number];
export type AssignmentsForOccurrence = (occurrence: MaterializedOccurrence) => PlanningAssignmentDraft[];
type TimedInterval = { start: number; end: number };

function enumerateOccurrenceAllocations(
  occurrence: MaterializedOccurrence,
  employeeRecordIds: string[],
  targetByEmployeeDate: Map<string, DailyTarget>,
): Array<{ employeeRecordId: string; localDate: string; minutes: number }> {
  if (occurrence.timeKind === 'timed' && occurrence.startAt && occurrence.endAt) {
    const startAt = occurrence.startAt;
    const endAt = occurrence.endAt;
    return employeeRecordIds.flatMap((employeeRecordId) =>
      splitTimedIntervalByBerlinDate(new Date(startAt), new Date(endAt)).map((allocation) => ({
        employeeRecordId,
        ...allocation,
      })),
    );
  }
  if (!occurrence.startDate || !occurrence.endDateExclusive) return [];
  const allocations: Array<{
    employeeRecordId: string;
    localDate: string;
    minutes: number;
  }> = [];
  for (let date = occurrence.startDate; date < occurrence.endDateExclusive; date = addLocalDays(date, 1)) {
    for (const employeeRecordId of employeeRecordIds) {
      allocations.push({
        employeeRecordId,
        localDate: date,
        minutes:
          targetByEmployeeDate.get(`${employeeRecordId}:${date}`)?.targetMinutes ??
          DEFAULT_DAILY_TARGET_MINUTES,
      });
    }
  }
  return allocations;
}

export function collectAssessedOccurrenceDates(occurrences: MaterializedOccurrence[]): string[] {
  return occurrences.flatMap((occurrence) => {
    if (occurrence.timeKind === 'timed' && occurrence.startAt && occurrence.endAt) {
      return splitTimedIntervalByBerlinDate(new Date(occurrence.startAt), new Date(occurrence.endAt)).map(
        (allocation) => allocation.localDate,
      );
    }
    if (!occurrence.startDate || !occurrence.endDateExclusive) return [];
    const dates: string[] = [];
    for (let date = occurrence.startDate; date < occurrence.endDateExclusive; date = addLocalDays(date, 1)) {
      dates.push(date);
    }
    return dates;
  });
}

function collectProposedPlanningIntervals(
  occurrences: MaterializedOccurrence[],
  assignmentsFor: AssignmentsForOccurrence,
): {
  proposedTimedByEmployee: Map<string, TimedInterval[]>;
  proposedAllDayEmployeeDates: Set<string>;
} {
  const proposedTimedByEmployee = new Map<string, TimedInterval[]>();
  const proposedAllDayEmployeeDates = new Set<string>();
  for (const occurrence of occurrences) {
    if (occurrence.startAt && occurrence.endAt) {
      for (const assignment of assignmentsFor(occurrence)) {
        const intervals = proposedTimedByEmployee.get(assignment.employeeRecordId) ?? [];
        intervals.push({
          start: new Date(occurrence.startAt).getTime(),
          end: new Date(occurrence.endAt).getTime(),
        });
        proposedTimedByEmployee.set(assignment.employeeRecordId, intervals);
      }
      continue;
    }
    if (!occurrence.startDate || !occurrence.endDateExclusive) continue;
    for (let date = occurrence.startDate; date < occurrence.endDateExclusive; date = addLocalDays(date, 1)) {
      for (const assignment of assignmentsFor(occurrence)) {
        proposedAllDayEmployeeDates.add(`${assignment.employeeRecordId}:${date}`);
      }
    }
  }
  return { proposedTimedByEmployee, proposedAllDayEmployeeDates };
}

function accumulateExistingPlanningLoad(input: {
  existingRows: AssignedOccurrenceRow[];
  excludedOccurrenceIds: Set<string>;
  employeeRecordIds: string[];
  proposedAllDayEmployeeDates: Set<string>;
  targetByEmployeeDate: Map<string, DailyTarget>;
  existingMinutes: Map<string, number>;
  overlaps: Map<string, number>;
}): Map<string, TimedInterval[]> {
  const { proposedAllDayEmployeeDates, targetByEmployeeDate, existingMinutes, overlaps } = input;
  // An occurrence shared by people of two id batches arrives once per batch:
  // keep one row and the union of its assessed people.
  const assessedRecordIds = new Set(input.employeeRecordIds);
  const existingOccurrenceById = new Map<string, AssignedOccurrenceRow>();
  const assignedRecordsByOccurrence = new Map<string, Set<string>>();
  for (const occurrence of input.existingRows) {
    if (input.excludedOccurrenceIds.has(occurrence.id)) continue;
    existingOccurrenceById.set(occurrence.id, occurrence);
    const records = assignedRecordsByOccurrence.get(occurrence.id) ?? new Set<string>();
    for (const assignment of occurrence.assigned) {
      if (assessedRecordIds.has(assignment.employee_record_id)) records.add(assignment.employee_record_id);
    }
    assignedRecordsByOccurrence.set(occurrence.id, records);
  }
  const existingOccurrences = [...existingOccurrenceById.values()];
  const existingTimedByEmployee = new Map<string, TimedInterval[]>();
  for (const existing of existingOccurrences) {
    const records = assignedRecordsByOccurrence.get(existing.id) ?? [];
    if (existing.time_kind === 'timed' && existing.start_at && existing.end_at) {
      const allocations = splitTimedIntervalByBerlinDate(
        new Date(existing.start_at),
        new Date(existing.end_at),
      );
      for (const employeeRecordId of records) {
        for (const allocation of allocations) {
          const key = `${employeeRecordId}:${allocation.localDate}`;
          existingMinutes.set(key, (existingMinutes.get(key) ?? 0) + allocation.minutes);
          if (proposedAllDayEmployeeDates.has(key)) {
            overlaps.set(key, (overlaps.get(key) ?? 0) + allocation.minutes);
          }
        }
        const intervals = existingTimedByEmployee.get(employeeRecordId) ?? [];
        intervals.push({
          start: new Date(existing.start_at).getTime(),
          end: new Date(existing.end_at).getTime(),
        });
        existingTimedByEmployee.set(employeeRecordId, intervals);
      }
    } else if (existing.start_date && existing.end_date_exclusive) {
      for (let date = existing.start_date; date < existing.end_date_exclusive; date = addLocalDays(date, 1)) {
        for (const employeeRecordId of records) {
          const key = `${employeeRecordId}:${date}`;
          existingMinutes.set(
            key,
            (existingMinutes.get(key) ?? 0) +
              (targetByEmployeeDate.get(key)?.targetMinutes ?? DEFAULT_DAILY_TARGET_MINUTES),
          );
          overlaps.set(
            key,
            (overlaps.get(key) ?? 0) +
              Math.max(1, targetByEmployeeDate.get(key)?.targetMinutes ?? DEFAULT_DAILY_TARGET_MINUTES),
          );
        }
      }
    }
  }
  return existingTimedByEmployee;
}

function addTimedProposalOverlaps(
  existingTimedByEmployee: Map<string, TimedInterval[]>,
  proposedTimedByEmployee: Map<string, TimedInterval[]>,
  overlaps: Map<string, number>,
): void {
  for (const [employeeRecordId, existingIntervals] of existingTimedByEmployee) {
    const proposedIntervals = proposedTimedByEmployee.get(employeeRecordId);
    if (!proposedIntervals?.length) continue;
    existingIntervals.sort((left, right) => left.start - right.start);
    proposedIntervals.sort((left, right) => left.start - right.start);
    let proposedCursor = 0;
    let activeProposals: TimedInterval[] = [];
    for (const existing of existingIntervals) {
      activeProposals = activeProposals.filter((proposed) => proposed.end > existing.start);
      let proposed = proposedIntervals[proposedCursor];
      while (proposed && proposed.start < existing.end) {
        if (proposed.end > existing.start) activeProposals.push(proposed);
        proposedCursor += 1;
        proposed = proposedIntervals[proposedCursor];
      }
      for (const proposed of activeProposals) {
        const overlapStart = new Date(Math.max(existing.start, proposed.start));
        const overlapEnd = new Date(Math.min(existing.end, proposed.end));
        for (const allocation of splitTimedIntervalByBerlinDate(overlapStart, overlapEnd)) {
          const key = `${employeeRecordId}:${allocation.localDate}`;
          overlaps.set(key, (overlaps.get(key) ?? 0) + allocation.minutes);
        }
      }
    }
  }
}

function buildCapacityDayContexts(input: {
  employeeRecordIds: string[];
  uniqueDates: string[];
  proposedKeys: Set<string>;
  targetByEmployeeDate: Map<string, DailyTarget>;
  pendingVacation: DailyTargetsByRecord['pendingVacation'];
  existingMinutes: Map<string, number>;
  overlaps: Map<string, number>;
}): { contexts: CapacityDayContext[]; missingConfigurationConflicts: PlanningConflict[] } {
  const { targetByEmployeeDate, pendingVacation, existingMinutes, overlaps } = input;
  const contexts: CapacityDayContext[] = [];
  const missingConfigurationConflicts: PlanningConflict[] = [];
  for (const employeeRecordId of input.employeeRecordIds) {
    for (const date of input.uniqueDates) {
      const key = `${employeeRecordId}:${date}`;
      if (!input.proposedKeys.has(key)) continue;
      const target = targetByEmployeeDate.get(key);
      if (!target) continue;
      const pending = pendingVacation.filter(
        (request) =>
          request.employee_record_id === employeeRecordId &&
          request.start_date <= date &&
          date <= request.end_date,
      );
      if (target.source === 'default') {
        missingConfigurationConflicts.push({
          kind: 'no_schedule',
          severity: 'warning',
          employeeRecordId,
          localDate: date,
          message:
            'Für diese Person gilt nur der gekennzeichnete Standardwert, weil kein Arbeitszeitmodell hinterlegt ist.',
          details: { fallbackMinutes: target.baseTargetMinutes },
        });
      }
      contexts.push({
        employeeRecordId,
        localDate: date,
        targetMinutes: target.isHoliday || target.isClosureDay ? 0 : target.baseTargetMinutes,
        targetSource: target.isClosureDay ? 'closure' : target.isHoliday ? 'holiday' : target.source,
        approvedAbsenceMinutes: Math.max(0, target.baseTargetMinutes - target.targetMinutes),
        pendingAbsenceMinutes: pending.reduce(
          (minutes, request) =>
            Math.max(
              minutes,
              request.day_portion === 'full'
                ? target.baseTargetMinutes
                : Math.round(target.baseTargetMinutes / 2),
            ),
          0,
        ),
        existingPlannedMinutes: existingMinutes.get(key) ?? 0,
        overlapMinutes: overlaps.get(key) ?? 0,
      });
    }
  }
  return { contexts, missingConfigurationConflicts };
}

export function buildQualificationAssessmentRequests(
  occurrences: MaterializedOccurrence[],
  assignmentsFor: AssignmentsForOccurrence,
): Array<{ localDate: string; employeeRecordIds: string[] }> {
  return occurrences.flatMap((occurrence) => {
    const employeeIds = assignmentsFor(occurrence).map((assignment) => assignment.employeeRecordId);
    if (!employeeIds.length) return [];
    const localDates =
      occurrence.timeKind === 'timed' && occurrence.startAt && occurrence.endAt
        ? splitTimedIntervalByBerlinDate(new Date(occurrence.startAt), new Date(occurrence.endAt)).map(
            (allocation) => allocation.localDate,
          )
        : occurrence.startDate && occurrence.endDateExclusive
          ? (() => {
              const dates: string[] = [];
              for (
                let date = occurrence.startDate;
                date < occurrence.endDateExclusive;
                date = addLocalDays(date, 1)
              ) {
                dates.push(date);
              }
              return dates;
            })()
          : [];
    return [...new Set(localDates)].map((localDate) => ({
      localDate,
      employeeRecordIds: employeeIds,
    }));
  });
}

/**
 * The capacity warnings of the proposed occurrences against what the assessed
 * people already have planned, excluding the occurrences the change replaces.
 */
export function evaluateProposedCapacity(input: {
  occurrences: MaterializedOccurrence[];
  assignmentsFor: AssignmentsForOccurrence;
  existingRows: AssignedOccurrenceRow[];
  excludedOccurrenceIds: Set<string>;
  employeeRecordIds: string[];
  uniqueDates: string[];
  targets: DailyTargetsByRecord;
}): CapacityEvaluation {
  const { occurrences, assignmentsFor, employeeRecordIds } = input;
  const { targetByEmployeeDate, pendingVacation } = input.targets;
  const existingMinutes = new Map<string, number>();
  const overlaps = new Map<string, number>();
  const { proposedTimedByEmployee, proposedAllDayEmployeeDates } = collectProposedPlanningIntervals(
    occurrences,
    assignmentsFor,
  );
  const existingTimedByEmployee = accumulateExistingPlanningLoad({
    existingRows: input.existingRows,
    excludedOccurrenceIds: input.excludedOccurrenceIds,
    employeeRecordIds,
    proposedAllDayEmployeeDates,
    targetByEmployeeDate,
    existingMinutes,
    overlaps,
  });
  addTimedProposalOverlaps(existingTimedByEmployee, proposedTimedByEmployee, overlaps);

  const proposed = occurrences.flatMap((occurrence) =>
    enumerateOccurrenceAllocations(
      occurrence,
      assignmentsFor(occurrence).map((assignment) => assignment.employeeRecordId),
      targetByEmployeeDate,
    ),
  );
  const proposedKeys = new Set(
    proposed.map((allocation) => `${allocation.employeeRecordId}:${allocation.localDate}`),
  );
  const { contexts, missingConfigurationConflicts } = buildCapacityDayContexts({
    employeeRecordIds,
    uniqueDates: input.uniqueDates,
    proposedKeys,
    targetByEmployeeDate,
    pendingVacation,
    existingMinutes,
    overlaps,
  });
  const capacity = evaluateCapacity(proposed, contexts);
  capacity.conflicts.unshift(...missingConfigurationConflicts);
  return capacity;
}
