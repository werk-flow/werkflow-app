'use client';

import {
  ClientSelectWithCreate,
  type ClientSelectItem,
} from '@/components/auftraege/shared/client-select-with-create';
import { SiteContactFields } from '@/components/auftraege/shared/site-contact-fields';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

// Titel, Kunde, Einsatzort and Ansprechpartner of a new offer. The server
// parses the same limits again (lib/offers/action-schemas.ts).

const OFFER_TITLE_FIELD = 'offer-title';
const OFFER_CLIENT_FIELD = 'offer-client';

export type OfferCustomerForm = {
  title: string;
  client: ClientSelectItem | null;
  siteId: string;
  contactId: string;
};

/** The marks of a missing title or customer, by control id. */
export function offerCustomerErrors(form: OfferCustomerForm): Record<string, string | undefined> {
  return {
    [OFFER_TITLE_FIELD]: form.title.trim() ? undefined : 'Gib dem Angebot einen Titel.',
    [OFFER_CLIENT_FIELD]: form.client ? undefined : 'Wähle den Kunden.',
  };
}

export const OFFER_FAILURE_MESSAGES: Readonly<Record<string, string>> = {
  client_not_found: 'Den Kunden gibt es nicht mehr. Wähle einen anderen.',
  client_archived: 'Der Kunde ist archiviert. Stelle ihn zuerst wieder her oder wähle einen anderen.',
  site_not_found: 'Der Einsatzort gehört nicht zu diesem Kunden. Wähle ihn neu.',
  contact_not_found: 'Der Ansprechpartner gehört nicht zu diesem Kunden. Wähle ihn neu.',
  save_failed: 'Das Angebot konnte nicht gespeichert werden. Bitte versuche es erneut.',
};

export function OfferCustomerFields({
  form,
  onChange,
  errors,
  disabled,
}: {
  form: OfferCustomerForm;
  /** A changed customer clears Einsatzort and Ansprechpartner, which belong to the old one. */
  onChange: (form: OfferCustomerForm) => void;
  errors: Record<string, string | undefined>;
  disabled: boolean;
}) {
  return (
    <>
      <Field label="Titel" htmlFor={OFFER_TITLE_FIELD} required error={errors[OFFER_TITLE_FIELD]}>
        <Input
          value={form.title}
          onChange={(event) => onChange({ ...form, title: event.target.value })}
          maxLength={200}
          autoComplete="off"
          placeholder="Zum Beispiel: Austausch Gastherme"
          disabled={disabled}
        />
      </Field>
      <Field label="Kunde" htmlFor={OFFER_CLIENT_FIELD} required error={errors[OFFER_CLIENT_FIELD]}>
        <ClientSelectWithCreate
          id={OFFER_CLIENT_FIELD}
          value={form.client?.id ?? ''}
          selectedClient={form.client}
          onValueChange={(_value, client) =>
            onChange({
              ...form,
              client,
              ...(client?.id === form.client?.id ? {} : { siteId: '', contactId: '' }),
            })
          }
          disabled={disabled}
        />
      </Field>
      {form.client && (
        <SiteContactFields
          clientId={form.client.id}
          siteId={form.siteId}
          contactId={form.contactId}
          onSiteChange={(siteId) => onChange({ ...form, siteId })}
          onContactChange={(contactId) => onChange({ ...form, contactId })}
          disabled={disabled}
          idPrefix="offer"
        />
      )}
    </>
  );
}
