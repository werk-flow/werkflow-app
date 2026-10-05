import { boardDayKey, deriveCapacityState, type CalendarBoardDay } from './board';
import { dispatchStateMatches, rowOwnsJob, type BoardRowModel, type BoardTeamGroup } from './board-model';
import type { DispatchRecipientDerivedState } from '@/lib/dispatch/types';
import type { CalendarJob } from '@/lib/jobs/types';

/**
 * The Plantafel's row filters (P1-24a): which rows „Nur Konflikte" and the
 * dispatch filter keep, and which cards each visible row shows. The dispatch
 * index is keyed `occurrenceId:employeeRecordId`; the unassigned row looks
 * up `occurrenceId:null` and so always reads „nicht gesendet".
 */

type BoardDispatchIndex = ReadonlyMap<string, DispatchRecipientDerivedState>;

/**
 * Keeps the rows with a card in a selected dispatch state and, under „Nur
 * Konflikte", only person rows with an overbooked day or a challenged card.
 * Returns the groups unchanged when neither filter is active.
 */
export function filterBoardGroups(input: {
  groups: BoardTeamGroup[];
  visibleJobs: readonly CalendarJob[];
  columns: readonly { date: string }[];
  days: ReadonlyMap<string, CalendarBoardDay>;
  planned: ReadonlyMap<string, number>;
  dispatch: BoardDispatchIndex;
  dispatchStates: readonly string[];
  onlyConflicts: boolean;
}): BoardTeamGroup[] {
  const { groups, visibleJobs, columns, days, planned, dispatch, dispatchStates, onlyConflicts } = input;
  if (!onlyConflicts && dispatchStates.length === 0) return groups;
  return groups
    .map((group) => ({
      ...group,
      rows: group.rows.filter((model) => {
        const rowJobs = visibleJobs.filter((job) => rowOwnsJob(model, job));
        const recordId = model.kind === 'person' ? model.row.employeeRecordId : null;
        const matchesDispatch =
          dispatchStates.length === 0 ||
          rowJobs.some((job) =>
            dispatchStateMatches(
              dispatch.get(`${job.occurrenceId}:${recordId}`) ?? 'nicht_gesendet',
              dispatchStates,
            ),
          );
        if (!matchesDispatch) return false;
        if (!onlyConflicts) return true;
        if (!recordId) return false;
        const overbooked = columns.some((column) => {
          const day = days.get(boardDayKey(recordId, column.date));
          return day
            ? deriveCapacityState(day, planned.get(boardDayKey(recordId, column.date)) ?? 0) === 'overbooked'
            : false;
        });
        const challenged = rowJobs.some(
          (job) => dispatch.get(`${job.occurrenceId}:${recordId}`) === 'rueckfrage',
        );
        return overbooked || challenged;
      }),
    }))
    .filter((group) => group.rows.length > 0);
}

/** The cards of every visible row: its own jobs, narrowed to the selected dispatch states. */
export function boardJobsByRow(input: {
  rowModels: readonly BoardRowModel[];
  visibleJobs: readonly CalendarJob[];
  dispatch: BoardDispatchIndex;
  dispatchStates: readonly string[];
}): Map<string, CalendarJob[]> {
  const { rowModels, visibleJobs, dispatch, dispatchStates } = input;
  const map = new Map<string, CalendarJob[]>();
  for (const model of rowModels) {
    const rowJobs = visibleJobs.filter(
      (job) =>
        rowOwnsJob(model, job) &&
        (dispatchStates.length === 0 ||
          dispatchStateMatches(
            dispatch.get(
              `${job.occurrenceId}:${model.kind === 'person' ? model.row.employeeRecordId : null}`,
            ) ?? 'nicht_gesendet',
            dispatchStates,
          )),
    );
    map.set(model.key, rowJobs);
  }
  return map;
}

/** The board cell an arrow key moves focus to, as [rowIndex, columnIndex]; null for any other key. */
export function boardArrowTarget(
  key: string,
  rowIndex: number,
  columnIndex: number,
): [number, number] | null {
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(key)) return null;
  return key === 'ArrowLeft'
    ? [rowIndex, columnIndex - 1]
    : key === 'ArrowRight'
      ? [rowIndex, columnIndex + 1]
      : key === 'ArrowUp'
        ? [rowIndex - 1, columnIndex]
        : [rowIndex + 1, columnIndex];
}
