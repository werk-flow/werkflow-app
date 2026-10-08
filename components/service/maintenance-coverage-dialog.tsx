'use client';

import type { ActionFailure } from '@/lib/action-result';
import type { ReactElement } from 'react';

import { ClientSelectWithCreate } from '@/components/auftraege/shared/client-select-with-create';
import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import {
  Dialog,
  DialogContent,
  DialogBody,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ErrorText } from '@/components/ui/error-text';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { Textarea } from '@/components/ui/textarea';
import type { MaintenanceClientOption } from '@/lib/maintenance/types';
import { formatBerlinLocalDate } from '@/lib/planning/date-time';
import { parseIsoLocalDate } from '@/lib/utils';
import { useMaintenanceCoverageForm } from './use-maintenance-coverage-form';

/** The values the workspace can show for a coverage before the server confirms it. */
export type MaintenanceCoveragePendingDraft = {
  kind: 'coverage';
  id: string;
  clientName: string;
  siteName: string;
  reference: string | null;
};

export type MaintenanceCoverageCreateSubmission = {
  draft: MaintenanceCoveragePendingDraft;
  /** Never rejects; a failure carries the German message for the caller's banner. */
  result: Promise<{ success: true } | (ActionFailure & { message: string })>;
};
export function MaintenanceCoverageDialog({
  open,
  onOpenChange,
  clients,
  onSubmitted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clients: MaintenanceClientOption[];
  /**
   * Create from the workspace (feedback canon): the dialog closes at once and
   * the caller renders the pending row until `result` settles.
   */
  onSubmitted?: (submission: MaintenanceCoverageCreateSubmission) => void;
}): ReactElement {
  const {
    clientId,
    setClientId,
    siteId,
    setSiteId,
    reference,
    setReference,
    description,
    setDescription,
    validFrom,
    setValidFrom,
    validUntil,
    setValidUntil,
    noticeDate,
    setNoticeDate,
    renewalDate,
    setRenewalDate,
    reviewDueDate,
    setReviewDueDate,
    operationalNote,
    setOperationalNote,
    error,
    isPending,
    client,
    clientError,
    siteError,
    submit,
  } = useMaintenanceCoverageForm({ onOpenChange, clients, onSubmitted });

  return (
    <Dialog open={open} onOpenChange={onOpenChange} pending={isPending}>
      <DialogContent size="2xl">
        <DialogHeader>
          <DialogTitle>Operative Abdeckung erfassen</DialogTitle>
          <DialogDescription>
            Halte nur sichere Vertrags- und Fristdaten fest. Eine Verknüpfung bedeutet keine automatische
            Aussage über Kosten oder Gewährleistung.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            if (!isPending) submit();
          }}
          noValidate
          className="flex min-h-0 flex-1 flex-col gap-4"
        >
          <DialogBody>
            <div className="grid gap-4 py-2 sm:grid-cols-2">
              <Field label="Kunde" htmlFor="coverage-client" required error={clientError}>
                <ClientSelectWithCreate
                  clients={clients}
                  value={clientId}
                  onValueChange={(value) => {
                    setClientId(value);
                    setSiteId('');
                  }}
                />
              </Field>
              <Field label="Einsatzort" htmlFor="coverage-site" required error={siteError}>
                <SearchableSelect
                  value={siteId}
                  onChange={setSiteId}
                  options={(client?.sites ?? []).map((site) => ({
                    value: site.id,
                    label: site.name,
                    description: site.address,
                  }))}
                  disabled={!client}
                  placeholder="Einsatzort wählen"
                  searchPlaceholder="Einsatzort suchen…"
                  emptyMessage="Kein Einsatzort gefunden"
                />
              </Field>
              <Field
                label="Vertrags- oder Referenznummer (optional)"
                htmlFor="coverage-reference"
                className="sm:col-span-2"
              >
                <Input value={reference} onChange={(event) => setReference(event.target.value)} />
              </Field>
              <Field label="Beschreibung (optional)" htmlFor="coverage-description" className="sm:col-span-2">
                <Textarea value={description} onChange={(event) => setDescription(event.target.value)} />
              </Field>
              <Field label="Gültig ab" htmlFor="coverage-valid-from">
                <DatePicker
                  ariaLabel="Gültig ab"
                  value={parseIsoLocalDate(validFrom)}
                  onChange={(value) => setValidFrom(value ? formatBerlinLocalDate(value) : '')}
                />
              </Field>
              <Field label="Gültig bis" htmlFor="coverage-valid-until">
                <DatePicker
                  ariaLabel="Gültig bis"
                  value={parseIsoLocalDate(validUntil)}
                  onChange={(value) => setValidUntil(value ? formatBerlinLocalDate(value) : '')}
                />
              </Field>
              <Field label="Kündigungsfrist prüfen am" htmlFor="coverage-notice">
                <DatePicker
                  ariaLabel="Kündigungsfrist prüfen am"
                  value={parseIsoLocalDate(noticeDate)}
                  onChange={(value) => setNoticeDate(value ? formatBerlinLocalDate(value) : '')}
                />
              </Field>
              <Field label="Verlängerung am" htmlFor="coverage-renewal">
                <DatePicker
                  ariaLabel="Verlängerung am"
                  value={parseIsoLocalDate(renewalDate)}
                  onChange={(value) => setRenewalDate(value ? formatBerlinLocalDate(value) : '')}
                />
              </Field>
              <Field label="Interne Wiedervorlage" htmlFor="coverage-review" className="sm:col-span-2">
                <DatePicker
                  ariaLabel="Interne Wiedervorlage"
                  value={parseIsoLocalDate(reviewDueDate)}
                  onChange={(value) => setReviewDueDate(value ? formatBerlinLocalDate(value) : '')}
                />
              </Field>
              <Field label="Operativer Hinweis" htmlFor="coverage-note" className="sm:col-span-2">
                <Textarea
                  value={operationalNote}
                  onChange={(event) => setOperationalNote(event.target.value)}
                  placeholder="Nur bestätigte Hinweise, keine vermutete Kostenübernahme"
                />
              </Field>
            </div>
            <ErrorText>{error}</ErrorText>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
              Abbrechen
            </Button>
            <Button pending={isPending} type="submit" disabled={isPending}>
              Abdeckung speichern
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
