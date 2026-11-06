import { formatRefusalDate } from '@/lib/calendar/messages';
import { shiftedBlockUpdates } from '@/lib/calendar/day-layout';
import type { CalendarDragPayload, CalendarDragTarget } from '../drag-engine/payload';
import { sessionSourceEntries } from '../day-view/day-surface-drop';
import { dayDelta } from './month-surface-rules';
import type { MonthSurfaceInput } from './use-month-surface';

/** A drop on the month, routed to the mutation owner: it changes the date only, the person stays. */
export function applyMonthDrop(
  input: MonthSurfaceInput,
  target: CalendarDragTarget,
  payload: CalendarDragPayload,
): void {
  const { mutations, parkingContexts, onPark, onParkedContextMissing } = input;
  if (target.kind === 'zone') {
    if (payload.kind === 'occurrence') onPark(payload.job);
    return;
  }
  const dateLabel = formatRefusalDate(target.date);
  if (payload.kind === 'occurrence') {
    const { job } = payload;
    if (job.plannedDate === target.date) return;
    void mutations.moveJob({
      job,
      changes: { plannedDate: target.date },
      successMessage: `Termin wurde auf ${dateLabel} verschoben.`,
      context: { date: dateLabel },
    });
    return;
  }
  if (payload.kind === 'parked') {
    const context = parkingContexts?.get(payload.job.jobId ?? payload.job.id);
    if (!context) {
      onParkedContextMissing();
      return;
    }
    void mutations.unparkJob({
      job: payload.job,
      parkingContext: context,
      plannedDate: target.date,
      successMessage: `Auftrag wurde am ${dateLabel} eingeplant.`,
      context: { date: dateLabel },
    });
    return;
  }
  if (payload.kind === 'timeBlock') {
    const { session } = payload;
    if (!session.clockIn || target.date === payload.sourceDate) return;
    const sourceEntries = sessionSourceEntries(session, session.clockIn);
    void mutations.moveTimeBlock({
      sourceEntries,
      updates: shiftedBlockUpdates(
        sourceEntries,
        dayDelta(payload.sourceDate, target.date) * 86_400_000,
        payload.sourceUserId,
      ),
    });
  }
}
