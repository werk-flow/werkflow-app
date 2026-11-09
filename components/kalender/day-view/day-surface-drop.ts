import { formatMinutesOfDay } from '@/lib/calendar/drag-math';
import { edgeResizedSpan } from '@/lib/calendar/day-drag-geometry';
import {
  DEFAULT_VISIT_MINUTES,
  MIN_ITEM_MINUTES,
  instantAtMinutes,
  resizedBlockUpdates,
  shiftedBlockUpdates,
} from '@/lib/calendar/day-layout';
import { reassignmentChanges } from '@/lib/calendar/board-model';
import { formatRefusalDate } from '@/lib/calendar/messages';
import type { InteractiveCalendarSession, TimeEntry } from '@/lib/time-tracking/types';
import type { CalendarDragCell, CalendarDragPayload, CalendarDragTarget } from '../drag-engine/payload';
import { moveSuccessMessage } from '../board/board-surface-drop';
import { dayRowFor, dayRowKey, dayRowOwnsJob, UNASSIGNED_DAY_ROW_KEY } from '@/lib/calendar/day-rows';
import { jobSpanMinutes } from './day-surface-rules';
import type { DaySurfaceInput } from './use-day-surface';

/** What every case of a day drop reads about the target. */
type DayDropFacts = { minutes: number; time: string; name: string; dateLabel: string };

/** The entries a recorded block's correction proposes to change. */
export function sessionSourceEntries(session: InteractiveCalendarSession, clockIn: TimeEntry): TimeEntry[] {
  return session.sourceEntries ?? [clockIn, ...(session.clockOut ? [session.clockOut] : [])];
}

/** A visit moved in time or between people; an untimed card leaves the first row that owns it. */
function dropVisit(
  { mutations, rows, dateIso, people }: DaySurfaceInput,
  target: CalendarDragCell,
  payload: Extract<CalendarDragPayload, { kind: 'occurrence' | 'untimed' }>,
  { time, name, dateLabel }: DayDropFacts,
): void {
  const { job } = payload;
  // An untimed card leaves the first row that owns it, by record as on the board.
  const trayRow =
    rows.find(
      (candidate) => candidate.key !== UNASSIGNED_DAY_ROW_KEY && dayRowOwnsJob(candidate, job, people),
    ) ?? null;
  const sourceRecordId =
    payload.kind === 'occurrence' ? payload.sourceEmployeeRecordId : (trayRow?.row?.employeeRecordId ?? null);
  const sourceUserId = payload.kind === 'occurrence' ? payload.sourceUserId : (trayRow?.userId ?? null);
  const reassign =
    reassignmentChanges({
      job,
      sourceEmployeeRecordId: sourceRecordId,
      sourceUserId,
      target: { employeeRecordId: target.employeeRecordId, userId: target.userId, date: dateIso },
      people,
    }) ?? {};
  const timeChanged = job.plannedTime !== time;
  if (!timeChanged && Object.keys(reassign).length === 0) return;
  const changes = {
    ...reassign,
    ...(timeChanged ? { plannedTime: time } : {}),
    ...(job.estimatedDurationMinutes == null ? { estimatedDurationMinutes: DEFAULT_VISIT_MINUTES } : {}),
  };
  const message =
    reassign.assignedUserIds !== undefined
      ? `Termin wurde zu ${name} auf ${time} Uhr verschoben.`
      : timeChanged
        ? `Termin wurde auf ${time} Uhr verschoben.`
        : moveSuccessMessage(reassign, name, dateLabel);
  void mutations.moveJob({ job, changes, successMessage: message, context: { name, date: dateLabel } });
}

/** A parked job scheduled at the dropped time, when its parking context is known. */
function dropParkedAtTime(
  { mutations, parkingContexts, onParkedContextMissing, dateIso }: DaySurfaceInput,
  target: CalendarDragCell,
  payload: Extract<CalendarDragPayload, { kind: 'parked' }>,
  { time, name, dateLabel }: DayDropFacts,
): void {
  const context = parkingContexts?.get(payload.job.jobId ?? payload.job.id);
  if (!context) {
    onParkedContextMissing();
    return;
  }
  void mutations.unparkJob({
    job: payload.job,
    parkingContext: context,
    plannedDate: dateIso,
    plannedTime: time,
    ...(target.userId ? { assignToUserId: target.userId } : {}),
    durationMinutes: DEFAULT_VISIT_MINUTES,
    successMessage: `Auftrag wurde bei ${name} um ${time} Uhr eingeplant.`,
    context: { name, date: dateLabel },
  });
}

