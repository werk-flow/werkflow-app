'use client';

import { MapPin, Wrench } from 'lucide-react';

import { TextLink } from '@/components/ui/text-link';
import type { CustomerListItem, CustomerPageSite } from '@/lib/clients/list-page';
import { SITE_ROLE_LABELS, siteRoleKindSchema } from '@/lib/clients/site-roles';
import { formatSiteAddress } from '@/lib/clients/types';

// A link opens its own page, never the customer row it sits in.
const keepRowClosed = (event: React.MouseEvent): void => event.stopPropagation();

/** The current roles of a matched Objekt the list knows, as „Hausverwaltung: …“. */
function MatchedSiteRoles({ site }: { site: CustomerPageSite }) {
  const roles = site.roles.flatMap((entry) => {
    const role = siteRoleKindSchema.safeParse(entry.role);
    return role.success ? [{ ...entry, role: role.data }] : [];
  });
  if (roles.length === 0) return null;
  return (
    <p className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
      {roles.map((entry) => (
        <span key={entry.role}>
          {SITE_ROLE_LABELS[entry.role]}: {entry.holderName}
        </span>
      ))}
    </p>
  );
}

function MatchedSiteEquipment({ site }: { site: CustomerPageSite }) {
  if (site.equipmentTotal === 0) return null;
  const more = site.equipmentTotal - site.equipment.length;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Wrench className="size-3 text-muted-foreground" aria-hidden />
      {site.equipment.map((item) => (
        <TextLink
          key={item.id}
          onClick={keepRowClosed}
          href={`/service/anlagen/${encodeURIComponent(item.equipmentNumber)}`}
          className="text-xs"
        >
          {item.name}
        </TextLink>
      ))}
      {more > 0 && (
        <TextLink href={`/kunden/${site.clientId}#einsatzorte`} className="text-xs" onClick={keepRowClosed}>
          {more === 1 ? '1 weitere Anlage' : `${more} weitere Anlagen`}
        </TextLink>
      )}
    </div>
  );
}

/**
 * The Objekte a search matched for one customer of the list: filed under it
 * or with a role it holds, each with its current roles and Anlagen. Nothing
 * while the search matched none.
 */
export function CustomerMatchedSites({ client }: { client: CustomerListItem }) {
  const sites = client.matchedSites ?? [];
  if (sites.length === 0) return null;
  const more = (client.matchedSiteTotal ?? sites.length) - sites.length;
  return (
    <ul className="space-y-2" aria-label={`Gefundene Einsatzorte von ${client.name}`}>
      {sites.map((site) => {
        const address = formatSiteAddress(site);
        return (
          <li key={site.id} className="flex gap-2 text-sm">
            <MapPin className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <div className="min-w-0 space-y-0.5">
              <p className="flex flex-wrap gap-x-2">
                <TextLink href={`/kunden/${site.clientId}#einsatzorte`} onClick={keepRowClosed}>
                  {site.name}
                </TextLink>
                {address && <span className="text-muted-foreground">{address}</span>}
                {site.sourceNumber && (
                  <span className="text-muted-foreground">Objektnr. {site.sourceNumber}</span>
                )}
                {site.clientId !== client.id && (
                  <span className="text-muted-foreground">bei {site.clientName}</span>
                )}
              </p>
              <MatchedSiteRoles site={site} />
              <MatchedSiteEquipment site={site} />
            </div>
          </li>
        );
      })}
      {more > 0 && (
        <li className="pl-5.5 text-xs">
          <TextLink href={`/kunden/${client.id}`} onClick={keepRowClosed}>
            {more === 1 ? '1 weiterer Einsatzort' : `${more} weitere Einsatzorte`}
          </TextLink>
        </li>
      )}
    </ul>
  );
}
