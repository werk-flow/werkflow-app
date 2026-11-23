'use client';

import { Pencil } from 'lucide-react';
import { useState } from 'react';

import { SiteContactFields } from '@/components/auftraege/shared/site-contact-fields';
import { useBanner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
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
import { ErrorText } from '@/components/ui/error-text';
import { Field } from '@/components/ui/field';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { Textarea } from '@/components/ui/textarea';
import { useHydrated } from '@/hooks/use-hydrated';
import { useJobEntityOptions } from '@/hooks/use-job-entity-options';
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
  OFFER_TITLE_FIELD,
  OfferTitleField,
  offerTitleError,
} from './offer-customer-fields';

const VALID_UNTIL_FIELD = 'offer-valid-until';
const OWNER_FIELD = 'offer-owner';

const HEADER_FAILURE_MESSAGES: Readonly<Record<string, string>> = {
  ...OFFER_FAILURE_MESSAGES,
  offer_changed:
    'Jemand hat das Angebot gerade geändert. Schließe das Fenster und öffne es erneut, dann siehst du die aktuelle Fassung.',
  offer_not_editable: 'Das Angebot ist kein Entwurf mehr. Seinen Kopf kannst du nicht mehr ändern.',
  offer_not_found: 'Das Angebot gibt es nicht mehr.',
  recipient_not_found: 'Den Rechnungsempfänger gibt es nicht mehr. Wähle einen anderen.',
  recipient_archived: 'Der Rechnungsempfänger ist archiviert. Wähle einen anderen.',
  owner_not_found: 'Die verantwortliche Person gehört nicht mehr zum Büro. Wähle eine andere.',
};
const SAVE_FAILED = OFFER_FAILURE_MESSAGES.save_failed ?? '';

type HeaderForm = {
  title: string;
  siteId: string;
  contactId: string;
  /** `null` follows the default: the Einsatzort's Rechnungsempfänger, else the customer. */
  recipient: { id: string; name: string } | null;
  /** `YYYY-MM-DD`, or empty while the date is cleared. */
  validUntil: string;
  openingText: string;
  closingText: string;
  ownerUserId: string;
};

function formOf(offer: OfferDetail): HeaderForm {
  return {
    title: offer.title,
    siteId: offer.site?.id ?? '',
    contactId: offer.contact?.id ?? '',
    recipient: offer.recipient.isDefault ? null : { id: offer.recipient.id, name: offer.recipient.name },
    validUntil: offer.validUntil,
    openingText: offer.openingText,
    closingText: offer.closingText,
    ownerUserId: offer.owner?.userId ?? '',
  };
}

function headerErrors(form: HeaderForm): Record<string, string | undefined> {
  return {
    [OFFER_TITLE_FIELD]: offerTitleError(form.title),
    [VALID_UNTIL_FIELD]: form.validUntil ? undefined : 'Wähle, bis wann das Angebot gilt.',
    [OWNER_FIELD]: form.ownerUserId ? undefined : 'Wähle, wer für das Angebot verantwortlich ist.',
  };
}

/** The save's input: an empty choice is none, and a cleared recipient follows the default. */
function headerInput(offerId: string, expectedVersion: number, attemptKey: string, form: HeaderForm) {
  return {
    offerId,
    expectedVersion,
    attemptKey,
    title: form.title,
    siteId: form.siteId || null,
    contactId: form.contactId || null,
    recipientClientId: form.recipient?.id ?? null,
    validUntil: form.validUntil,
    openingText: form.openingText,
    closingText: form.closingText,
    ownerUserId: form.ownerUserId,
  };
}

/** „Bearbeiten“ on the page of an offer in „Entwurf“. */
export function EditOfferHeaderButton({
  offer,
  owners,
}: {
  offer: OfferDetail;
  owners: readonly ManagerAssigneeOption[];
}) {
  const hydrated = useHydrated();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} disabled={!hydrated}>
        <Pencil className="size-4" />
        Bearbeiten
      </Button>
      {open && <OfferHeaderDialog offer={offer} owners={owners} onClose={() => setOpen(false)} />}
    </>
  );
}

/**
 * „Angebotskopf bearbeiten“: every header field but the customer, saved
 * together against the version the dialog opened with. A save another
 * session made meanwhile refuses this one instead of being overwritten. The
 * dialog stays pending until the page shows the saved header.
 */
