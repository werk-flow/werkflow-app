'use client';

import { Field } from '@/components/ui/field';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { SectionError } from '@/components/ui/section-error';
import { useClientRead } from '@/hooks/use-client-read';
import { readInBackground } from '@/lib/data/background-read-client';
import { formatSiteAddress, type ClientContact, type ClientSite } from '@/lib/clients/types';

interface SiteContactFieldsProps {
  clientId: string;
  siteId: string;
  contactId: string;
  onSiteChange: (siteId: string, site: ClientSite | null) => void;
  onContactChange: (contactId: string) => void;
  disabled?: boolean;
  idPrefix?: string;
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
}: SiteContactFieldsProps) {
  // Relations belong to the customer they were read for; a change reads fresh.
  const relations = useClientRead({
    read: (signal) => readInBackground('client-relations', { clientId }, signal),
    deps: [clientId],
    enabled: clientId !== '',
    failureMessage: 'Einsatzorte und Ansprechpartner konnten nicht geladen werden.',
  });
  const sites: ClientSite[] = relations.data?.sites ?? [];
  const contacts: ClientContact[] = relations.data?.contacts ?? [];
  const isLoading = relations.loading;

  if (!clientId) return null;
  if (relations.failure) return <SectionError failure={relations.failure} />;
  if (!isLoading && sites.length === 0 && contacts.length === 0) return null;

  return (
    <>
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
