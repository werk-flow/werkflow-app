'use client';

import { Button } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/error-text';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { Textarea } from '@/components/ui/textarea';
import { DatePicker } from '@/components/ui/date-picker';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { EMPLOYMENT_TYPES, EMPLOYMENT_TYPE_LABELS } from '@/lib/personnel/types';
import { toLocalDateString } from '@/lib/utils';
import {
  useEmploymentConditionForm,
  type EmploymentConditionFormInput,
} from './use-employment-condition-form';

type EmploymentConditionForm = ReturnType<typeof useEmploymentConditionForm>;

function EmploymentConditionFields({ form }: { form: EmploymentConditionForm }) {
  const {
    validFrom,
    setValidFrom,
    employmentType,
    setEmploymentType,
    weeklyHours,
    setWeeklyHours,
    vacationDays,
    setVacationDays,
    note,
    setNote,
    isSaving,
    error,
    fieldErrors,
  } = form;

  return (
    <>
      <Field label="Gültig ab" htmlFor="condition-valid-from" required error={fieldErrors.validFrom}>
        <DatePicker
          ariaLabel="Gültig ab"
          value={validFrom ? new Date(`${validFrom}T00:00:00`) : undefined}
          onChange={(date) => setValidFrom(date ? toLocalDateString(date) : '')}
          disabled={isSaving}
        />
      </Field>
      <Field label="Beschäftigungsart" htmlFor="condition-type" required>
        <Select
          value={employmentType}
          onValueChange={(value) => {
            const nextType = EMPLOYMENT_TYPES.find((type) => type === value);
            if (nextType) setEmploymentType(nextType);
          }}
          disabled={isSaving}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {EMPLOYMENT_TYPES.map((type) => (
              <SelectItem key={type} value={type}>
                {EMPLOYMENT_TYPE_LABELS[type]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Wochenstunden" htmlFor="condition-weekly-hours" error={fieldErrors.weeklyHours}>
          <Input
            inputMode="decimal"
            placeholder="z. B. 40"
            value={weeklyHours}
            onChange={(e) => setWeeklyHours(e.target.value)}
            disabled={isSaving}
          />
        </Field>
        <Field label="Urlaubstage/Jahr" htmlFor="condition-vacation-days" error={fieldErrors.vacationDays}>
          <Input
            inputMode="decimal"
            placeholder="z. B. 30"
            value={vacationDays}
            onChange={(e) => setVacationDays(e.target.value)}
            disabled={isSaving}
          />
        </Field>
      </div>
      <Field label="Notiz" htmlFor="condition-note">
        <Textarea
          placeholder="z. B. Probezeit bis 30.09."
          value={note}
          onChange={(e) => setNote(e.target.value)}
          disabled={isSaving}
        />
      </Field>
      <ErrorText>{error}</ErrorText>
    </>
  );
}

export function EmploymentConditionDialog({ recordId, condition, onClose }: EmploymentConditionFormInput) {
  const form = useEmploymentConditionForm({ recordId, condition, onClose });
  const { isSaving, handleSubmit } = form;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose(false)} pending={isSaving}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>{condition ? 'Kondition bearbeiten' : 'Kondition hinzufügen'}</DialogTitle>
          <DialogDescription>
            Konditionen gelten ab ihrem Datum. Frühere Zeiträume behalten die damals gültige Version.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} noValidate className="flex min-h-0 flex-1 flex-col">
          <DialogBody className="grid gap-4 py-4">
            <EmploymentConditionFields form={form} />
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onClose(false)} disabled={isSaving}>
              Abbrechen
            </Button>
            <Button pending={isSaving} type="submit" disabled={isSaving}>
              {isSaving ? 'Wird gespeichert…' : 'Speichern'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
