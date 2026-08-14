// Pure batch-reschedule math: shift explicitly selected occurrences by whole
// Berlin days (optionally with one new start time). The RPC re-validates and
// applies all-or-nothing; this module only computes the target schedule.

import {
  addLocalDays,
  formatBerlinLocalDateTime,
  resolveBerlinWallTime,
} from '@/lib/planning/date-time';
import type { DstResolution } from '@/lib/planning/types';

export type BatchSourceOccurrence = {
  occurrenceId: string;
  version: number;
  timeKind: 'timed' | 'all_day';
  startAt: string | null;
  endAt: string | null;
  startDate: string | null;
  endDateExclusive: string | null;
};

export type BatchShiftInput = {
  dayShift: number;
  /** Optional uniform new start time (HH:MM) for timed occurrences. */
  newTime: string | null;
};

export type BatchShiftItem = {
  occurrenceId: string;
  expectedVersion: number;
  startAt: string | null;
  endAt: string | null;
  startDate: string | null;
  endDateExclusive: string | null;
  dstResolution: DstResolution;
};

export type BatchShiftResult =
  | { success: true; items: BatchShiftItem[] }
  | { success: false; error: string; occurrenceId: string | null };

export function computeBatchShiftItems(
  sources: BatchSourceOccurrence[],
  shift: BatchShiftInput
): BatchShiftResult {
  if (!Number.isInteger(shift.dayShift) || Math.abs(shift.dayShift) > 366) {
    return { success: false, error: 'batch_shift_invalid', occurrenceId: null };
  }
  if (shift.newTime !== null && !/^([01]\d|2[0-3]):[0-5]\d$/.test(shift.newTime)) {
    return { success: false, error: 'batch_shift_invalid', occurrenceId: null };
  }
  if (shift.dayShift === 0 && shift.newTime === null) {
    return { success: false, error: 'batch_shift_noop', occurrenceId: null };
  }

  const items: BatchShiftItem[] = [];
  for (const source of sources) {
    if (source.timeKind === 'timed') {
      if (
        !source.startAt ||
        !source.endAt ||
        new Date(source.endAt).getTime() <= new Date(source.startAt).getTime()
      ) {
        return {
          success: false,
          error: 'batch_item_invalid',
          occurrenceId: source.occurrenceId,
        };
      }
      const currentLocal = formatBerlinLocalDateTime(source.startAt);
      const targetDate = addLocalDays(
        currentLocal.slice(0, 10),
        shift.dayShift
      );
      const targetTime = shift.newTime ?? currentLocal.slice(11, 16);
      const resolved = resolveBerlinWallTime(`${targetDate}T${targetTime}`);
      if (!resolved) {
        return {
          success: false,
          error: 'batch_item_invalid',
          occurrenceId: source.occurrenceId,
        };
      }
      const durationMs =
        new Date(source.endAt).getTime() - new Date(source.startAt).getTime();
      items.push({
        occurrenceId: source.occurrenceId,
        expectedVersion: source.version,
        startAt: resolved.instant.toISOString(),
        endAt: new Date(resolved.instant.getTime() + durationMs).toISOString(),
        startDate: null,
        endDateExclusive: null,
        dstResolution: resolved.resolution,
      });
    } else {
      // A new time never applies to all-day items; without a day shift the
      // move would be a silent no-op for them.
      if (shift.dayShift === 0) {
        return {
          success: false,
          error: 'batch_item_all_day_needs_day_shift',
          occurrenceId: source.occurrenceId,
        };
      }
      if (!source.startDate || !source.endDateExclusive) {
        return {
          success: false,
          error: 'batch_item_invalid',
          occurrenceId: source.occurrenceId,
        };
      }
      items.push({
        occurrenceId: source.occurrenceId,
        expectedVersion: source.version,
        startAt: null,
        endAt: null,
        startDate: addLocalDays(source.startDate, shift.dayShift),
        endDateExclusive: addLocalDays(source.endDateExclusive, shift.dayShift),
        dstResolution: 'exact',
      });
    }
  }
  return { success: true, items };
}
