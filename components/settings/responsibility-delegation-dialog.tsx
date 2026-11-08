'use client';

import { CalendarClock, TriangleAlert } from 'lucide-react';

import { personName } from '@/components/settings/responsibility-display';
import { delegationPeriodText } from '@/lib/responsibilities/delegation-window';
import { substituteOptionDescription } from '@/lib/responsibilities/substitute-absence';
import { useResponsibilityDelegationForm } from '@/components/settings/use-responsibility-delegation-form';
import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ErrorText } from '@/components/ui/error-text';
import { Field } from '@/components/ui/field';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { Textarea } from '@/components/ui/textarea';
import type { ResponsibilitySettingsData } from '@/lib/responsibilities/server';
import {
  formatResponsibilityPersonName,
  RESPONSIBILITY_LABELS,
  type OrganizationResponsibility,
} from '@/lib/responsibilities/types';
import { toLocalDateString } from '@/lib/utils';

function isoToDate(value: string): Date | undefined {
  if (!value) return undefined;
  return new Date(`${value}T12:00:00`);
}

export function DelegationDialog({
  data,
  responsibility,
  open,
  onOpenChange,
}: {
  data: ResponsibilitySettingsData;
  responsibility: OrganizationResponsibility;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const form = useResponsibilityDelegationForm({ data, responsibility, onOpenChange });
  const {
    validFrom,
    validUntil,
    note,
    isSaving,
    saveError,
    canSave,
    substituteAbsent,
    substituteId,
    setNote,
    handleOpenChange,
    handleSave,
  } = form;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange} pending={isSaving}>
      <DialogContent size="xl">
        <DialogHeader>
          <DialogTitle>Vertretung für {RESPONSIBILITY_LABELS[responsibility]}</DialogTitle>
          <DialogDescription>
            Die verantwortliche Person behält ihre Freigabe. Die Vertretung erhält sie nur im gewählten
            Zeitraum.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSave} noValidate className="grid gap-4 sm:grid-cols-2">
          <DelegationPeopleFields data={data} responsibility={responsibility} form={form} />
          <DelegationPeriodFields responsibility={responsibility} form={form} />
          <Field
            label="Hinweis (optional)"
            htmlFor={`${responsibility}-delegation-note`}
            className="sm:col-span-2"
          >
            <Textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Zum Beispiel: Urlaubsvertretung"
              maxLength={500}
            />
          </Field>
          {substituteAbsent ? <AbsentSubstituteWarning name={personName(data.people, substituteId)} /> : null}
          {canSave ? <DelegationEffect validFrom={validFrom} validUntil={validUntil} /> : null}
          <ErrorText className="sm:col-span-2">{saveError}</ErrorText>
          <DialogFooter className="sm:col-span-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={isSaving}
            >
              Abbrechen
            </Button>
            <Button pending={isSaving} type="submit" disabled={isSaving}>
              {substituteAbsent ? 'Trotzdem speichern' : 'Vertretung speichern'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

type DelegationForm = ReturnType<typeof useResponsibilityDelegationForm>;

function DelegationPeopleFields({
  data,
  responsibility,
  form,
}: {
  data: ResponsibilitySettingsData;
  responsibility: OrganizationResponsibility;
  form: DelegationForm;
}) {
  const {
    baseHolders,
    delegatorId,
    substituteId,
    validFrom,
    validUntil,
    personErrors,
    selectDelegator,
    selectSubstitute,
  } = form;
  return (
    <>
      <Field
        label="Verantwortliche Person"
        htmlFor={`${responsibility}-delegator`}
        required
        error={personErrors.delegator}
        className="sm:col-span-2"
      >
        <SearchableSelect
          options={baseHolders.map((holder) => ({
            value: holder.employeeRecordId,
            label: personName(data.people, holder.employeeRecordId),
          }))}
          value={delegatorId}
          onChange={selectDelegator}
          placeholder="Person wählen"
          searchPlaceholder="Person suchen …"
          emptyMessage="Keine Person gefunden"
        />
      </Field>
      <Field
        label="Vertretung"
        htmlFor={`${responsibility}-substitute`}
        required
        error={personErrors.substitute}
        className="sm:col-span-2"
      >
        <SearchableSelect
          options={data.people
            .filter((person) => person.employeeRecordId !== delegatorId)
            .map((person) => ({
              value: person.employeeRecordId,
              label: formatResponsibilityPersonName(person),
              description: substituteOptionDescription(
                person,
                data.substituteAbsences,
                validFrom,
                validUntil,
              ),
            }))}
          value={substituteId}
          onChange={selectSubstitute}
          placeholder="Vertretung wählen"
          searchPlaceholder="Person suchen …"
          emptyMessage="Keine Person gefunden"
        />
      </Field>
    </>
  );
}

function DelegationPeriodFields({
  responsibility,
  form,
}: {
  responsibility: OrganizationResponsibility;
  form: DelegationForm;
}) {
  const { validFrom, validUntil, dateRangeError, setValidFrom, setValidUntil } = form;
  return (
    <>
      <Field label="Gültig ab" htmlFor={`${responsibility}-valid-from`} required>
        <DatePicker
          ariaLabel="Gültig ab"
          value={isoToDate(validFrom)}
          onChange={(date) => date && setValidFrom(toLocalDateString(date))}
        />
      </Field>
      <Field label="Gültig bis" htmlFor={`${responsibility}-valid-until`} required error={dateRangeError}>
        <DatePicker
          ariaLabel="Gültig bis"
          value={isoToDate(validUntil)}
          onChange={(date) => date && setValidUntil(toLocalDateString(date))}
        />
      </Field>
    </>
  );
}

function DelegationEffect({ validFrom, validUntil }: { validFrom: string; validUntil: string }) {
  return (
    <div className="rounded-md border bg-muted/30 p-3 text-sm sm:col-span-2">
      <p className="flex items-center gap-2 font-medium">
        <CalendarClock className="size-4" /> Wirkung
      </p>
      <p className="mt-1 text-muted-foreground">
        Die Vertretung gilt {delegationPeriodText(validFrom, validUntil)}. Ab dem Folgetag endet der Zugriff
        automatisch.
      </p>
    </div>
  );
}

function AbsentSubstituteWarning({ name }: { name: string }) {
  return (
    <div
      role="status"
      data-testid="absent-substitute-warning"
      className="rounded-md border border-warning/40 bg-warning-soft p-3 text-sm text-warning-soft-foreground sm:col-span-2"
    >
      <p className="flex items-start gap-2 font-medium">
        <TriangleAlert className="mt-0.5 size-4 shrink-0" />
        <span>{name} ist im ganzen Zeitraum abwesend</span>
      </p>
      <p className="mt-1">
        Freigaben bleiben dann liegen, bis die verantwortliche Person zurück ist. Wähle eine andere Vertretung
        oder speichere trotzdem.
      </p>
    </div>
  );
}
