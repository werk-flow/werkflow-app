'use client';

import { useState } from 'react';
import { MapPin } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { SectionError } from '@/components/ui/section-error';
import { useClientRead } from '@/hooks/use-client-read';
import { readInBackground } from '@/lib/data/background-read-client';
import { formatSiteAddress, type ClientContact, type ClientSite } from '@/lib/clients/types';
import { CreateSiteDialog } from './create-site-dialog';

interface SiteContactFieldsProps {
  clientId: string;
  siteId: string;
  contactId: string;
  onSiteChange: (siteId: string, site: ClientSite | null) => void;
  onContactChange: (contactId: string) => void;
  disabled?: boolean;
  idPrefix?: string;
  /** A customer without a work site offers „Einsatzort anlegen“, which selects the new site. */
  offerSiteCreation?: boolean;
}

/** The customer has no work site yet: one press creates the first one and selects it. */
function FirstSiteCreation({
  clientId,
  disabled,
  onCreated,
}: {
  clientId: string;
  disabled: boolean;
  onCreated: (site: ClientSite) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-1.5">
      <p className="text-sm font-medium">Einsatzort</p>
      <p className="text-xs text-muted-foreground">Dieser Kunde hat noch keinen Einsatzort.</p>
      <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)} disabled={disabled}>
        <MapPin className="size-4" />
        Einsatzort anlegen
      </Button>
      <CreateSiteDialog clientId={clientId} open={open} onOpenChange={setOpen} onCreated={onCreated} />
    </div>
  );
}

/**
 * The sites and contacts of one customer. A site created here is offered
 * before the relations are read again.
 */
function useCustomerRelations(clientId: string) {
  const [created, setCreated] = useState<{ clientId: string; site: ClientSite } | null>(null);
  // Relations belong to the customer they were read for; a change reads fresh.
  const relations = useClientRead({
    read: (signal) => readInBackground('client-relations', { clientId }, signal),
    deps: [clientId],
    enabled: clientId !== '',
    failureMessage: 'Einsatzorte und Ansprechpartner konnten nicht geladen werden.',
  });
  const readSites: ClientSite[] = relations.data?.sites ?? [];
  const createdSite = created?.clientId === clientId ? created.site : null;
  const sites =
    createdSite && !readSites.some((site) => site.id === createdSite.id)
      ? [...readSites, createdSite]
      : readSites;
  const contacts: ClientContact[] = relations.data?.contacts ?? [];
  const isLoading = relations.loading;

  return {
    sites,
    contacts,
    isLoading,
    failure: relations.failure,
    addCreatedSite: (site: ClientSite) => setCreated({ clientId, site }),
  };
}

// Einsatzort/Ansprechpartner pickers scoped to the selected customer.
// Renders nothing without a customer; sites and contacts always belong to one.
export function SiteContactFields({
  clientId,
  siteId,
  contactId,
  onSiteChange,
  onContactChange,
  disabled = false,
  idPrefix = 'job',
  offerSiteCreation = false,
}: SiteContactFieldsProps) {
  const { sites, contacts, isLoading, failure, addCreatedSite } = useCustomerRelations(clientId);

  if (!clientId) return null;
  if (failure) return <SectionError failure={failure} />;
  const offersFirstSite = offerSiteCreation && !isLoading && sites.length === 0;
  if (!isLoading && sites.length === 0 && contacts.length === 0 && !offersFirstSite) return null;

  return (
    <>
      {offersFirstSite && (
        <FirstSiteCreation
          clientId={clientId}
          disabled={disabled}
          onCreated={(site) => {
            addCreatedSite(site);
            onSiteChange(site.id, site);
          }}
        />
      )}
      {(isLoading || sites.length > 0) && (
        <Field label="Einsatzort" htmlFor={`${idPrefix}-site`}>
          <SearchableSelect
            options={sites.map((site) => ({
              value: site.id,
              label: site.name,
              description: formatSiteAddress(site) || undefined,
            }))}
            value={siteId}
            onChange={(nextSiteId) => {
              const site = sites.find((entry) => entry.id === nextSiteId) ?? null;
              onSiteChange(nextSiteId, site);
            }}
            placeholder={isLoading ? 'Wird geladen…' : 'Kein Einsatzort'}
            searchPlaceholder="Einsatzort suchen…"
            emptyMessage="Kein Einsatzort gefunden"
            allowNone
            noneLabel="Kein Einsatzort"
            disabled={disabled || isLoading}
          />
        </Field>
      )}

      {(isLoading || contacts.length > 0) && (
        <Field label="Ansprechpartner" htmlFor={`${idPrefix}-contact`}>
          <SearchableSelect
            options={contacts.map((contact) => ({
              value: contact.id,
              label: contact.name,
              description: contact.role || undefined,
            }))}
            value={contactId}
            onChange={onContactChange}
            placeholder={isLoading ? 'Wird geladen…' : 'Kein Ansprechpartner'}
            searchPlaceholder="Ansprechpartner suchen…"
            emptyMessage="Kein Ansprechpartner gefunden"
            allowNone
            noneLabel="Kein Ansprechpartner"
            disabled={disabled || isLoading}
          />
        </Field>
      )}
    </>
  );
}
