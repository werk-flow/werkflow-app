'use client';

import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Textarea } from '@/components/ui/textarea';
import { SHARED_FAILURE_MESSAGES } from '@/lib/action-messages';
import { isEntryInClosedPeriod } from '@/lib/time-tracking/closed-period-dates';
import { useClosedTimePeriods } from '@/components/zeiterfassung/use-closed-time-periods';
import type { CalendarBoardRow } from '@/lib/calendar/board';
import { ErrorText } from '@/components/ui/error-text';
import { useBanner } from '@/components/ui/banner';
import { useServerAction } from '@/hooks/use-server-action';
import { submitTimeCorrection } from '@/lib/time-corrections/actions';
import {
  calendarCorrectionBoundaries,
  type CalendarTimeCorrectionDraft,
} from '@/lib/time-corrections/calendar-draft';
import { focusFirstInvalidField } from '@/lib/ui/field-validation';
import { formatBerlin } from '@/lib/utils';
import type { CorrectionOperation } from '@/components/correction-operation';
import { sendCalendarTimeCorrection } from './calendar-time-correction-send';

/** Whether a boundary's old or new time falls into a closed period. */
function correctionTouchesClosedPeriod(
  boundaries: NonNullable<ReturnType<typeof calendarCorrectionBoundaries>>,
  closedPeriods: ReturnType<typeof useClosedTimePeriods>,
): boolean {
  return boundaries.some(
    (boundary) =>
      isEntryInClosedPeriod(
        { timestamp: boundary.originalTimestamp, entryType: boundary.entryType },
        closedPeriods,
      ) ||
      isEntryInClosedPeriod({ timestamp: boundary.timestamp, entryType: boundary.entryType }, closedPeriods),
  );
}

type CalendarTimeCorrectionDialogProps = {
  organizationId: string;
  draft: CalendarTimeCorrectionDraft;
  rows: readonly CalendarBoardRow[];
  onClose: () => void;
  onSubmitted: () => void;
};

/** The dialog's state and its one submit: the checks, the correction write and its answer. */
function useTimeCorrectionSubmit({
  organizationId,
  draft,
  rows,
  onClose,
  onSubmitted,
}: CalendarTimeCorrectionDialogProps) {
  const { showBanner } = useBanner();
  const closedPeriods = useClosedTimePeriods(organizationId);
  const people = rows.flatMap((row) =>
    row.userId ? [{ employeeRecordId: row.employeeRecordId, userId: row.userId, name: row.displayName }] : [],
  );
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [reasonError, setReasonError] = useState<string | null>(null);
  const { run: runSubmit, isPending: submitting } = useServerAction(submitTimeCorrection);
  const [uncertain, setUncertain] = useState(false);
  // One operation per draft, with the reason that may have been saved under
  // it: a retry after a lost response replays the saved request, and a reason
  // edited since then must not pass as saved.
  const operationRef = useRef<CorrectionOperation | null>(null);
  const first = draft.sourceEntries[0];
  const subject = people.find((person) => person.userId === first?.userId);
  const targetUserId = draft.updates.find((update) => update.newUserId)?.newUserId ?? first?.userId;
  const target = people.find((person) => person.userId === targetUserId);
  const submit = async () => {
    if (!subject || submitting) return;
    const nextReasonError =
      reason.trim().length < 3 ? 'Bitte gib einen Grund mit mindestens drei Zeichen an.' : undefined;
    setReasonError(nextReasonError ?? null);
    if (focusFirstInvalidField({ 'calendar-correction-reason': nextReasonError })) return;
    const boundaries = calendarCorrectionBoundaries(draft, people);
    if (!boundaries) {
      setError(
        'Dieser Block kann gerade nicht korrigiert werden. Bitte prüfe offene Korrekturen in der Zeiterfassung.',
      );
      return;
    }
    if (correctionTouchesClosedPeriod(boundaries, closedPeriods)) {
      setError(SHARED_FAILURE_MESSAGES.period_closed);
      return;
    }
    setError(null);
    try {
      const answer = await sendCalendarTimeCorrection(
        operationRef,
        {
          organizationId,
          subjectEmployeeRecordId: subject.employeeRecordId,
          kind: targetUserId === first?.userId ? 'edit' : 'reassign',
          reason,
          source: null,
          proposedFacts: [],
          calendarAdjustment: boundaries,
        },
        runSubmit,
      );
      setUncertain(false);
      if (answer.kind === 'failed') {
        setError(answer.message);
        return;
      }
      // The move is saved either way; the board shows it.
      onSubmitted();
      if (answer.kind === 'earlier-version-saved') {
        setError(answer.message);
        return;
      }
      showBanner({ variant: 'success', message: answer.message });
      onClose();
    } catch {
      setUncertain(true);
      setError('Die Antwort ist ausgeblieben. Du kannst denselben Antrag erneut senden.');
    }
  };
  return { reason, setReason, error, reasonError, submitting, uncertain, subject, target, submit };
}

/** What the correction moves: each source boundary with its new time. */
function CorrectionBoundaryList({ draft }: { draft: CalendarTimeCorrectionDraft }): React.JSX.Element {
  return (
    <dl className="space-y-2 text-sm">
      {draft.updates.map((update) => {
        const original = draft.sourceEntries.find((entry) => entry.id === update.entryId);
        return original ? (
          <div key={update.entryId}>
            <dt className="text-muted-foreground">{formatBerlin(original.timestamp, 'shortDateTime')}</dt>
            <dd>{formatBerlin(update.newTimestamp, 'shortDateTime')}</dd>
          </div>
        ) : null;
      })}
    </dl>
  );
}

export function CalendarTimeCorrectionDialog(props: CalendarTimeCorrectionDialogProps) {
  const { draft, onClose } = props;
  const { reason, setReason, error, reasonError, submitting, uncertain, subject, target, submit } =
    useTimeCorrectionSubmit(props);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      pending={submitting}
    >
      <DialogContent size="xl">
        <DialogHeader>
          <DialogTitle>Arbeitszeit korrigieren</DialogTitle>
          <DialogDescription>
            Die Verschiebung wird als Korrektur gespeichert. Eigene Zeiten benötigen die Freigabe einer
            zweiten Person.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <form
            id="calendar-time-correction"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
            className="space-y-4"
          >
            <p>
              {subject?.name ?? 'Person ist im geladenen Kalender nicht mehr verfügbar.'}
              {target && target.userId !== subject?.userId ? ` → ${target.name}` : ''}
            </p>
            <CorrectionBoundaryList draft={draft} />
            <Field label="Grund" htmlFor="calendar-correction-reason" required error={reasonError}>
              <Textarea
                id="calendar-correction-reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                maxLength={2000}
                disabled={submitting || uncertain}
              />
            </Field>
            <ErrorText>{error}</ErrorText>
          </form>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Abbrechen
          </Button>
          <Button
            pending={submitting}
            type="submit"
            form="calendar-time-correction"
            // eslint-disable-next-line ui/submit-disabled-only-while-pending -- no field to fill: the person left the loaded calendar, which the dialog states
            disabled={!subject || submitting}
          >
            Korrektur einreichen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
