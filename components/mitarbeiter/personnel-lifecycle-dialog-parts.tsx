'use client';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { DatePicker } from '@/components/ui/date-picker';
import { DateTimeField } from '@/components/ui/date-time-field';
import { DialogFooter } from '@/components/ui/dialog';
import { ErrorText } from '@/components/ui/error-text';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { Textarea } from '@/components/ui/textarea';
import type {
  PersonnelAccessTransitionKind,
  PersonnelDocumentAccessClass,
  PersonnelEmploymentTransitionKind,
} from '@/lib/personnel/lifecycle';

import {
  ACCESS_CLASS_OPTIONS,
  ACCESS_TRANSITIONS,
  EMPLOYMENT_TRANSITIONS,
  isScheduledAccessTransition,
} from './personnel-lifecycle-options';
import type { PersonnelLifecycleDocuments } from './use-personnel-lifecycle-documents';
import type { PersonnelLifecycleTransitions } from './use-personnel-lifecycle-transitions';
import type { PersonnelLifecycleController } from './use-personnel-lifecycle-view';

// The dialogs themselves stay in PersonnelLifecycleSection, which owns their
// DialogContent and DialogBody; these components render only what goes inside.

type PersonnelLifecycleTransitionFieldsProps = {
  lifecycle: PersonnelLifecycleController;
  transitions: PersonnelLifecycleTransitions;
};

export function PersonnelLifecycleAccessFields({
  lifecycle,
  transitions,
}: PersonnelLifecycleTransitionFieldsProps) {
  const { isPending, error, fieldErrors } = lifecycle;
  const { accessKind, setAccessKind, accessAt, setAccessAt, reason, setReason } = transitions;

  return (
    <>
      <Field label="Übergang" htmlFor="access-transition-kind">
        <SearchableSelect
          options={ACCESS_TRANSITIONS}
          value={accessKind}
          onChange={(value) => setAccessKind(value as PersonnelAccessTransitionKind)}
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
      <ErrorText>{error}</ErrorText>
    </>
  );
}

export function PersonnelLifecycleEmploymentFields({
  lifecycle,
  transitions,
  hasUnresolvedWork,
}: PersonnelLifecycleTransitionFieldsProps & { hasUnresolvedWork: boolean }) {
  const { isPending, error, fieldErrors } = lifecycle;
  const {
    employmentKind,
    setEmploymentKind,
    employmentDate,
    setEmploymentDate,
    reason,
    setReason,
    acceptUnresolved,
    setAcceptUnresolved,
  } = transitions;

  return (
    <>
      <Field label="Übergang" htmlFor="employment-transition-kind">
        <SearchableSelect
          options={EMPLOYMENT_TRANSITIONS}
          value={employmentKind}
          onChange={(value) => setEmploymentKind(value as PersonnelEmploymentTransitionKind)}
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
      {hasUnresolvedWork ? (
        <label className="flex items-start gap-2 rounded-md border p-3 text-sm">
          <Checkbox
            checked={acceptUnresolved}
            onCheckedChange={(value) => setAcceptUnresolved(value === true)}
          />
          <span>
            Offene Zuordnungen wurden geprüft und sollen sichtbar im Übergang erhalten bleiben. Es wird nichts
            still gelöscht.
          </span>
        </label>
      ) : null}
      <ErrorText>{error}</ErrorText>
    </>
  );
}

type PersonnelLifecycleUploadFieldsProps = {
  lifecycle: PersonnelLifecycleController;
  documents: PersonnelLifecycleDocuments;
};

export function PersonnelLifecycleUploadFields({
  lifecycle,
  documents,
}: PersonnelLifecycleUploadFieldsProps) {
  const { isPending, error, fieldErrors } = lifecycle;
  const { setFile, documentType, setDocumentType, accessClass, setAccessClass } = documents;

  return (
    <>
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
          onChange={(value) => setAccessClass(value as PersonnelDocumentAccessClass)}
          searchPlaceholder="Zugriffsklasse suchen…"
        />
      </Field>
      <p className="text-xs text-muted-foreground">
        Eine Empfangsbestätigung dokumentiert nur den Erhalt einer konkreten Version. Sie ist keine
        elektronische Unterschrift.
      </p>
      <ErrorText>{error}</ErrorText>
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
export function PersonnelLifecycleDialogFooter({
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
