'use client';

import { ClientSelectWithCreate } from '@/components/auftraege/shared/client-select-with-create';
import { SiteContactFields } from '@/components/auftraege/shared/site-contact-fields';
import { Field } from '@/components/ui/field';
import type { Client } from '@/lib/jobs/types';
import type { ClientRequest } from '@/lib/requests/types';
import type { ConvertRequestForm } from './use-convert-request-form';

interface ConvertRequestCustomerFieldsProps {
  request: ClientRequest;
  clients: Client[];
  form: ConvertRequestForm;
}

/** Customer, work site and contact of the conversion target. */
export function ConvertRequestCustomerFields({ request, clients, form }: ConvertRequestCustomerFieldsProps) {
  const {
    target,
    clientId,
    setClientId,
    siteId,
    setSiteId,
    contactId,
    setContactId,
    setLocation,
    clientError,
    isLoading,
  } = form;

  return (
    <>
      <Field
        label="Kunde"
        htmlFor="convert-client"
        required
        error={clientError}
        description={
          !request.clientId
            ? `Die Anfrage kam von ${request.callerName || 'einem unbekannten Anrufer'}. Wähle den passenden Kunden oder lege ihn neu an.`
            : undefined
        }
      >
        <ClientSelectWithCreate
          clients={clients}
          value={clientId}
          onValueChange={(nextClientId) => {
            setClientId(nextClientId);
            setSiteId('');
            setContactId('');
          }}
          disabled={isLoading}
        />
      </Field>

      {clientId && (
        <SiteContactFields
          clientId={clientId}
          siteId={siteId}
          contactId={contactId}
          onSiteChange={(nextSiteId, site) => {
            setSiteId(nextSiteId);
            if (target === 'job' && site) {
              const cityLine = [site.postalCode, site.city].filter(Boolean).join(' ');
              setLocation([site.street, cityLine].filter(Boolean).join(', '));
            }
          }}
          onContactChange={setContactId}
          disabled={isLoading}
          idPrefix="convert"
        />
      )}
    </>
  );
}