function OfferHeaderDialog({
  offer,
  owners,
  onClose,
}: {
  offer: OfferDetail;
  owners: readonly ManagerAssigneeOption[];
  onClose: () => void;
}) {
  const { showBanner } = useBanner();
  const settle = useSettleOnChange(offer);
  const [expectedVersion] = useState(offer.version);
  const [form, setFormState] = useState(() => formOf(offer));
  // A changed form gets a new key: only a repeat of the same press answers from the first save.
  const [attemptKey, setAttemptKey] = useState(() => crypto.randomUUID());
  const setForm = (next: HeaderForm) => {
    setFormState(next);
    setAttemptKey(crypto.randomUUID());
  };
  const [attempted, setAttempted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { run, isPending: pending } = usePendingTask();
  const errors = headerErrors(form);
  const shown = attempted ? errors : {};

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setAttempted(true);
    if (focusFirstInvalidField(errors)) return;
    void run(async () => {
      setError(null);
      const since = settle.markChange();
      const result = await updateOffer(headerInput(offer.id, expectedVersion, attemptKey, form)).catch(
        () => null,
      );
      if (!result?.success) {
        setError(result ? describeFailure(result.error, HEADER_FAILURE_MESSAGES, SAVE_FAILED) : SAVE_FAILED);
        return;
      }
      await settle(since);
      onClose();
      showBanner({ variant: 'success', message: 'Angebot gespeichert.' });
    });
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()} pending={pending}>
      <DialogContent size="2xl">
        <form onSubmit={submit} className="contents" noValidate>
          <DialogHeader>
            <DialogTitle>Angebotskopf bearbeiten</DialogTitle>
            <DialogDescription>
              {`${offer.offerNumber} für ${offer.client.name}. Den Kunden kannst du nicht ändern.`}
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-6">
            <OfferHeaderFields
              offer={offer}
              owners={owners}
              form={form}
              setForm={setForm}
              shown={shown}
              pending={pending}
            />
            <ErrorText>{error}</ErrorText>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              Abbrechen
            </Button>
            <Button type="submit" pending={pending}>
              Speichern
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Every header field but the customer; the marks show after the first press. */
function OfferHeaderFields({
  offer,
  owners,
  form,
  setForm,
  shown,
  pending,
}: {
  offer: OfferDetail;
  owners: readonly ManagerAssigneeOption[];
  form: HeaderForm;
  setForm: (form: HeaderForm) => void;
  shown: Record<string, string | undefined>;
  pending: boolean;
}) {
  return (
    <>
      <div className="space-y-4">
        <OfferTitleField
          value={form.title}
          onChange={(title) => setForm({ ...form, title })}
          error={shown[OFFER_TITLE_FIELD]}
          disabled={pending}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <SiteContactFields
            clientId={offer.client.id}
            siteId={form.siteId}
            contactId={form.contactId}
            onSiteChange={(siteId) => setForm({ ...form, siteId })}
            onContactChange={(contactId) => setForm({ ...form, contactId })}
            disabled={pending}
            idPrefix="offer"
          />
        </div>
        <RecipientField
          offer={offer}
          recipient={form.recipient}
          onChange={(recipient) => setForm({ ...form, recipient })}
          disabled={pending}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Gültig bis" htmlFor={VALID_UNTIL_FIELD} required error={shown[VALID_UNTIL_FIELD]}>
            <DatePicker
              value={parseIsoLocalDate(form.validUntil)}
              onChange={(date) => setForm({ ...form, validUntil: date ? toLocalDateString(date) : '' })}
              disabled={pending}
            />
          </Field>
          <Field label="Verantwortlich" htmlFor={OWNER_FIELD} required error={shown[OWNER_FIELD]}>
            <SearchableSelect
              value={form.ownerUserId}
              onChange={(ownerUserId) => setForm({ ...form, ownerUserId })}
              options={ownerOptions(owners, offer.owner)}
              placeholder="Person wählen"
              searchPlaceholder="Person suchen…"
              emptyMessage="Niemand gefunden"
              disabled={pending}
            />
          </Field>
        </div>
      </div>
      <OfferTextFields form={form} setForm={setForm} pending={pending} />
    </>
  );
}

/** Einleitung and Schluss, which the offer prints around its positions. */
function OfferTextFields({
  form,
  setForm,
  pending,
}: {
  form: HeaderForm;
  setForm: (form: HeaderForm) => void;
  pending: boolean;
}) {
  return (
    <section className="space-y-4 border-t pt-4">
      <h3 className="text-sm font-semibold">Texte</h3>
      <Field label="Einleitung" htmlFor="offer-opening-text">
        <Textarea
          value={form.openingText}
          onChange={(event) => setForm({ ...form, openingText: event.target.value })}
          maxLength={4000}
          rows={3}
          disabled={pending}
        />
      </Field>
      <Field label="Schluss" htmlFor="offer-closing-text">
        <Textarea
          value={form.closingText}
          onChange={(event) => setForm({ ...form, closingText: event.target.value })}
          maxLength={4000}
          rows={3}
          disabled={pending}
        />
      </Field>
    </section>
  );
}

/** The office's members; a responsible person who left the office stays offered until changed. */
function ownerOptions(owners: readonly ManagerAssigneeOption[], current: OfferDetail['owner']) {
  const options = owners.map((owner) => ({ value: owner.userId, label: owner.name }));
  return current && !owners.some((owner) => owner.userId === current.userId)
    ? [{ value: current.userId, label: current.name }, ...options]
    : options;
}

/**
 * Any active customer of the organization; „Wie am Einsatzort“ follows the
 * Einsatzort's Rechnungsempfänger, else the customer, as the offer's create does.
 */
function RecipientField({
  offer,
  recipient,
  onChange,
  disabled,
}: {
  offer: OfferDetail;
  recipient: HeaderForm['recipient'];
  onChange: (recipient: HeaderForm['recipient']) => void;
  disabled: boolean;
}) {
  const search = useJobEntityOptions(
    { kind: 'clients', purpose: 'customer-work' },
    recipient ? [recipient.id] : [],
    recipient ? [{ value: recipient.id, label: recipient.name }] : undefined,
  );
  return (
    <Field
      label="Rechnungsempfänger"
      htmlFor="offer-recipient"
      description={
        recipient
          ? undefined
          : `Der Rechnungsempfänger des Einsatzorts, sonst der Kunde${offer.recipient.isDefault ? `, zurzeit ${offer.recipient.name}` : ''}.`
      }
    >
      <SearchableSelect
        value={recipient?.id ?? ''}
        onChange={(id) => {
          const option = search.options.find((entry) => entry.value === id);
          onChange(id && option ? { id, name: option.label } : null);
        }}
        options={search.options}
        onSearchChange={search.onSearchChange}
        loading={search.loading}
        loadFailure={search.loadFailure}
        onLoadMore={search.onLoadMore}
        placeholder="Wie am Einsatzort"
        searchPlaceholder="Kunde suchen…"
        emptyMessage="Kein Kunde gefunden"
        allowNone
        noneLabel="Wie am Einsatzort"
        disabled={disabled}
      />
    </Field>
  );
}
