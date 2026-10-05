'use client';

import { ClientSelectWithCreate } from '@/components/auftraege/shared/client-select-with-create';
import { SiteContactFields } from '@/components/auftraege/shared/site-contact-fields';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import type { Client } from '@/lib/jobs/types';
import type { CreateRequestForm } from './use-create-request-form';

interface CreateRequestCustomerFieldsProps {
  clients: Client[];
  form: CreateRequestForm;
}

/** The customer with site and contact, or the caller data while no customer is chosen. */
export function CreateRequestCustomerFields({ clients, form }: CreateRequestCustomerFieldsProps) {
  const {
    clientId,
    handleClientChange,
    siteId,
    setSiteId,
    contactId,
    setContactId,
    callerName,
    setCallerName,
    callerPhone,
    setCallerPhone,
    callerEmail,
    setCallerEmail,
    callerAddress,
    setCallerAddress,
    isLoading,
  } = form;

  return (
    <>
      <Separator />
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Kunde</p>

      <Field
        label="Kunde"
        htmlFor="request-client"
        description={
          !clientId
            ? 'Unbekannte Anrufer kannst du unten festhalten und später einem Kunden zuordnen.'
            : undefined
        }
      >
        <ClientSelectWithCreate
          clients={clients}
          value={clientId}
          onValueChange={handleClientChange}
          disabled={isLoading}
        />
      </Field>

      {clientId ? (
        <SiteContactFields
          clientId={clientId}
          siteId={siteId}
          contactId={contactId}
          onSiteChange={(nextSiteId) => setSiteId(nextSiteId)}
          onContactChange={setContactId}
          disabled={isLoading}
          idPrefix="request"
        />
      ) : (
        <div className="grid gap-3 rounded-md border bg-muted/20 p-3">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Anrufer/in (noch kein Kunde)
          </p>
          <Field label="Name" htmlFor="request-caller-name">
            <Input
              placeholder="Name der Anruferin / des Anrufers"
              value={callerName}
              onChange={(e) => setCallerName(e.target.value)}
              disabled={isLoading}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Telefon" htmlFor="request-caller-phone">
              <Input
                type="tel"
                placeholder="+49 123 456789"
                value={callerPhone}
                onChange={(e) => setCallerPhone(e.target.value)}
                disabled={isLoading}
              />
            </Field>
            <Field label="E-Mail" htmlFor="request-caller-email">
              <Input
                type="text"
                inputMode="email"
                placeholder="name@beispiel.de"
                value={callerEmail}
                onChange={(e) => setCallerEmail(e.target.value)}
                disabled={isLoading}
              />
            </Field>
          </div>
          <Field label="Adresse" htmlFor="request-caller-address">
            <Input
              placeholder="Straße, PLZ Ort"
              value={callerAddress}
              onChange={(e) => setCallerAddress(e.target.value)}
              disabled={isLoading}
            />
          </Field>
        </div>
      )}
    </>
  );
}
