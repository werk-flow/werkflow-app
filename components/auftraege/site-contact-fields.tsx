'use client';

import { useEffect, useState } from 'react';

import { Label } from '@/components/ui/label';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { getClientRelations } from '@/lib/clients/actions';
import {
  formatSiteAddress,
  type ClientContact,
  type ClientSite,
} from '@/lib/clients/types';

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
  // Relations are keyed by the customer they were loaded for; loading state
  // is derived so the effect never calls setState synchronously.
  const [loaded, setLoaded] = useState<{
    forClientId: string;
    sites: ClientSite[];
    contacts: ClientContact[];
  } | null>(null);

  useEffect(() => {
    if (!clientId) return;

    let isCurrent = true;
    getClientRelations(clientId)
      .then((result) => {
        if (!isCurrent) return;
        setLoaded({
          forClientId: clientId,
          sites: result.success ? result.sites : [],
          contacts: result.success ? result.contacts : [],
        });
      })
      .catch(() => {
        // A rejected fetch must not leave the pickers in a loading state.
        if (!isCurrent) return;
        setLoaded({ forClientId: clientId, sites: [], contacts: [] });
      });

    return () => {
      isCurrent = false;
    };
  }, [clientId]);

  const hasData = loaded?.forClientId === clientId;
  const sites = hasData ? loaded.sites : [];
  const contacts = hasData ? loaded.contacts : [];
  const isLoading = !!clientId && !hasData;

  if (!clientId) return null;
  if (!isLoading && sites.length === 0 && contacts.length === 0) return null;

  return (
    <>
      {(isLoading || sites.length > 0) && (
        <div className="grid gap-2">
          <Label htmlFor={`${idPrefix}-site`}>Einsatzort</Label>
          <SearchableSelect
            id={`${idPrefix}-site`}
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
            placeholder={isLoading ? 'Wird geladen...' : 'Kein Einsatzort'}
            searchPlaceholder="Einsatzort suchen..."
            emptyMessage="Kein Einsatzort gefunden"
            allowNone
            noneLabel="Kein Einsatzort"
            disabled={disabled || isLoading}
          />
        </div>
      )}

      {(isLoading || contacts.length > 0) && (
        <div className="grid gap-2">
          <Label htmlFor={`${idPrefix}-contact`}>Ansprechpartner</Label>
          <SearchableSelect
            id={`${idPrefix}-contact`}
            options={contacts.map((contact) => ({
              value: contact.id,
              label: contact.name,
              description: contact.role || undefined,
            }))}
            value={contactId}
            onChange={onContactChange}
            placeholder={isLoading ? 'Wird geladen...' : 'Kein Ansprechpartner'}
            searchPlaceholder="Ansprechpartner suchen..."
            emptyMessage="Kein Ansprechpartner gefunden"
            allowNone
            noneLabel="Kein Ansprechpartner"
            disabled={disabled || isLoading}
          />
        </div>
      )}
    </>
  );
}
