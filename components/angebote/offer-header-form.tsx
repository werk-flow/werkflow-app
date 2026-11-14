'use client';

import { useState } from 'react';

import { ClientSelectWithCreate } from '@/components/auftraege/shared/client-select-with-create';
import { useBanner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import { ErrorText } from '@/components/ui/error-text';
import { Field } from '@/components/ui/field';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { Textarea } from '@/components/ui/textarea';
import { useJobEntityOptions } from '@/hooks/use-job-entity-options';
import { useRealtimeRouterRefresh } from '@/hooks/use-realtime-router-refresh';
import { usePendingTask } from '@/hooks/use-server-action';
import { useSettleOnChange } from '@/hooks/use-settle-on-change';
import { describeFailure } from '@/lib/action-messages';
import type { ManagerAssigneeOption } from '@/lib/members/profile-name';
import { updateOffer } from '@/lib/offers/actions';
import type { OfferDetail } from '@/lib/offers/types';
import { focusFirstInvalidField } from '@/lib/ui/field-validation';
import { parseIsoLocalDate, toLocalDateString } from '@/lib/utils';
import {
  OFFER_FAILURE_MESSAGES,
  OfferCustomerFields,
  offerCustomerErrors,
  type OfferCustomerForm,
} from './offer-customer-fields';

const SAVE_FAILED = OFFER_FAILURE_MESSAGES.save_failed ?? '';
const CHANGED_ELSEWHERE =
  'Jemand hat das Angebot gerade geändert. Übernimm die aktuelle Fassung und trage deine Änderung erneut ein.';

type HeaderForm = OfferCustomerForm & {
  /** `null` follows the default: the Einsatzort's Rechnungsempfänger, else the customer. */
  recipient: { id: string; name: string } | null;
  validUntil: string;
  openingText: string;
  closingText: string;
  ownerUserId: string;
  work: OfferDetail['work'];
};

function formOf(offer: OfferDetail): HeaderForm {
  return {
    title: offer.title,
    client: offer.client,
    siteId: offer.site?.id ?? '',
    contactId: offer.contact?.id ?? '',
    recipient: offer.recipient.isDefault ? null : offer.recipient,
    validUntil: offer.validUntil,
    openingText: offer.openingText,
    closingText: offer.closingText,
    ownerUserId: offer.owner?.userId ?? '',
    work: offer.work,
  };
}

/**
 * The live offer page's editor. Another session's save reads the page again;
 * the form keeps what the user typed until they take the current version.
 */
export function OfferHeaderEditor({
  offer,
  owners,
}: {
  offer: OfferDetail;
  owners: readonly ManagerAssigneeOption[];
}) {
  useRealtimeRouterRefresh({ tables: ['offers'] });
  const [resetKey, setResetKey] = useState(0);
  return (
    <OfferHeaderForm
      key={resetKey}
      offer={offer}
      owners={owners}
      onTakeCurrent={() => setResetKey((key) => key + 1)}
    />
  );
}

/**
 * The header of an offer in „Entwurf“: every field of the record, saved
 * together against the version the form was filled from. A save another
 * session made meanwhile is refused; the form then offers the current
 * version instead of writing over it.
 */
function OfferHeaderForm({
  offer,
  owners,
  onTakeCurrent,
}: {
  offer: OfferDetail;
  owners: readonly ManagerAssigneeOption[];
  /** Fills the form again from the current offer. */
  onTakeCurrent: () => void;
}) {
  const { showBanner } = useBanner();
  const settle = useSettleOnChange(offer);
  const [form, setForm] = useState(() => formOf(offer));
  const [baseVersion, setBaseVersion] = useState(offer.version);
  // A changed form gets a new key, so only a repeat of the same save answers from the first one.
  const [attemptKey, setAttemptKey] = useState(() => crypto.randomUUID());
  const [attempted, setAttempted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [changedElsewhere, setChangedElsewhere] = useState(false);
  const { run, isPending: pending } = usePendingTask();
  const errors = offerCustomerErrors(form);
  const change = (next: HeaderForm) => {
    setForm(next);
    setAttemptKey(crypto.randomUUID());
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setAttempted(true);
    if (focusFirstInvalidField(errors) || !form.client) return;
    const clientId = form.client.id;
    void run(async () => {
      setError(null);
      const since = settle.markChange();
      const result = await updateOffer({
        offerId: offer.id,
        expectedVersion: baseVersion,
        attemptKey,
        title: form.title,
        clientId,
        siteId: form.siteId || null,
        contactId: form.contactId || null,
        recipientClientId: form.recipient?.id ?? null,
        validUntil: form.validUntil,
        openingText: form.openingText,
        closingText: form.closingText,
        ownerUserId: form.ownerUserId,
        work: form.work ? { kind: form.work.kind, id: form.work.id } : null,
      }).catch(() => null);
      if (result && !result.success && result.error === 'offer_changed') {
        setChangedElsewhere(true);
        return;
      }
      if (!result?.success) {
        setError(result ? describeFailure(result.error, OFFER_FAILURE_MESSAGES, SAVE_FAILED) : SAVE_FAILED);
        return;
      }
      setBaseVersion(result.version);
      setAttemptKey(crypto.randomUUID());
      await settle(since);
      showBanner({ variant: 'success', message: 'Angebot gespeichert.' });
    });
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-6 rounded-lg border bg-card p-4 sm:p-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-4">
          <OfferCustomerFields
            form={form}
            onChange={(next) =>
              change({
                ...form,
                ...next,
                // Another customer's work does not fit, and the recipient follows the default again.
                ...(next.client?.id === form.client?.id ? {} : { work: null, recipient: null }),
              })
            }
            errors={attempted ? errors : {}}
            disabled={pending}
          />
        </div>
        <div className="space-y-4">
          <RecipientField offer={offer} form={form} onChange={change} disabled={pending} />
          <Field label="Gültig bis" htmlFor="offer-valid-until" required>
            <DatePicker
              id="offer-valid-until"
              value={parseIsoLocalDate(form.validUntil)}
              onChange={(date) => date && change({ ...form, validUntil: toLocalDateString(date) })}
              disabled={pending}
            />
          </Field>
          <Field label="Verantwortlich" htmlFor="offer-owner" required>
            <SearchableSelect
              id="offer-owner"
              value={form.ownerUserId}
              onChange={(ownerUserId) => ownerUserId && change({ ...form, ownerUserId })}
              options={ownerOptions(owners, offer.owner)}
              searchPlaceholder="Person suchen…"
              emptyMessage="Niemand gefunden"
              disabled={pending}
            />
          </Field>
          <WorkFields form={form} onChange={change} disabled={pending} />
        </div>
      </div>
      <Field label="Einleitung" htmlFor="offer-opening-text">
        <Textarea
          value={form.openingText}
          onChange={(event) => change({ ...form, openingText: event.target.value })}
          maxLength={4000}
          rows={3}
          disabled={pending}
        />
      </Field>
      <Field label="Schluss" htmlFor="offer-closing-text">
        <Textarea
          value={form.closingText}
          onChange={(event) => change({ ...form, closingText: event.target.value })}
          maxLength={4000}
          rows={3}
          disabled={pending}
        />
      </Field>
      <ErrorText>{error}</ErrorText>
      {changedElsewhere && (
        <div className="space-y-2" role="alert">
          <p className="text-sm text-destructive">{CHANGED_ELSEWHERE}</p>
          <Button type="button" size="sm" variant="outline" onClick={onTakeCurrent}>
            Aktuelle Fassung übernehmen
          </Button>
        </div>
      )}
      <div className="flex justify-end">
        <Button type="submit" pending={pending}>
          Speichern
        </Button>
      </div>
    </form>
  );
}

/** The office's members; a responsible person who left the office stays shown until changed. */
function ownerOptions(owners: readonly ManagerAssigneeOption[], current: OfferDetail['owner']) {
  const options = owners.map((owner) => ({ value: owner.userId, label: owner.name }));
  return current && !owners.some((owner) => owner.userId === current.userId)
    ? [{ value: current.userId, label: current.name }, ...options]
    : options;
}

function RecipientField({
  offer,
  form,
  onChange,
  disabled,
}: {
  offer: OfferDetail;
  form: HeaderForm;
  onChange: (form: HeaderForm) => void;
  disabled: boolean;
}) {
  const savedDefault = offer.recipient.isDefault && form.client?.id === offer.client.id;
  return (
    <Field
      label="Rechnungsempfänger"
      htmlFor="offer-recipient"
      description={
        form.recipient
          ? 'Name und Anschrift werden beim Senden ins Angebot übernommen.'
          : `Leer: der Rechnungsempfänger des Einsatzorts, sonst der Kunde${savedDefault ? ` (jetzt ${offer.recipient.name})` : ''}.`
      }
    >
      <ClientSelectWithCreate
        id="offer-recipient"
        value={form.recipient?.id ?? ''}
        selectedClient={form.recipient}
        onValueChange={(_value, recipient) => onChange({ ...form, recipient })}
        disabled={disabled}
      />
    </Field>
  );
}

/** The customer's job or project the offer was written for; one replaces the other. */
function WorkFields({
  form,
  onChange,
  disabled,
}: {
  form: HeaderForm;
  onChange: (form: HeaderForm) => void;
  disabled: boolean;
}) {
  const clientId = form.client?.id ?? '';
  const jobs = useJobEntityOptions(
    { kind: 'jobs', clientId },
    form.work?.kind === 'job' ? [form.work.id] : [],
    form.work?.kind === 'job' ? [{ value: form.work.id, label: form.work.label }] : undefined,
  );
  const projects = useJobEntityOptions(
    { kind: 'projects', clientId },
    form.work?.kind === 'project' ? [form.work.id] : [],
    form.work?.kind === 'project' ? [{ value: form.work.id, label: form.work.label }] : undefined,
  );
  const pick = (kind: 'job' | 'project', id: string, label: string | undefined) =>
    onChange({ ...form, work: id ? { kind, id, label: label ?? '' } : null });
  if (!clientId) return null;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Für Auftrag" htmlFor="offer-job">
        <SearchableSelect
          id="offer-job"
          value={form.work?.kind === 'job' ? form.work.id : ''}
          onChange={(id) => pick('job', id, jobs.options.find((option) => option.value === id)?.label)}
          options={jobs.options}
          onSearchChange={jobs.onSearchChange}
          loading={jobs.loading}
          loadFailure={jobs.loadFailure}
          onLoadMore={jobs.onLoadMore}
          placeholder="Kein Auftrag"
          searchPlaceholder="Auftrag suchen…"
          emptyMessage="Kein Auftrag gefunden"
          allowNone
          noneLabel="Kein Auftrag"
          disabled={disabled}
        />
      </Field>
      <Field label="Für Projekt" htmlFor="offer-project">
        <SearchableSelect
          id="offer-project"
          value={form.work?.kind === 'project' ? form.work.id : ''}
          onChange={(id) => pick('project', id, projects.options.find((option) => option.value === id)?.label)}
          options={projects.options}
          onSearchChange={projects.onSearchChange}
          loading={projects.loading}
          loadFailure={projects.loadFailure}
          onLoadMore={projects.onLoadMore}
          placeholder="Kein Projekt"
          searchPlaceholder="Projekt suchen…"
          emptyMessage="Kein Projekt gefunden"
          allowNone
          noneLabel="Kein Projekt"
          disabled={disabled}
        />
      </Field>
    </div>
  );
}
