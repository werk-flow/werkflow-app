'use client';

import { useEffect, useState } from 'react';

import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { getClientRelations } from '@/lib/clients/actions';
import {
  formatSiteAddress,
  type ClientContact,
  type ClientSite,
} from '@/lib/clients/types';

const NONE_VALUE = '__none__';

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
          <Select
            value={siteId || NONE_VALUE}
            onValueChange={(value) => {
              const nextSiteId = value === NONE_VALUE ? '' : value;
              const site = sites.find((entry) => entry.id === nextSiteId) ?? null;
              onSiteChange(nextSiteId, site);
            }}
            disabled={disabled || isLoading}
          >
            <SelectTrigger id={`${idPrefix}-site`}>
              <SelectValue
                placeholder={isLoading ? 'Wird geladen...' : 'Kein Einsatzort'}
              />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE_VALUE}>Kein Einsatzort</SelectItem>
              {sites.map((site) => {
                const address = formatSiteAddress(site);
                return (
                  <SelectItem key={site.id} value={site.id}>
                    {site.name}
                    {address ? ` · ${address}` : ''}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </div>
      )}

      {(isLoading || contacts.length > 0) && (
        <div className="grid gap-2">
          <Label htmlFor={`${idPrefix}-contact`}>Ansprechpartner</Label>
          <Select
            value={contactId || NONE_VALUE}
            onValueChange={(value) =>
              onContactChange(value === NONE_VALUE ? '' : value)
            }
            disabled={disabled || isLoading}
          >
            <SelectTrigger id={`${idPrefix}-contact`}>
              <SelectValue
                placeholder={isLoading ? 'Wird geladen...' : 'Kein Ansprechpartner'}
              />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE_VALUE}>Kein Ansprechpartner</SelectItem>
              {contacts.map((contact) => (
                <SelectItem key={contact.id} value={contact.id}>
                  {contact.name}
                  {contact.role ? ` (${contact.role})` : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
    </>
  );
}
