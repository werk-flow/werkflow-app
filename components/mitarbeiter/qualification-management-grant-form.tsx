'use client';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { DatePicker } from '@/components/ui/date-picker';
import { ErrorText } from '@/components/ui/error-text';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { Label } from '@/components/ui/label';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { EvidenceState } from '@/lib/qualifications/types';
import { toLocalDateString, parseIsoLocalDate } from '@/lib/utils';

import type { QualificationManagementGrantFormState } from './use-qualification-management-grant-form';

type QualificationManagementSelectOptions = { value: string; label: string }[];

type QualificationManagementGrantFormProps = {
  form: QualificationManagementGrantFormState;
  employeeOptions: QualificationManagementSelectOptions;
  capabilityOptions: QualificationManagementSelectOptions;
  anyBusy: boolean;
};

export function QualificationManagementGrantForm({
  form,
  employeeOptions,
  capabilityOptions,
  anyBusy,
}: QualificationManagementGrantFormProps) {
  const {
    employeeRecordId,
    setEmployeeRecordId,
    capabilityId,
    setCapabilityId,
    validFrom,
    setValidFrom,
    validUntil,
    setValidUntil,
    operationalNote,
    setOperationalNote,
    supersedesId,
    editingRecordId,
    grantError,
    grantFieldErrors,
    selectedDefinition,
    isRecordIdentityLocked,
    resetGrantForm,
    saveGrant,
  } = form;

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold">Eintrag zuordnen</h2>
        <p className="text-sm text-muted-foreground">
          „Bestätigt“ ist eine interne Prüfung und keine rechtliche Aussage. Nachweise werden in diesem
          Schritt nur als Status geführt.
        </p>
      </div>
      <Card className="grid gap-3 p-4 md:grid-cols-2">
        <Field
          label="Mitarbeiter"
          htmlFor="qualification-employee"
          required
          error={grantFieldErrors.employee}
          className="gap-1.5"
        >
          <SearchableSelect
            ariaLabel="Mitarbeiter für Qualifikation"
            options={employeeOptions}
            value={employeeRecordId}
            onChange={setEmployeeRecordId}
            disabled={isRecordIdentityLocked}
            placeholder="Mitarbeiter auswählen"
            searchPlaceholder="Mitarbeiter suchen …"
            emptyMessage="Kein Mitarbeiter gefunden"
          />
        </Field>
        <Field
          label="Fähigkeit oder Zertifizierung"
          htmlFor="qualification-capability"
          required
          error={grantFieldErrors.capability}
          className="gap-1.5"
        >
          <SearchableSelect
            ariaLabel="Qualifikation auswählen"
            options={capabilityOptions}
            value={capabilityId}
            onChange={setCapabilityId}
            disabled={isRecordIdentityLocked}
            placeholder="Begriff auswählen"
            searchPlaceholder="Begriff suchen …"
            emptyMessage="Kein Begriff gefunden"
          />
        </Field>
        <Field
          label="Gültig ab"
          htmlFor="qualification-valid-from"
          required
          error={grantFieldErrors.validFrom}
          className="gap-1.5"
        >
          <DatePicker
            ariaLabel="Qualifikation gültig ab"
            value={parseIsoLocalDate(validFrom)}
            onChange={(date) => setValidFrom(date ? toLocalDateString(date) : '')}
          />
        </Field>
        <Field
          label="Gültig bis (optional)"
          htmlFor="qualification-valid-until"
          error={grantFieldErrors.validUntil}
          className="gap-1.5"
        >
          <DatePicker
            ariaLabel="Qualifikation gültig bis"
            value={parseIsoLocalDate(validUntil)}
            onChange={(date) => setValidUntil(date ? toLocalDateString(date) : '')}
          />
        </Field>
        {selectedDefinition?.kind === 'certification' && (
          <QualificationManagementCertificationFields form={form} />
        )}
        <Field
          label="Operativer Hinweis (optional)"
          htmlFor="qualification-operational-note"
          className="min-w-0 gap-1.5 md:col-span-2"
        >
          <Textarea
            className="min-w-0"
            value={operationalNote}
            onChange={(event) => setOperationalNote(event.target.value)}
            maxLength={1000}
            placeholder="Nur Hinweise für die interne Planung"
          />
        </Field>
        {supersedesId && (
          <p className="self-center text-sm text-muted-foreground">
            Erneuerung eines bestehenden Zertifizierungseintrags.
          </p>
        )}
        <div className="md:col-span-2">
          <ErrorText>{grantError}</ErrorText>
        </div>
        <div className="flex justify-end gap-2 md:col-span-2">
          {isRecordIdentityLocked && (
            <Button variant="ghost" onClick={resetGrantForm}>
              Abbrechen
            </Button>
          )}
          <Button disabled={anyBusy} onClick={saveGrant}>
            {editingRecordId
              ? 'Änderungen speichern'
              : supersedesId
                ? 'Erneuerung speichern'
                : 'Eintrag speichern'}
          </Button>
        </div>
      </Card>
    </section>
  );
}

function QualificationManagementCertificationFields({
  form,
}: {
  form: QualificationManagementGrantFormState;
}) {
  const {
    issuer,
    setIssuer,
    renewalDueDate,
    setRenewalDueDate,
    evidenceState,
    setEvidenceState,
    confirmed,
    setConfirmed,
  } = form;

  return (
    <>
      <Field label="Ausstellende Stelle" htmlFor="qualification-issuer" className="gap-1.5">
        <Input value={issuer} onChange={(event) => setIssuer(event.target.value)} />
      </Field>
      <Field
        label="Erneuerung vorgesehen (optional)"
        htmlFor="qualification-renewal-date"
        className="gap-1.5"
      >
        <DatePicker
          ariaLabel="Erneuerung vorgesehen"
          value={parseIsoLocalDate(renewalDueDate)}
          onChange={(date) => setRenewalDueDate(date ? toLocalDateString(date) : '')}
        />
      </Field>
      <Field label="Nachweisstatus" htmlFor="qualification-evidence-state" className="gap-1.5">
        <Select value={evidenceState} onValueChange={(value) => setEvidenceState(value as EvidenceState)}>
          <SelectTrigger aria-label="Nachweisstatus">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="not_required">Nicht erforderlich</SelectItem>
            <SelectItem value="pending">Ausstehend</SelectItem>
            <SelectItem value="received">Erhalten</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      <div className="flex items-center gap-2">
        <Checkbox
          id="qualification-confirmed"
          checked={confirmed}
          onCheckedChange={(value) => setConfirmed(value === true)}
        />
        <Label htmlFor="qualification-confirmed">Intern bestätigt</Label>
      </div>
    </>
  );
}
