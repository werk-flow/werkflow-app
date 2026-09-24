import type { CalendarJob } from '@/lib/jobs/types';
import type { TimeEntry } from '@/lib/time-tracking/types';

/**
 * Pure geometry of the day view (P1-24a, package C): the hour axis, lane
 * packing of overlapping items on it, and the entry updates a moved or
 * resized time block needs. Components only render what this computes.
 */

/** Pixels per hour at zoom 1; the default zoom fits the working hours into the viewport. */
const TIMELINE_BASE_HOUR_WIDTH = 60;
const TIMELINE_VISIBLE_HOURS = 13;
export const TIMELINE_START_HOUR = 5;
export const TIMELINE_MIN_ZOOM = 0.5;
export const TIMELINE_MAX_ZOOM = 4;
export const DAY_LANE_HEIGHT = 56;
export const DAY_TRAY_HEIGHT = 32;
export const DAY_NAME_COLUMN_PX = 160;
export const DEFAULT_VISIT_MINUTES = 240;
export const MIN_ITEM_MINUTES = 15;

/** The hour width that shows the visible working hours across the given viewport width. */
export function fittedHourWidth(viewportWidth: number, zoom: number): number {
  const fitted = Math.max(TIMELINE_BASE_HOUR_WIDTH, viewportWidth / TIMELINE_VISIBLE_HOURS);
  return fitted * Math.min(TIMELINE_MAX_ZOOM, Math.max(TIMELINE_MIN_ZOOM, zoom));
}

export type TimedItem = { key: string; startMinutes: number; endMinutes: number };

export type TimedLaneItem<Item extends TimedItem> = { item: Item; lane: number };

/**
 * Greedy lane packing on the minute axis: items sorted by start take the
 * first lane whose last item ended at or before their start. Overlapping
 * items land side by side, the row grows by the lane count.
 */
export function packTimeLanes<Item extends TimedItem>(items: readonly Item[]): { lanes: TimedLaneItem<Item>[]; laneCount: number } {
  const sorted = [...items].sort((a, b) => a.startMinutes - b.startMinutes || b.endMinutes - a.endMinutes);
  const laneEnds: number[] = [];
  const lanes: TimedLaneItem<Item>[] = [];
  for (const item of sorted) {
    let lane = laneEnds.findIndex((end) => end <= item.startMinutes);
    if (lane < 0) { lane = laneEnds.length; laneEnds.push(item.endMinutes); } else { laneEnds[lane] = item.endMinutes; }
    lanes.push({ item, lane });
  }
  return { lanes, laneCount: laneEnds.length };
}

/** Minutes of the local day for an instant; an instant before the day clamps to 0, after it to 1440. */
export function minutesIntoDay(instant: Date, dayStart: Date): number {
  return Math.max(0, Math.min(24 * 60, (instant.getTime() - dayStart.getTime()) / 60_000));
}

/** Gaps between consecutive visits of one person, in minutes, when short enough to matter for travel. */
export function travelGaps(items: readonly TimedItem[], maxMinutes = 120): Array<{ startMinutes: number; endMinutes: number }> {
  const sorted = [...items].sort((a, b) => a.startMinutes - b.startMinutes);
  const gaps: Array<{ startMinutes: number; endMinutes: number }> = [];
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1];
    const current = sorted[index];
    if (!previous || !current) continue;
    const gap = current.startMinutes - previous.endMinutes;
    if (gap > 0 && gap <= maxMinutes) gaps.push({ startMinutes: previous.endMinutes, endMinutes: current.startMinutes });
  }
  return gaps;
}

export type EntryTimestampUpdate = { entryId: string; newUserId: string; newTimestamp: string };

/** Every source entry of a block shifted by the same delta, optionally onto another person. */
export function shiftedBlockUpdates(sourceEntries: readonly TimeEntry[], deltaMs: number, newUserId: string): EntryTimestampUpdate[] {
  return sourceEntries.map((entry) => ({ entryId: entry.id, newUserId, newTimestamp: new Date(new Date(entry.timestamp).getTime() + deltaMs).toISOString() }));
}

/**
 * A resized block changes its clock-in or clock-out; a trailing break that
 * starts at the old end moves with the end, so the recorded break keeps its
 * length instead of swallowing the added work.
 */
export function resizedBlockUpdates(input: {
  sourceEntries: readonly TimeEntry[];
  clockInId: string;
  clockOutId: string | null;
  edge: 'start' | 'end';
  newTimestamp: string;
  userId: string;
}): EntryTimestampUpdate[] {
  const { sourceEntries, clockInId, clockOutId, edge, newTimestamp, userId } = input;
  if (edge === 'start') return [{ entryId: clockInId, newUserId: userId, newTimestamp }];
  if (!clockOutId) return [];
  const clockOut = sourceEntries.find((entry) => entry.id === clockOutId);
  const updates: EntryTimestampUpdate[] = [{ entryId: clockOutId, newUserId: userId, newTimestamp }];
  const trailingBreak = [...sourceEntries].reverse().find((entry) => entry.entryType === 'break_start');
  if (clockOut && trailingBreak && new Date(trailingBreak.timestamp).getTime() >= new Date(clockOut.timestamp).getTime() - 60_000) {
    const deltaMs = new Date(newTimestamp).getTime() - new Date(clockOut.timestamp).getTime();
    updates.push({ entryId: trailingBreak.id, newUserId: userId, newTimestamp: new Date(new Date(trailingBreak.timestamp).getTime() + deltaMs).toISOString() });
  }
  return updates;
}

/** Minutes of the day of a visit's planned time; untimed visits sit at midnight. */
export function jobStartMinutes(job: Pick<CalendarJob, 'plannedTime'>): number {
  if (!job.plannedTime) return 0;
  const [hours = 0, minutes = 0] = job.plannedTime.split(':').map(Number);
  return hours * 60 + minutes;
}