/** A visit's edge dropped on the axis: its new start and duration. */
function dropResizedJob(
  { mutations }: DaySurfaceInput,
  payload: Extract<CalendarDragPayload, { kind: 'resizeJob' }>,
  { minutes, name, dateLabel }: DayDropFacts,
): void {
  const { job, edge } = payload;
  const { start, end } = jobSpanMinutes(job);
  const next = edgeResizedSpan({ start, end, edge, edgeAt: minutes, minimumLength: MIN_ITEM_MINUTES });
  if (next.start === start && next.end === end) return;
  void mutations.moveJob({
    job,
    changes: {
      ...(next.start !== start ? { plannedTime: formatMinutesOfDay(next.start) } : {}),
      estimatedDurationMinutes: next.end - next.start,
    },
    successMessage: `Termin dauert jetzt ${formatMinutesOfDay(next.start)} bis ${formatMinutesOfDay(next.end)} Uhr.`,
    context: { name, date: dateLabel },
  });
}

/** A recorded block moved on the axis or to another person: an audited correction proposal. */
function dropTimeBlock(
  { mutations, dayStart }: DaySurfaceInput,
  target: CalendarDragCell,
  payload: Extract<CalendarDragPayload, { kind: 'timeBlock' }>,
  minutes: number,
): void {
  const { session } = payload;
  if (!session.clockIn || !target.userId) return;
  const sourceEntries = sessionSourceEntries(session, session.clockIn);
  const deltaMs = instantAtMinutes(dayStart, minutes) - new Date(session.clockIn.timestamp).getTime();
  if (deltaMs === 0 && target.userId === payload.sourceUserId) return;
  void mutations.moveTimeBlock({
    sourceEntries,
    updates: shiftedBlockUpdates(sourceEntries, deltaMs, target.userId),
  });
}

/** A recorded block's edge dropped on the axis: an audited correction proposal of the changed entries. */
function dropResizedBlock(
  { mutations, dayStart, nowMs }: DaySurfaceInput,
  payload: Extract<CalendarDragPayload, { kind: 'resizeBlock' }>,
  minutes: number,
): void {
  const { session, edge } = payload;
  if (!session.clockIn) return;
  const sourceEntries = sessionSourceEntries(session, session.clockIn);
  const clockInMs = new Date(session.clockIn.timestamp).getTime();
  const clockOutMs = session.clockOut ? new Date(session.clockOut.timestamp).getTime() : nowMs();
  const next = edgeResizedSpan({
    start: clockInMs,
    end: clockOutMs,
    edge,
    edgeAt: instantAtMinutes(dayStart, minutes),
    minimumLength: MIN_ITEM_MINUTES * 60_000,
  });
  const newTimestamp = new Date(next[edge]).toISOString();
  const updates = resizedBlockUpdates({
    sourceEntries,
    clockInId: session.clockIn.id,
    clockOutId: session.clockOut?.id ?? null,
    edge,
    newTimestamp,
    userId: payload.sourceUserId,
  }).filter(
    (update) => sourceEntries.find((entry) => entry.id === update.entryId)?.timestamp !== update.newTimestamp,
  );
  if (updates.length === 0) return;
  void mutations.resizeTimeBlock({ sourceEntries, updates });
}

/**
 * A drop on the day view, routed to the optimistic owner: a visit moves in
 * time and between people, a parked job is scheduled, an edge resizes, and a
 * recorded block proposes an audited correction. The Parkplatz zone parks.
 */
export function applyDayDrop(
  input: DaySurfaceInput,
  target: CalendarDragTarget,
  payload: CalendarDragPayload,
): void {
  const { rows, onPark, dateIso } = input;
  if (target.kind === 'zone') {
    if (payload.kind === 'occurrence' || payload.kind === 'untimed') onPark(payload.job);
    return;
  }
  const minutes = target.minutes ?? 0;
  const row = dayRowFor(rows, dayRowKey(target));
  const name = row?.name ?? 'Ohne Zuweisung';
  const time = formatMinutesOfDay(minutes);
  const dateLabel = formatRefusalDate(dateIso);
  const facts: DayDropFacts = { minutes, time, name, dateLabel };
  switch (payload.kind) {
    case 'occurrence':
    case 'untimed':
      dropVisit(input, target, payload, facts);
      return;
    case 'parked':
      dropParkedAtTime(input, target, payload, facts);
      return;
    case 'resizeJob':
      dropResizedJob(input, payload, facts);
      return;
    case 'timeBlock':
      dropTimeBlock(input, target, payload, minutes);
      return;
    case 'resizeBlock':
      dropResizedBlock(input, payload, minutes);
      return;
    case 'barEdge':
      return;
    default: {
      const exhaustive: never = payload;
      return exhaustive;
    }
  }
}
