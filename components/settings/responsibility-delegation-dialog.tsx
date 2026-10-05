'use client';

import { CalendarClock, Loader2 } from 'lucide-react';

import { formatDelegationDate, personName } from '@/components/settings/responsibility-display';
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
  const {
    baseHolders,
    delegatorId,
    substituteId,
    validFrom,
    validUntil,
    note,
    isSaving,
    saveError,
    personErrors,
    dateRangeError,
    canSave,
    selectDelegator,
    selectSubstitute,
    setValidFrom,
    setValidUntil,
    setNote,
    handleOpenChange,
    handleSave,
  } = useResponsibilityDelegationForm({ data, responsibility, onOpenChange });

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
                }))}
              value={substituteId}
              onChange={selectSubstitute}
              placeholder="Vertretung wählen"
              searchPlaceholder="Person suchen …"
              emptyMessage="Keine Person gefunden"
            />
          </Field>
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
          {canSave ? (
            <div className="rounded-md border bg-muted/30 p-3 text-sm sm:col-span-2">
              <p className="flex items-center gap-2 font-medium">
                <CalendarClock className="size-4" /> Wirkung
              </p>
              <p className="mt-1 text-muted-foreground">
                Die Vertretung gilt einschließlich {formatDelegationDate(validFrom)} und{' '}
                {formatDelegationDate(validUntil)}. Ab dem Folgetag endet der Zugriff automatisch.
              </p>
            </div>
          ) : null}
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
            <Button type="submit" disabled={isSaving}>
              {isSaving && <Loader2 className="animate-spin" />}
              Vertretung speichern
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
