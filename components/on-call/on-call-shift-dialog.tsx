'use client';

import { useState, type FormEvent, type ReactElement } from 'react';

import { Button } from '@/components/ui/button';
import { useBanner } from '@/components/ui/banner';
import { DateTimeField } from '@/components/ui/date-time-field';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ErrorText } from '@/components/ui/error-text';
import { Field } from '@/components/ui/field';
import type { SettleOnChange } from '@/hooks/use-settle-on-change';
import { usePendingTask } from '@/hooks/use-server-action';
import { describeFailure } from '@/lib/action-messages';
import {
  addLocalDays,
  formatBerlinDateTimeInput,
  parseBerlinDateTimeInput,
  tomorrowMorningInBerlin,
} from '@/lib/date-time/berlin';
import { changeOnCallShift, planOnCallShift } from '@/lib/on-call/actions';
import { startToSave } from '@/lib/on-call/rules';
import type { OnCallPerson, OnCallShift } from '@/lib/on-call/types';
import { focusFirstInvalidField } from '@/lib/ui/field-validation';

import { OnCallLabelField, OnCallNoteField, OnCallPeopleField, OverlapNotice } from './on-call-form-fields';
import { ON_CALL_FAILURE_MESSAGES } from './on-call-labels';

type ShiftDialogProps = {
  organizationId: string;
  /** The shift to change; none plans a new one. */
  shift: OnCallShift | null;
  people: readonly OnCallPerson[];
  settle: SettleOnChange;
  onClose: () => void;
};

/** An evening shift from tomorrow 16:00 to the next morning 07:00. */
function defaultTimes(): { startsAt: string; endsAt: string } {
  const startsAt = tomorrowMorningInBerlin(new Date(), 16);
  return { startsAt, endsAt: `${addLocalDays(startsAt.slice(0, 10), 1)}T07:00` };
}

/** The parsed times and the error of each field, keyed by the control's id. */
function shiftFieldErrors(times: { startsAt: string; endsAt: string }, memberIds: readonly string[]) {
  const startsAt = parseBerlinDateTimeInput(times.startsAt);
  const endsAt = parseBerlinDateTimeInput(times.endsAt);
  const errors = {
    'on-call-start-date': startsAt ? undefined : 'Bitte gib den Beginn an.',
    'on-call-end-date': !endsAt
      ? 'Bitte gib das Ende an.'
      : startsAt && endsAt <= startsAt
        ? 'Das Ende muss nach dem Beginn liegen.'
        : undefined,
    'on-call-people': memberIds.length > 0 ? undefined : 'Bitte wähle mindestens eine Person.',
  };
  return { startsAt, endsAt, errors };
}

