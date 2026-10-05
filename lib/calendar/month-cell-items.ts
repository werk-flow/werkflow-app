import { minutesIntoDay } from './day-layout';
import { formatMinutesOfDay } from './drag-math';
import type { CalendarJob } from '@/lib/jobs/types';
import type { CalendarWorkBlock } from '@/lib/time-tracking/calendar-blocks';
import { toLocalDateString } from '@/lib/utils';

/**
 * The one-line items of the month view's day cells (P1-24a, package D):
 * single-day visits and recorded work blocks, sorted by start time. A
 * multi-day all-day visit is a week bar instead and is not listed here.
 */

export type MonthCellItem =
  | { kind: 'job'; key: string; job: CalendarJob }
  | {
      kind: 'block';
      key: string;
      block: CalendarWorkBlock;
      userId: string;
      name: string;
      startMinutes: number;
      endMinutes: number;
      dateIso: string;
    };

type MonthBlockInterval = { id: string; startMs: number; endMs: number };

/** A visit that spans more than one calendar day. */
export function isMultiDay(job: CalendarJob): boolean {
  return Boolean(
    job.plannedDate && job.endDateExclusive && job.endDateExclusive > addDays(job.plannedDate, 1),
  );
}

function addDays(dateIso: string, days: number): string {
  const time = Date.parse(`${dateIso}T00:00:00Z`) + days * 86_400_000;
  return new Date(time).toISOString().slice(0, 10);
}

/**
 * Groups the visible range's single-day visits and work blocks by date, and
 * the blocks' intervals by `userId:date` for the drop checks. An open block
 * ends at `nowTick`.
 */
export function monthCellItemsByDate(input: {
  jobs: readonly CalendarJob[];
  blocksByUser: ReadonlyMap<string, readonly CalendarWorkBlock[]>;
  nameByUser: ReadonlyMap<string, string>;
  nowTick: number;
  range: { from: string; to: string };
}): {
  itemsByDate: Map<string, MonthCellItem[]>;
  blocksByUserDate: Map<string, MonthBlockInterval[]>;
} {
  const { jobs, blocksByUser, nameByUser, nowTick, range } = input;
  const byDate = new Map<string, MonthCellItem[]>();
  const byUserDate = new Map<string, MonthBlockInterval[]>();
  const push = (dateIso: string, item: MonthCellItem) => {
    const list = byDate.get(dateIso) ?? [];
    list.push(item);
    byDate.set(dateIso, list);
  };
  for (const job of jobs) {
    // Multi-day all-day visits become week bars below; single days list as items.
    if (job.plannedDate && job.plannedDate >= range.from && job.plannedDate <= range.to && !isMultiDay(job))
      push(job.plannedDate, { kind: 'job', key: job.id, job });
  }
  for (const [userId, blocks] of blocksByUser) {
    for (const block of blocks) {
      const start = new Date(block.start);
      const dateIso = toLocalDateString(start);
      if (dateIso < range.from || dateIso > range.to) continue;
      const dayStart = new Date(start.getFullYear(), start.getMonth(), start.getDate());
      const endMs = block.end ? new Date(block.end).getTime() : nowTick;
      push(dateIso, {
        kind: 'block',
        key: block.id,
        block,
        userId,
        name: nameByUser.get(userId) ?? 'Mitarbeiter',
        startMinutes: minutesIntoDay(start, dayStart),
        endMinutes: minutesIntoDay(new Date(endMs), dayStart),
        dateIso,
      });
      const list = byUserDate.get(`${userId}:${dateIso}`) ?? [];
      list.push({ id: block.id, startMs: start.getTime(), endMs });
      byUserDate.set(`${userId}:${dateIso}`, list);
    }
  }
  for (const list of byDate.values()) {
    list.sort((a, b) =>
      (a.kind === 'job' ? (a.job.plannedTime ?? '') : formatMinutesOfDay(a.startMinutes)).localeCompare(
        b.kind === 'job' ? (b.job.plannedTime ?? '') : formatMinutesOfDay(b.startMinutes),
      ),
    );
  }
  return { itemsByDate: byDate, blocksByUserDate: byUserDate };
}
