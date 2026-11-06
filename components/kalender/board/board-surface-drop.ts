import { findBoardRowModel, resizedBarSpan } from '@/lib/calendar/board-slots';
import { addLocalDays } from '@/lib/date-time/berlin';
import { reassignmentChanges } from '@/lib/calendar/board-model';
import { formatRefusalDate } from '@/lib/calendar/messages';
import type {
  CalendarDragCell,
  CalendarDragPayload,
  CalendarDragTarget,
  DragModifiers,
} from '../drag-engine/payload';
import { boardRowName } from './board-surface-rules';
import type { BoardSurfaceInput } from './use-board-surface';

type DropLabels = { targetName: string; dateLabel: string };

export function moveSuccessMessage(
  changes: { plannedDate?: string; assignedUserIds?: string[] },
  targetName: string,
  dateLabel: string,
): string {
  const rowChanged = changes.assignedUserIds !== undefined;
  const dateChanged = changes.plannedDate !== undefined;
  if (rowChanged && dateChanged) return `Termin wurde zu ${targetName} auf ${dateLabel} verschoben.`;
  if (rowChanged) return `Termin wurde zu ${targetName} verschoben.`;
  return `Termin wurde auf ${dateLabel} verschoben.`;
}

/** A visit dropped on a cell: Alt copies it, otherwise it moves and the card takes the focus. */
function dropOccurrence(
  { mutations, focusCard }: BoardSurfaceInput,
  payload: Extract<CalendarDragPayload, { kind: 'occurrence' }>,
  target: CalendarDragCell,
  modifiers: DragModifiers,
  { targetName, dateLabel }: DropLabels,
): void {
  const { job } = payload;
  if (modifiers.copy && job.occurrenceId) {
    void mutations.copyJob({
      job,
      plannedDate: target.date,
      employeeRecordIds: target.employeeRecordId ? [target.employeeRecordId] : [],
      successMessage: `Kopie für ${targetName} am ${dateLabel} wurde angelegt.`,
    });
    return;
  }
  const changes = reassignmentChanges({
    job,
    sourceEmployeeRecordId: payload.sourceEmployeeRecordId,
    sourceUserId: payload.sourceUserId,
    target,
  });
  if (!changes) return;
  void mutations
    .moveJob({
      job,
      changes,
      successMessage: moveSuccessMessage(changes, targetName, dateLabel),
      context: { name: targetName, date: dateLabel },
    })
    .then((moved) => {
      if (moved) focusCard(job.occurrenceId ?? job.id, target.employeeRecordId);
    });
}

/** An all-day bar's edge dropped on a day: the span's new start or end. */
function dropBarEdge(
  { mutations }: BoardSurfaceInput,
  payload: Extract<CalendarDragPayload, { kind: 'barEdge' }>,
  target: CalendarDragCell,
  dateLabel: string,
): void {
  const { job, edge } = payload;
  if (!job.occurrenceId) return;
  const span = resizedBarSpan({
    startDate: job.plannedDate,
    endDateExclusive: job.endDateExclusive,
    edge,
    targetDate: target.date,
  });
  if (!span) return;
  void mutations.moveJob({
    job,
    changes: { plannedDate: span.plannedDate, durationDays: span.durationDays },
    successMessage: `Termin dauert jetzt bis ${formatRefusalDate(addLocalDays(span.endDateExclusive, -1))}.`,
    context: { date: dateLabel },
  });
}

/** A parked job dropped on a cell: scheduled there when its parking context is known. */
function dropParkedOnCell(
  { mutations, parkingContexts, onParkedContextMissing }: BoardSurfaceInput,
  payload: Extract<CalendarDragPayload, { kind: 'parked' }>,
  target: CalendarDragCell,
  { targetName, dateLabel }: DropLabels,
): void {
  const context = parkingContexts?.get(payload.job.jobId ?? payload.job.id);
  if (!context) {
    onParkedContextMissing();
    return;
  }
  void mutations.unparkJob({
    job: payload.job,
    parkingContext: context,
    plannedDate: target.date,
    ...(target.userId ? { assignToUserId: target.userId } : {}),
    successMessage: `Auftrag wurde bei ${targetName} am ${dateLabel} eingeplant.`,
    context: { name: targetName, date: dateLabel },
  });
}

/** A drop on the board, routed to the mutation owner by what was dragged. */
export function applyBoardDrop(
  input: BoardSurfaceInput,
  announce: (message: string) => void,
  target: CalendarDragTarget,
  payload: CalendarDragPayload,
  modifiers: DragModifiers,
): void {
  const { rowModels, onPark } = input;
  if (target.kind === 'zone') {
    if (payload.kind === 'occurrence') onPark(payload.job);
    return;
  }
  const targetRow = findBoardRowModel(rowModels, target.employeeRecordId);
  const targetName = targetRow ? boardRowName(targetRow) : 'Ohne Zuweisung';
  const dateLabel = formatRefusalDate(target.date);
  if (payload.kind === 'occurrence') {
    dropOccurrence(input, payload, target, modifiers, { targetName, dateLabel });
    return;
  }
  if (payload.kind === 'barEdge') {
    dropBarEdge(input, payload, target, dateLabel);
    return;
  }
  if (payload.kind === 'parked') {
    dropParkedOnCell(input, payload, target, { targetName, dateLabel });
    return;
  }
  if (payload.kind === 'untimed') {
    announce('Ungeplante Aufträge werden in der Tagesansicht auf eine Uhrzeit gelegt.');
  }
}
