import { formatMinutesOfDay } from '@/lib/calendar/drag-math';
import { edgeResizedSpan } from '@/lib/calendar/day-drag-geometry';
import {
  DEFAULT_VISIT_MINUTES,
  MIN_ITEM_MINUTES,
  resizedBlockUpdates,
  shiftedBlockUpdates,
} from '@/lib/calendar/day-layout';
import { reassignmentChanges } from '@/lib/calendar/board-model';
import { formatRefusalDate } from '@/lib/calendar/messages';
import type { CalendarDragPayload, CalendarDragTarget } from '../drag-engine/payload';
import { moveSuccessMessage } from '../board/use-board-surface';
import { jobSpanMinutes, rowFor } from './day-surface-rules';
import type { DaySurfaceInput } from './use-day-surface';

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
  const { mutations, rows, parkingContexts, onPark, onParkedContextMissing, dayStart, nowMs, dateIso } =
    input;
  if (target.kind === 'zone') {
    if (payload.kind === 'occurrence' || payload.kind === 'untimed') onPark(payload.job);
    return;
  }
  const minutes = target.minutes ?? 0;
  const row = rowFor(rows, target.userId);
  const name = row?.name ?? 'Ohne Zuweisung';
  const time = formatMinutesOfDay(minutes);
  const dateLabel = formatRefusalDate(dateIso);
  switch (payload.kind) {
    case 'occurrence':
    case 'untimed': {
      const { job } = payload;
      const sourceRecordId =
        payload.kind === 'occurrence'
          ? payload.sourceEmployeeRecordId
          : (rows.find((candidate) => job.assignedUserIds.includes(candidate.userId))?.row
              ?.employeeRecordId ?? null);
      const sourceUserId =
        payload.kind === 'occurrence'
          ? payload.sourceUserId
          : (job.assignedUserIds.find((userId) => rows.some((candidate) => candidate.userId === userId)) ??
            null);
      const reassign =
        reassignmentChanges({
          job,
          sourceEmployeeRecordId: sourceRecordId,
          sourceUserId,
          target: { employeeRecordId: target.employeeRecordId, userId: target.userId, date: dateIso },
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
      return;
    }
    case 'parked': {
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
      return;
    }
    case 'resizeJob': {
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
      return;
    }
    case 'timeBlock': {
      const { session } = payload;
      if (!session.clockIn || !target.userId) return;
      const sourceEntries = session.sourceEntries ?? [
        session.clockIn,
        ...(session.clockOut ? [session.clockOut] : []),
      ];
      const deltaMs = dayStart.getTime() + minutes * 60_000 - new Date(session.clockIn.timestamp).getTime();
      if (deltaMs === 0 && target.userId === payload.sourceUserId) return;
      void mutations.moveTimeBlock({
        sourceEntries,
        updates: shiftedBlockUpdates(sourceEntries, deltaMs, target.userId),
      });
      return;
    }
    case 'resizeBlock': {
      const { session, edge } = payload;
      if (!session.clockIn) return;
      const sourceEntries = session.sourceEntries ?? [
        session.clockIn,
        ...(session.clockOut ? [session.clockOut] : []),
      ];
      const clockInMs = new Date(session.clockIn.timestamp).getTime();
      const clockOutMs = session.clockOut ? new Date(session.clockOut.timestamp).getTime() : nowMs();
      const next = edgeResizedSpan({
        start: clockInMs,
        end: clockOutMs,
        edge,
        edgeAt: dayStart.getTime() + minutes * 60_000,
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
        (update) =>
          sourceEntries.find((entry) => entry.id === update.entryId)?.timestamp !== update.newTimestamp,
      );
      if (updates.length === 0) return;
      void mutations.resizeTimeBlock({ sourceEntries, updates });
      return;
    }
    case 'barEdge':
      return;
    default: {
      const exhaustive: never = payload;
      return exhaustive;
    }
  }
}
