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
import { SearchableSelect } from '@/components/ui/searchable-select';
import type { SettleOnChange } from '@/hooks/use-settle-on-change';
import { usePendingTask } from '@/hooks/use-server-action';
import { describeFailure } from '@/lib/action-messages';
import {
  formatBerlinDateTimeInput,
  parseBerlinDateTimeInput,
  tomorrowMorningInBerlin,
} from '@/lib/date-time/berlin';
import { handOverOnCallShift } from '@/lib/on-call/actions';
import type { OnCallPerson, OnCallShift } from '@/lib/on-call/types';
import { focusFirstInvalidField } from '@/lib/ui/field-validation';

import { OnCallLabelField, OnCallNoteField, OnCallPeopleField, OverlapNotice } from './on-call-form-fields';
import { memberNames, ON_CALL_FAILURE_MESSAGES } from './on-call-labels';

type HandoverDialogProps = {
  organizationId: string;
  /** The shifts running now; the dialog opens only with one or more. */
  running: readonly OnCallShift[];
  people: readonly OnCallPerson[];
  settle: SettleOnChange;
  onClose: () => void;
};

/** The running shift's planned end while it lies ahead, else tomorrow 07:00. */
function defaultEnd(shift: OnCallShift | undefined): string {
  return shift && Date.parse(shift.endsAt) > Date.now()
    ? formatBerlinDateTimeInput(shift.endsAt)
    : tomorrowMorningInBerlin(new Date(), 7);
}

function useHandoverForm({ organizationId, running, settle, onClose }: Omit<HandoverDialogProps, 'people'>) {
  const [nextShiftId] = useState(() => crypto.randomUUID());
  const [currentId, setCurrentId] = useState(running[0]?.id ?? '');
  const current = running.find((shift) => shift.id === currentId);
  const [endsAt, setEndsAt] = useState(() => defaultEnd(running[0]));
  const [label, setLabel] = useState(running[0]?.label ?? '');
  const [note, setNote] = useState('');
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [attempted, setAttempted] = useState(false);
  const [overlapAsked, setOverlapAsked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { run, isPending } = usePendingTask();
  const { showBanner } = useBanner();

  const nextEnd = parseBerlinDateTimeInput(endsAt);
  const errors = {
    'on-call-handover-current': current ? undefined : 'Bitte wähle die laufende Bereitschaft.',
    'on-call-handover-people': memberIds.length > 0 ? undefined : 'Bitte wähle, wer übernimmt.',
    'on-call-handover-end-date': !nextEnd
      ? 'Bitte gib das Ende an.'
      : nextEnd.getTime() <= Date.now()
        ? 'Das Ende muss in der Zukunft liegen.'
        : undefined,
  };

  function chooseCurrent(id: string): void {
    setCurrentId(id);
    const shift = running.find((candidate) => candidate.id === id);
    setLabel(shift?.label ?? '');
    setEndsAt(defaultEnd(shift));
  }

  function submit(event: FormEvent): void {
    event.preventDefault();
    setAttempted(true);
    setError(null);
    if (focusFirstInvalidField(errors) || !current || !nextEnd) return;
    void run(async () => {
      const since = settle.markChange();
      const result = await handOverOnCallShift({
        organizationId,
        shiftId: current.id,
        expectedVersion: current.version,
        nextShiftId,
        nextEndsAt: nextEnd.toISOString(),
        nextLabel: label,
        handoverNote: note,
        memberIds,
        confirmOverlap: overlapAsked,
      });
      if (!result.success) {
        if (result.error === 'on_call_shift_overlaps') setOverlapAsked(true);
        else setError(describeFailure(result, ON_CALL_FAILURE_MESSAGES, 'Die Übergabe hat nicht geklappt.'));
        return;
      }
      onClose();
      showBanner({ variant: 'success', message: 'Bereitschaft übergeben.' });
      await settle(since);
    });
  }

  return {
    current,
    chooseCurrent,
    endsAt,
    setEndsAt,
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
    submit,
  };
}

export function OnCallHandoverDialog(props: HandoverDialogProps): ReactElement {
  const form = useHandoverForm(props);
  const { fieldErrors, isPending } = form;
  return (
    <Dialog open onOpenChange={(open) => !open && props.onClose()} pending={isPending}>
      <DialogContent>
        <form onSubmit={form.submit} className="contents" noValidate>
          <DialogHeader>
            <DialogTitle>Bereitschaft übergeben</DialogTitle>
            <DialogDescription>
              Die laufende Bereitschaft endet jetzt, die nächste beginnt sofort mit deiner Notiz.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-4 py-1">
            <Field
              label="Laufende Bereitschaft"
              htmlFor="on-call-handover-current"
              required
              error={fieldErrors?.['on-call-handover-current']}
            >
              <SearchableSelect
                value={form.current?.id ?? ''}
                onChange={form.chooseCurrent}
                options={props.running.map((shift) => ({
                  value: shift.id,
                  label: memberNames(shift.members),
                  description: shift.label ?? undefined,
                }))}
                placeholder="Bereitschaft wählen"
                searchPlaceholder="Person suchen…"
                emptyMessage="Keine laufende Bereitschaft"
              />
            </Field>
            <OnCallPeopleField
              id="on-call-handover-people"
              people={props.people}
              selectedIds={form.memberIds}
              onChange={form.setMemberIds}
              error={fieldErrors?.['on-call-handover-people']}
            />
            <Field
              label="Bis"
              htmlFor="on-call-handover-end-date"
              required
              error={fieldErrors?.['on-call-handover-end-date']}
            >
              <DateTimeField
                idPrefix="on-call-handover-end"
                value={form.endsAt}
                onChange={form.setEndsAt}
                dateAriaLabel="Datum des Endes"
                invalid={Boolean(fieldErrors?.['on-call-handover-end-date'])}
              />
            </Field>
            <OnCallLabelField id="on-call-handover-label" value={form.label} onChange={form.setLabel} />
            <OnCallNoteField id="on-call-handover-note" value={form.note} onChange={form.setNote} />
            {form.overlapAsked && <OverlapNotice label={form.label} />}
            <ErrorText>{form.error}</ErrorText>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={props.onClose} disabled={isPending}>
              Abbrechen
            </Button>
            <Button pending={isPending} type="submit" disabled={isPending}>
              {form.overlapAsked ? 'Trotzdem übergeben' : 'Jetzt übergeben'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
