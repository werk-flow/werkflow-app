'use client';

import { Building2 } from 'lucide-react';

import { TextLink } from '@/components/ui/text-link';
import { SectionTitle } from '@/components/shared/section-title';
import {
  SITE_ROLE_KINDS,
  SITE_ROLE_LABELS,
  berlinToday,
  describeSiteRolePeriod,
  siteRoleState,
  type ClientSiteRole,
} from '@/lib/clients/site-roles';
import { formatGermanDate } from '@/lib/utils';

function HeldRoleLine({ role, today }: { role: ClientSiteRole; today: string }) {
  return (
    <li className="space-y-0.5">
      <p className="flex flex-wrap gap-x-2">
        <TextLink href={`/kunden/${role.siteClientId}#einsatzorte`}>{role.siteName}</TextLink>
        {role.siteAddress && <span className="text-muted-foreground">{role.siteAddress}</span>}
      </p>
      <p className="flex flex-wrap gap-x-2 text-xs text-muted-foreground">
        <span>bei {role.siteClientName}</span>
        <span>{describeSiteRolePeriod(role, today, formatGermanDate)}</span>
        {role.siteSourceNumber && <span>Objektnr. {role.siteSourceNumber}</span>}
      </p>
    </li>
  );
}

/**
 * The Einsatzorte of other customers this customer owns, manages or pays
 * for: a Hausverwaltung's buildings, an owner's flats. Ended roles follow
 * under „Früher“. Nothing while the customer holds none.
 */
export function ClientHeldRolesCard({ clientId, roles }: { clientId: string; roles: ClientSiteRole[] }) {
  const held = roles.filter((role) => role.holderClientId === clientId && role.siteClientId !== clientId);
  if (held.length === 0) return null;
  const today = berlinToday();
  const ended = held.filter((role) => siteRoleState(role, today) === 'ended');
  return (
    <section
      id="rollen"
      aria-labelledby="rollen-title"
      className="scroll-mt-4 rounded-lg border bg-card p-4 sm:p-5"
    >
      <SectionTitle id="rollen-title" icon={<Building2 className="size-4" />} className="mb-3">
        Rollen an Einsatzorten
      </SectionTitle>
      <div className="space-y-4">
        {SITE_ROLE_KINDS.map((kind) => {
          const open = held.filter((role) => role.role === kind && siteRoleState(role, today) !== 'ended');
          if (open.length === 0) return null;
          return (
            <div key={kind} className="space-y-2">
              <p className="text-sm font-medium">{SITE_ROLE_LABELS[kind]}</p>
              <ul className="space-y-2 text-sm">
                {open.map((role) => (
                  <HeldRoleLine key={role.id} role={role} today={today} />
                ))}
              </ul>
            </div>
          );
        })}
        {ended.length > 0 && (
          <div className="space-y-2 border-t pt-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Früher</p>
            <ul className="space-y-2 text-sm">
              {ended.map((role) => (
                <li key={role.id} className="flex flex-wrap gap-x-2 text-muted-foreground">
                  <span>{SITE_ROLE_LABELS[role.role]}:</span>
                  <TextLink href={`/kunden/${role.siteClientId}#einsatzorte`}>{role.siteName}</TextLink>
                  <span>{describeSiteRolePeriod(role, today, formatGermanDate)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
