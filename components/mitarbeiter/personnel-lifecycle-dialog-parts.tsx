'use client';

import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import { DateTimeField } from '@/components/ui/date-time-field';
import { DialogBody, DialogFooter } from '@/components/ui/dialog';
import { ErrorText } from '@/components/ui/error-text';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { Textarea } from '@/components/ui/textarea';
import { addLocalDays, getBusinessTodayIso } from '@/lib/date-time/berlin';
import { toLocalDateString } from '@/lib/utils';

import {
  ACCESS_CLASS_OPTIONS,
  ACCESS_TRANSITIONS,
  EMPLOYMENT_TRANSITIONS,
  isScheduledAccessTransition,
} from './personnel-lifecycle-options';
import { PersonnelLifecycleOpenWorkNote } from './personnel-lifecycle-handover';
import type { PersonnelLifecycleDocuments } from './use-personnel-lifecycle-documents';
import type { PersonnelLifecycleTransitions } from './use-personnel-lifecycle-transitions';
import type { PersonnelLifecycleController } from './use-personnel-lifecycle-view';

// The dialogs themselves stay in PersonnelLifecycleSection, which owns their
// DialogContent and title; these components render the body and the footer.

type PersonnelLifecycleTransitionFieldsProps = {
  lifecycle: PersonnelLifecycleController;
  transitions: PersonnelLifecycleTransitions;
};

export function PersonnelLifecycleAccessBody({
  lifecycle,
  transitions,
}: PersonnelLifecycleTransitionFieldsProps) {
  const { data, isPending, error, fieldErrors } = lifecycle;
  const { accessKind, setAccessKind, accessAt, setAccessAt, reason, setReason, setAccessOpen, submitAccess } =
    transitions;

  return (
    <>
      <DialogBody className="space-y-4 py-1">
        <Field label="Übergang" htmlFor="access-transition-kind">
          <SearchableSelect
            options={ACCESS_TRANSITIONS}
            value={accessKind}
            onChange={(value) => {
              const nextKind = ACCESS_TRANSITIONS.find((option) => option.value === value);
              if (nextKind) setAccessKind(nextKind.value);
            }}
            searchPlaceholder="Übergang suchen…"
          />
        </Field>
        {isScheduledAccessTransition(accessKind) && (
          <Field
            label="Zeitpunkt"
            htmlFor="access-transition-date"
            required
            error={fieldErrors['access-transition-date']}
          >
            <DateTimeField
              idPrefix="access-transition"
              value={accessAt}
              onChange={setAccessAt}
              disabled={isPending}
            />
          </Field>
        )}
        <Field label="Grund" htmlFor="access-reason" required error={fieldErrors['access-reason']}>
          <Textarea value={reason} onChange={(event) => setReason(event.target.value)} disabled={isPending} />
        </Field>
        {accessKind === 'end_access' ? (
          <PersonnelLifecycleOpenWorkNote
            openWork={data.transitionInventory.openWork}
            onHandover={() => {
              // The dialog closes for the handover; its typed reason stays.
              setAccessOpen(false);
              transitions.openHandover(getBusinessTodayIso());
            }}
          />
        ) : null}
        <ErrorText>{error}</ErrorText>
      </DialogBody>
      <PersonnelLifecycleDialogFooter
        lifecycle={lifecycle}
        submitLabel="Speichern"
        onCancel={() => setAccessOpen(false)}
        onSubmit={submitAccess}
      />
    </>
  );
}

/**
 * Whether an employment transition leads away from the work, and the first
 * day it takes the person away: after the exit date, or the inactive date.
 * Recorded notice has no such day yet; the handover then starts from the
 * stored exit, or today.
 */
function transitionAway(
  kind: PersonnelLifecycleTransitions['employmentKind'],
  date: Date | undefined,
): { from: string | undefined } | null {
  const day = date ? toLocalDateString(date) : undefined;
  if (kind === 'exit' || kind === 'plan_exit') return { from: day ? addLocalDays(day, 1) : undefined };
  if (kind === 'mark_inactive') return { from: day };
  if (kind === 'record_notice') return { from: undefined };
  return null;
}