function useShiftForm({ organizationId, shift, settle, onClose }: Omit<ShiftDialogProps, 'people'>) {
  const [shiftId] = useState(() => shift?.id ?? crypto.randomUUID());
  const [times, setTimes] = useState(() =>
    shift
      ? {
          startsAt: formatBerlinDateTimeInput(shift.startsAt),
          endsAt: formatBerlinDateTimeInput(shift.endsAt),
        }
      : defaultTimes(),
  );
  const [label, setLabel] = useState(shift?.label ?? '');
  const [note, setNote] = useState(shift?.handoverNote ?? '');
  const [memberIds, setMemberIds] = useState(
    () => shift?.members.map((member) => member.employeeRecordId) ?? [],
  );
  const [attempted, setAttempted] = useState(false);
  // The values the overlap question was asked for; a change asks again.
  const [overlapAskedFor, setOverlapAskedFor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { run, isPending } = usePendingTask();
  const { showBanner } = useBanner();
  const [started] = useState(() => shift !== null && Date.parse(shift.startsAt) <= Date.now());

  const { startsAt, endsAt, errors } = shiftFieldErrors(times, memberIds);
  const overlapKey = `${times.startsAt}|${times.endsAt}|${label.trim()}`;
  const overlapAsked = overlapAskedFor === overlapKey;

  function submit(event: FormEvent): void {
    event.preventDefault();
    setAttempted(true);
    setError(null);
    if (focusFirstInvalidField(errors) || !startsAt || !endsAt) return;
    const values = {
      organizationId,
      shiftId,
      startsAt: startToSave(shift?.startsAt ?? null, startsAt, new Date()),
      endsAt: endsAt.toISOString(),
      label,
      handoverNote: note,
      memberIds,
      confirmOverlap: overlapAsked,
    };
    run(async () => {
      const since = settle.markChange();
      const result = shift
        ? await changeOnCallShift({ ...values, expectedVersion: shift.version })
        : await planOnCallShift(values);
      if (!result.success) {
        if (result.error === 'on_call_shift_overlaps') setOverlapAskedFor(overlapKey);
        else
          setError(
            describeFailure(result, ON_CALL_FAILURE_MESSAGES, 'Die Bereitschaft wurde nicht gespeichert.'),
          );
        return;
      }
      onClose();
      showBanner({ variant: 'success', message: shift ? 'Bereitschaft geändert.' : 'Bereitschaft geplant.' });
      await settle(since);
    }).catch(() => setError('Die Antwort kam nicht an. Versuche es erneut; gespeichert wird nur einmal.'));
  }

  return {
    times,
    setTimes,
    label,
    setLabel,
    note,
    setNote,
    memberIds,
    setMemberIds,
    fieldErrors: attempted ? errors : null,
    overlapAsked,
    error,
    isPending,
    started,
    submit,
  };
}

export function OnCallShiftDialog(props: ShiftDialogProps): ReactElement {
  const form = useShiftForm(props);
  const { times, setTimes, fieldErrors, isPending } = form;
  return (
    <Dialog open onOpenChange={(open) => !open && props.onClose()} pending={isPending}>
      <DialogContent>
        <form onSubmit={form.submit} className="contents" noValidate>
          <DialogHeader>
            <DialogTitle>{props.shift ? 'Bereitschaft ändern' : 'Bereitschaft planen'}</DialogTitle>
            <DialogDescription>
              Alle im Team sehen auf dem Dashboard, wer gerade Bereitschaft hat. Die Bereitschaft bucht keine
              Arbeitszeit.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-4 py-1">
            <OnCallPeopleField
              id="on-call-people"
              people={props.people}
              selectedIds={form.memberIds}
              onChange={form.setMemberIds}
              error={fieldErrors?.['on-call-people']}
            />
            <Field
              label="Beginn"
              htmlFor="on-call-start-date"
              required
              error={fieldErrors?.['on-call-start-date']}
              description={form.started ? 'Die Bereitschaft läuft schon, der Beginn bleibt.' : undefined}
            >
              <DateTimeField
                idPrefix="on-call-start"
                value={times.startsAt}
                onChange={(startsAt) => setTimes({ ...times, startsAt })}
                dateAriaLabel="Datum des Beginns"
                disabled={form.started}
                invalid={Boolean(fieldErrors?.['on-call-start-date'])}
              />
            </Field>
            <Field label="Ende" htmlFor="on-call-end-date" required error={fieldErrors?.['on-call-end-date']}>
              <DateTimeField
                idPrefix="on-call-end"
                value={times.endsAt}
                onChange={(endsAt) => setTimes({ ...times, endsAt })}
                dateAriaLabel="Datum des Endes"
                invalid={Boolean(fieldErrors?.['on-call-end-date'])}
              />
            </Field>
            <OnCallLabelField id="on-call-label" value={form.label} onChange={form.setLabel} />
            <OnCallNoteField id="on-call-note" value={form.note} onChange={form.setNote} />
            {form.overlapAsked && <OverlapNotice label={form.label} />}
            <ErrorText>{form.error}</ErrorText>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={props.onClose} disabled={isPending}>
              Abbrechen
            </Button>
            <Button pending={isPending} type="submit" disabled={isPending}>
              {form.overlapAsked ? 'Trotzdem speichern' : 'Speichern'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
