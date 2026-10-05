'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
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
import { describeFailure } from '@/lib/action-messages';
import type { CalendarBoardRow } from '@/lib/calendar/board';
import { ErrorText } from '@/components/ui/error-text';
import { useBanner } from '@/components/ui/banner';
import { submitTimeCorrection } from '@/lib/time-corrections/actions';
import {
  calendarCorrectionBoundaries,
  type CalendarTimeCorrectionDraft,
} from '@/lib/time-corrections/calendar-draft';
import { TIME_CORRECTION_FAILURE_MESSAGES } from '@/lib/time-corrections/messages';

// The correction sentences every surface shares, plus the ones that name the
// calendar; the shared codes (`invalid_input`, `period_closed`, ...) take their
// sentence from lib/action-messages.ts.
const errors: Readonly<Partial<Record<string, string>>> = {
  ...TIME_CORRECTION_FAILURE_MESSAGES,
  calendar_incomplete_source:
    'Dieser Block ist noch aktiv oder zeigt nur einen Teil der ursprünglichen Buchung. Bitte korrigiere ihn in der Zeiterfassung.',
  time_correction_stale_source:
    'Die Buchung wurde inzwischen geändert. Bitte lade den Kalender neu und prüfe die Änderung.',
  time_correction_multiple_application_sources:
    'Dieser Block enthält mehrere frühere Korrekturen. Bitte bearbeite sie einzeln in der Zeiterfassung.',
};
const formatCalendarCorrectionTime = (value: string): string =>
  new Intl.DateTimeFormat('de-DE', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'Europe/Berlin',
  }).format(new Date(value));

export function CalendarTimeCorrectionDialog({
  organizationId,
  draft,
  rows,
  onClose,
  onSubmitted,
}: {
  organizationId: string;
  draft: CalendarTimeCorrectionDraft;
  rows: readonly CalendarBoardRow[];
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const { showBanner } = useBanner();
  const people = rows.flatMap((row) =>
    row.userId ? [{ employeeRecordId: row.employeeRecordId, userId: row.userId, name: row.displayName }] : [],
  );
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [operationId] = useState(() => crypto.randomUUID());
  const first = draft.sourceEntries[0];
  const subject = people.find((person) => person.userId === first?.userId);
  const targetUserId = draft.updates.find((update) => update.newUserId)?.newUserId ?? first?.userId;
  const target = people.find((person) => person.userId === targetUserId);
  const submit = async () => {
    if (!subject || submitting) return;
    if (reason.trim().length < 3) {
      setReasonError('Bitte gib einen Grund mit mindestens drei Zeichen an.');
      document.getElementById('calendar-correction-reason')?.focus();
      return;
    }
    setReasonError(null);
    const boundaries = calendarCorrectionBoundaries(draft, people);
    if (!boundaries) {
      setError(
        'Dieser Block kann gerade nicht korrigiert werden. Bitte prüfe offene Korrekturen in der Zeiterfassung.',
      );
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const result = await submitTimeCorrection({
        organizationId,
        subjectEmployeeRecordId: subject.employeeRecordId,
        kind: targetUserId === first?.userId ? 'edit' : 'reassign',
        reason,
        source: null,
        proposedFacts: [],
        calendarAdjustment: boundaries,
        operationId,
      });
      setUncertain(false);
      if (!result.success) {
        setError(
          describeFailure(
            result.error,
            errors,
            'Die Korrektur konnte nicht gespeichert werden. Bitte prüfe die Buchung in der Zeiterfassung.',
          ),
        );
        return;
      }
      showBanner({
        variant: 'success',
        message:
          result.status === 'approved'
            ? 'Die Zeit wurde korrigiert.'
            : 'Die Korrektur wurde zur Prüfung eingereicht.',
      });
      onSubmitted();
      onClose();
    } catch {
      setUncertain(true);
      setError('Die Antwort ist ausgeblieben. Du kannst denselben Antrag erneut senden.');
    } finally {
      setSubmitting(false);
    }
  };
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
            <dl className="space-y-2 text-sm">
              {draft.updates.map((update) => {
                const original = draft.sourceEntries.find((entry) => entry.id === update.entryId);
                return original ? (
                  <div key={update.entryId}>
                    <dt className="text-muted-foreground">
                      {formatCalendarCorrectionTime(original.timestamp)}
                    </dt>
                    <dd>{formatCalendarCorrectionTime(update.newTimestamp)}</dd>
                  </div>
                ) : null;
              })}
            </dl>
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
            type="submit"
            form="calendar-time-correction"
            // eslint-disable-next-line ui/submit-disabled-only-while-pending -- no field to fill: the person left the loaded calendar, which the dialog states
            disabled={!subject || submitting}
          >
            {submitting ? <Loader2 className="size-4 animate-spin" /> : null}Korrektur einreichen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