export function PersonnelLifecycleEmploymentBody({
  lifecycle,
  transitions,
}: PersonnelLifecycleTransitionFieldsProps) {
  const { data, isPending, error, fieldErrors } = lifecycle;
  const {
    employmentKind,
    setEmploymentKind,
    employmentDate,
    setEmploymentDate,
    reason,
    setReason,
    setEmploymentOpen,
    submitEmployment,
  } = transitions;
  const away = transitionAway(employmentKind, employmentDate);

  return (
    <>
      <DialogBody className="space-y-4 py-1">
        <Field label="Übergang" htmlFor="employment-transition-kind">
          <SearchableSelect
            options={EMPLOYMENT_TRANSITIONS}
            value={employmentKind}
            onChange={(value) => {
              const nextKind = EMPLOYMENT_TRANSITIONS.find((option) => option.value === value);
              if (nextKind) setEmploymentKind(nextKind.value);
            }}
            searchPlaceholder="Übergang suchen…"
          />
        </Field>
        <Field label="Wirksam am" htmlFor="employment-date" required error={fieldErrors['employment-date']}>
          <DatePicker
            value={employmentDate}
            onChange={setEmploymentDate}
            disabled={isPending}
            ariaLabel="Wirksam am"
          />
        </Field>
        <Field label="Grund" htmlFor="employment-reason" required error={fieldErrors['employment-reason']}>
          <Textarea value={reason} onChange={(event) => setReason(event.target.value)} disabled={isPending} />
        </Field>
        {away ? (
          <PersonnelLifecycleOpenWorkNote
            openWork={data.transitionInventory.openWork}
            onHandover={() => {
              setEmploymentOpen(false);
              transitions.openHandover(away.from);
            }}
          />
        ) : null}
        <ErrorText>{error}</ErrorText>
      </DialogBody>
      <PersonnelLifecycleDialogFooter
        lifecycle={lifecycle}
        submitLabel="Speichern"
        onCancel={() => setEmploymentOpen(false)}
        onSubmit={submitEmployment}
      />
    </>
  );
}

type PersonnelLifecycleUploadFieldsProps = {
  lifecycle: PersonnelLifecycleController;
  documents: PersonnelLifecycleDocuments;
};

export function PersonnelLifecycleUploadBody({ lifecycle, documents }: PersonnelLifecycleUploadFieldsProps) {
  const { isPending, error, fieldErrors } = lifecycle;
  const { setFile, documentType, setDocumentType, accessClass, setAccessClass, setUploadOpen, submitUpload } =
    documents;

  return (
    <>
      <DialogBody className="space-y-4 py-1">
        <Field label="Datei" htmlFor="personnel-file" required error={fieldErrors['personnel-file']}>
          <Input
            type="file"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            disabled={isPending}
          />
        </Field>
        <Field label="Dokumentart" htmlFor="document-type" required error={fieldErrors['document-type']}>
          <Input
            value={documentType}
            onChange={(event) => setDocumentType(event.target.value)}
            placeholder="z. B. Arbeitsvertrag"
          />
        </Field>
        <Field label="Zugriffsklasse" htmlFor="personnel-document-access-class">
          <SearchableSelect
            options={ACCESS_CLASS_OPTIONS}
            value={accessClass}
            onChange={(value) => {
              const nextClass = ACCESS_CLASS_OPTIONS.find((option) => option.value === value);
              if (nextClass) setAccessClass(nextClass.value);
            }}
            searchPlaceholder="Zugriffsklasse suchen…"
          />
        </Field>
        <p className="text-xs text-muted-foreground">
          Eine Empfangsbestätigung dokumentiert nur den Erhalt einer konkreten Version. Sie ist keine
          elektronische Unterschrift.
        </p>
        <ErrorText>{error}</ErrorText>
      </DialogBody>
      <PersonnelLifecycleDialogFooter
        lifecycle={lifecycle}
        submitLabel="Hochladen"
        onCancel={() => setUploadOpen(false)}
        onSubmit={submitUpload}
      />
    </>
  );
}

type PersonnelLifecycleDialogFooterProps = {
  lifecycle: PersonnelLifecycleController;
  submitLabel: string;
  onCancel: () => void;
  onSubmit: () => Promise<void>;
};

/** Cancel and command buttons shared by the three command dialogs. */
function PersonnelLifecycleDialogFooter({
  lifecycle,
  submitLabel,
  onCancel,
  onSubmit,
}: PersonnelLifecycleDialogFooterProps) {
  const { isPending, mutationDisabled } = lifecycle;

  return (
    <DialogFooter>
      <Button variant="outline" onClick={onCancel} disabled={isPending}>
        Abbrechen
      </Button>
      <Button pending={isPending} onClick={() => void onSubmit()} disabled={mutationDisabled}>
        {submitLabel}
      </Button>
    </DialogFooter>
  );
}
