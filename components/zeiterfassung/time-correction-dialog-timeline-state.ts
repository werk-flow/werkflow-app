'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { readInBackground } from '@/lib/data/background-read-client';
import { findBreakShortfall, type BreakShortfall } from '@/lib/time-corrections/break-warning';
import {
  editTimelineRow,
  insertBreakIntoRow,
  MAX_TIMELINE_ROWS,
  newTimelineRow,
  resolveCorrectionTimeline,
  timelineRowsFromVisits,
  type CorrectionTimelineRow,
  type ResolvedTimeline,
  type TimelineRowErrors,
} from '@/lib/time-corrections/timeline';

// The state of a forgotten day's timeline, shared by the Zeitkorrektur
// dialog and the employee's earlier-day „Zeit nachtragen“: its rows, the
// planned visits it starts from, and the errors of its rows. The host shows
// the errors after its first press of „Speichern“ and focuses the first.

const newKey = (): string => crypto.randomUUID();

/** The id of a row's time control, for focusFirstInvalidField and the label. */
export function timelineFieldId(rowKey: string, field: keyof TimelineRowErrors): string {
  return `correction-timeline-${rowKey}-${field}`;
}

type TimelineInput = {
  organizationId: string | null;
  /** Whose day: an employee record, or undefined for the caller's own. */
  employeeRecordId: string | undefined;
  /** The Berlin day of the first activity, `YYYY-MM-DD`; null while no valid date is chosen. */
  dateIso: string | null;
  /** Off while the host does not show the timeline: nothing is read. */
  enabled: boolean;
  /** Times the host already chose, such as a calendar selection: they start the timeline instead of the planned visits. */
  initialTimes?: { start: string; end: string } | undefined;
};

type VisitsNotice = 'failed' | 'overflow';

export type CorrectionTimelineState = {
  rows: CorrectionTimelineRow[];
  updateRow: (key: string, patch: Partial<Omit<CorrectionTimelineRow, 'key'>>) => void;
  addRow: () => void;
  removeRow: (key: string) => void;
  insertBreak: (key: string) => void;
  canInsertBreak: (key: string) => boolean;
  canAddRow: boolean;
  /** The planned visits of the day are being read; they replace the rows when they answer. */
  loadingVisits: boolean;
  /**
   * Why the planned visits prefilled nothing: the read failed (it can be
   * repeated), or more visits are planned than a timeline holds.
   */
  visitsNotice: VisitsNotice | null;
  retryVisits: () => void;
  /** Each row's errors; the host shows them once „Speichern“ was pressed. */
  errors: TimelineRowErrors[];
  shortfall: BreakShortfall | null;
  /** The resolved timeline with the id of each invalid control in order. */
  validate: () => { resolved: ResolvedTimeline; fieldErrors: Record<string, string | undefined> };
};

/** The planned visits of the day prefill the rows until the person changes one. */
function usePlannedVisitRows(
  input: TimelineInput,
  touched: boolean,
  setRows: (rows: CorrectionTimelineRow[]) => void,
) {
  const { organizationId, employeeRecordId, dateIso, enabled } = input;
  const [attempt, setAttempt] = useState(0);
  // The read the timeline waits for, and the last answer: the section is busy in between.
  const requestKey =
    enabled && !touched && organizationId && dateIso
      ? `${organizationId}:${employeeRecordId ?? 'own'}:${dateIso}:${attempt}`
      : null;
  const [answer, setAnswer] = useState<{ key: string; notice: VisitsNotice | null } | null>(null);
  useEffect(() => {
    if (!requestKey || !organizationId || !dateIso) return;
    const controller = new AbortController();
    void readInBackground(
      'time-correction-planned-visits',
      { organizationId, localDate: dateIso, ...(employeeRecordId ? { employeeRecordId } : {}) },
      controller.signal,
    ).then((result) => {
      if (controller.signal.aborted) return;
      // A failed read leaves no other day's rows behind: the timeline starts empty and says why.
      const prefill = result.success
        ? timelineRowsFromVisits(result.visits, newKey)
        : { rows: [newTimelineRow(newKey())], overflow: false };
      setRows(prefill.rows);
      setAnswer({
        key: requestKey,
        notice: !result.success ? 'failed' : prefill.overflow ? 'overflow' : null,
      });
    });
    return () => controller.abort();
  }, [dateIso, employeeRecordId, organizationId, requestKey, setRows]);
  return {
    visitsNotice: requestKey !== null && answer?.key === requestKey ? answer.notice : null,
    loadingVisits: requestKey !== null && answer?.key !== requestKey,
    retryVisits: () => setAttempt((value) => value + 1),
  };
}

export function useCorrectionTimeline(input: TimelineInput): CorrectionTimelineState {
  const [storedRows, setRowsState] = useState<CorrectionTimelineRow[]>(() => [
    newTimelineRow(newKey(), input.initialTimes ?? {}),
  ]);
  const [touched, setTouched] = useState(input.initialTimes !== undefined);
  const setRows = useCallback((next: CorrectionTimelineRow[]) => setRowsState(next), []);
  const { visitsNotice, loadingVisits, retryVisits } = usePlannedVisitRows(input, touched, setRows);
  // While the visits of a new person or day load, the untouched rows of the
  // previous ones never stand for them: the timeline is empty until the answer.
  const [pendingRows] = useState(() => [newTimelineRow(newKey())]);
  const rows = loadingVisits ? pendingRows : storedRows;
  const edit = (change: (current: CorrectionTimelineRow[]) => CorrectionTimelineRow[]): void => {
    setTouched(true);
    setRowsState(change(rows));
  };
  const resolved = useMemo(
    () => (input.dateIso ? resolveCorrectionTimeline(input.dateIso, rows) : null),
    [input.dateIso, rows],
  );
  const errors = resolved && !resolved.valid ? resolved.errors : rows.map(() => ({}));
  return {
    rows,
    updateRow: (key, patch) =>
      edit((current) => current.map((row) => (row.key === key ? editTimelineRow(row, patch) : row))),
    addRow: () =>
      edit((current) => {
        const last = current.at(-1);
        if (current.length >= MAX_TIMELINE_ROWS) return current;
        return [...current, newTimelineRow(newKey(), { start: last?.end ?? '', jobId: last?.jobId ?? null })];
      }),
    removeRow: (key) =>
      edit((current) => (current.length > 1 ? current.filter((row) => row.key !== key) : current)),
    insertBreak: (key) => edit((current) => insertBreakIntoRow(current, key, newKey) ?? current),
    canInsertBreak: (key) => insertBreakIntoRow(rows, key, () => key) !== null,
    canAddRow: rows.length < MAX_TIMELINE_ROWS,
    visitsNotice,
    loadingVisits,
    retryVisits,
    errors,
    shortfall: resolved?.valid ? findBreakShortfall(resolved.segments) : null,
    validate: () => {
      const current = resolved ?? { valid: false as const, errors: rows.map(() => ({})) };
      const fieldErrors: Record<string, string | undefined> = {};
      if (!current.valid) {
        for (const [index, row] of rows.entries()) {
          const rowErrors: TimelineRowErrors = current.errors[index] ?? {};
          fieldErrors[timelineFieldId(row.key, 'kind')] = rowErrors.kind;
          fieldErrors[timelineFieldId(row.key, 'start')] = rowErrors.start;
          fieldErrors[timelineFieldId(row.key, 'end')] = rowErrors.end;
        }
      }
      return { resolved: current, fieldErrors };
    },
  };
}
