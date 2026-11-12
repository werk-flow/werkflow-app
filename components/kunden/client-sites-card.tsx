'use client';

import Link from 'next/link';
import {
  Archive,
  ArchiveRestore,
  Hash,
  KeyRound,
  MapPin,
  Pencil,
  Plus,
  Star,
  Users,
  Wrench,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { InlinePending } from '@/components/ui/inline-pending';
import { formatSiteAddress, type ClientContact, type ClientSite } from '@/lib/clients/types';
import {
  SITE_CONTACT_ROLE_LABELS,
  SITE_ROLE_KINDS,
  SITE_ROLE_LABELS,
  berlinToday,
  describeSiteRolePeriod,
  siteRoleState,
  type ClientSiteRole,
} from '@/lib/clients/site-roles';
import { TextLink } from '@/components/ui/text-link';
import { formatGermanDate } from '@/lib/utils';
import { EQUIPMENT_STATE_LABELS, type EquipmentListItem } from '@/lib/installed-equipment/types';
import { RegionLoadError } from '@/components/shared/region-load-error';
import { SectionTitle } from '@/components/shared/section-title';

interface ClientSiteRowProps {
  clientId: string;
  site: ClientSite;
  contactNameById: ReadonlyMap<string, string>;
  /** The active contacts linked to this Objekt as Mieter or Zugangskontakt. */
  siteContacts: ClientContact[];
  /** Every role on this Objekt; null when the roles could not be read. */
  siteRoles: ClientSiteRole[] | null;
  onOpenRoles: (site: ClientSite) => void;
  equipment: EquipmentListItem[];
  equipmentLoadFailed: boolean;
  isAdminOrManager: boolean;
  isPendingRow: (id: string) => boolean;
  onEditSite: (site: ClientSite) => void;
  onToggleSiteActive: (site: ClientSite) => void;
}

/** The active equipment of one site as links; nothing when the site has none. */
function ClientSiteEquipmentLinks({ siteId, equipment }: { siteId: string; equipment: EquipmentListItem[] }) {
  if (!equipment.some((item) => item.siteId === siteId && !item.archivedAt)) return null;
  return (
    <div className="mt-3 border-t pt-3">
      <p className="mb-2 flex items-center gap-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <Wrench className="size-3" />
        Anlagen & Geräte
      </p>
      <div className="flex flex-wrap gap-2">
        {equipment
          .filter((item) => item.siteId === siteId && !item.archivedAt)
          .map((item) => (
            <Link
              key={item.id}
              href={`/service/anlagen/${encodeURIComponent(item.equipmentNumber)}`}
              className="rounded-md border px-2.5 py-1.5 text-xs transition-colors hover:bg-muted/50"
            >
              <span className="font-medium">{item.name}</span>
              <span className="ml-1 text-muted-foreground">· {EQUIPMENT_STATE_LABELS[item.state]}</span>
            </Link>
          ))}
      </div>
    </div>
  );
}

/**
 * The current owner, Hausverwaltung and Rechnungsempfänger of an Objekt; a
 * kind with no current holder shows its coming one with the start day.
 */
function ClientSiteRoleSummary({
  clientId,
  site,
  siteRoles,
  isAdminOrManager,
  onOpenRoles,
}: Pick<ClientSiteRowProps, 'clientId' | 'site' | 'siteRoles' | 'isAdminOrManager' | 'onOpenRoles'>) {
  if (siteRoles === null) return null;
  const today = berlinToday();
  const current = SITE_ROLE_KINDS.flatMap((kind) => {
    const ofKind = siteRoles.filter((role) => role.role === kind);
    const now = ofKind.filter((role) => siteRoleState(role, today) === 'current');
    if (now.length > 0) return now;
    // Roles of a kind never overlap, so the earliest coming one starts next.
    const next = ofKind
      .filter((role) => siteRoleState(role, today) === 'upcoming')
      .sort((a, b) => (a.startsOn ?? '').localeCompare(b.startsOn ?? ''))[0];
    return next ? [next] : [];
  });
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
      {current.length === 0 ? (
        <span className="text-muted-foreground">Rollen nicht eingetragen</span>
      ) : (
        current.map((role) => (
          <span key={role.id} className="text-muted-foreground">
            {SITE_ROLE_LABELS[role.role]}:{' '}
            {role.holderClientId === clientId ? (
              <span className="text-foreground">{role.holderName}</span>
            ) : (
              <TextLink href={`/kunden/${role.holderClientId}`}>{role.holderName}</TextLink>
            )}
            {siteRoleState(role, today) === 'upcoming' &&
              ` ${describeSiteRolePeriod(role, today, formatGermanDate)}`}
          </span>
        ))
      )}
      {isAdminOrManager && (
        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => onOpenRoles(site)}>
          Rollen verwalten
        </Button>
      )}
    </div>
  );
}

/** The Mieter and Zugangskontakte of an Objekt with a phone to call. */
function ClientSiteContacts({ siteContacts }: { siteContacts: ClientContact[] }) {
  if (siteContacts.length === 0) return null;
  return (
    <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
      {siteContacts.map((contact) => (
        <li key={contact.id} className="flex flex-wrap gap-x-2">
          <span>
            {contact.siteRole ? `${SITE_CONTACT_ROLE_LABELS[contact.siteRole]}: ` : ''}
            <span className="text-foreground">{contact.name}</span>
          </span>
          {contact.phone && <span>{contact.phone}</span>}
        </li>
      ))}
    </ul>
  );
}

/** The on-site contact, access notes and source number of an Einsatzort. */
function ClientSiteMeta({
  site,
  primaryContactName,
}: {
  site: ClientSite;
  primaryContactName: string | null;
}) {
  return (
    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
      {primaryContactName && (
        <span className="inline-flex items-center gap-1">
          <Users className="size-3" />
          {primaryContactName}
        </span>
      )}
      {site.accessNotes && (
        <span className="inline-flex items-center gap-1">
          <KeyRound className="size-3" />
          {site.accessNotes}
        </span>
      )}
      {site.sourceNumber && (
        <span className="inline-flex items-center gap-1">
          <Hash className="size-3" />
          Objektnr. {site.sourceNumber}
        </span>
      )}
    </div>
  );
}

function ClientSiteRow({
  clientId,
  site,
  contactNameById,
  siteContacts,
  siteRoles,
  onOpenRoles,
  equipment,
  equipmentLoadFailed,
  isAdminOrManager,
  isPendingRow,
  onEditSite,
  onToggleSiteActive,
}: ClientSiteRowProps) {
  const address = formatSiteAddress(site);
  const primaryContactName = site.primaryContactId ? contactNameById.get(site.primaryContactId) : null;
  return (
    <li className="rounded-md border bg-background p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="font-medium">{site.name}</p>
            <InlinePending active={isPendingRow(site.id)} />
            {site.isPrimary && (
              <Badge variant="secondary" className="gap-1 text-xs">
                <Star className="size-3" />
                Hauptstandort
              </Badge>
            )}
          </div>
          {address && <p className="mt-1 text-sm text-muted-foreground">{address}</p>}
          <ClientSiteMeta site={site} primaryContactName={primaryContactName ?? null} />
          {site.notes && <p className="mt-1 text-xs text-muted-foreground">{site.notes}</p>}
          <ClientSiteContacts siteContacts={siteContacts} />
          <ClientSiteRoleSummary
            clientId={clientId}
            site={site}
            siteRoles={siteRoles}
            isAdminOrManager={isAdminOrManager}
            onOpenRoles={onOpenRoles}
          />
          {!equipmentLoadFailed && <ClientSiteEquipmentLinks siteId={site.id} equipment={equipment} />}
        </div>
        {isAdminOrManager && (
          <div className="flex shrink-0 gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="size-8 text-muted-foreground"
              title="Einsatzort bearbeiten"
              disabled={isPendingRow(site.id)}
              onClick={() => onEditSite(site)}
            >
              <Pencil className="size-3.5" />
              <span className="sr-only">Einsatzort bearbeiten</span>
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 text-muted-foreground"
              title="Einsatzort archivieren"
              disabled={isPendingRow(site.id)}
              onClick={() => onToggleSiteActive(site)}
            >
              <Archive className="size-3.5" />
              <span className="sr-only">Einsatzort archivieren</span>
            </Button>
          </div>
        )}
      </div>
    </li>
  );
}

interface ClientSitesCardProps
  extends Omit<ClientSiteRowProps, 'site' | 'contactNameById' | 'siteContacts' | 'siteRoles'> {
  clientAddress: string | null;
  /** The roles on the customer's Einsatzorte; null when they could not be read (the page shows that failure). */
  roles: ClientSiteRole[] | null;
  contacts: ClientContact[];
  activeSites: ClientSite[];
  inactiveSites: ClientSite[];
  onAddSite: () => void;
  onAdoptAddress: () => void;
}

/** The archived sites with their restore action; nothing while none is archived. */
function ClientSiteArchivedList({
  inactiveSites,
  isAdminOrManager,
  isPendingRow,
  onToggleSiteActive,
}: Pick<ClientSitesCardProps, 'inactiveSites' | 'isAdminOrManager' | 'isPendingRow' | 'onToggleSiteActive'>) {
  if (inactiveSites.length === 0) return null;
  return (
    <div className="mt-3 border-t pt-3">
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Archiviert</p>
      <ul className="space-y-1.5">
        {inactiveSites.map((site) => (
          <li
            key={site.id}
            className="flex items-center justify-between gap-3 rounded-md px-3 py-1.5 text-sm text-muted-foreground"
          >
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="truncate">
                {site.name}
                {formatSiteAddress(site) ? ` · ${formatSiteAddress(site)}` : ''}
              </span>
              <InlinePending active={isPendingRow(site.id)} />
            </span>
            {isAdminOrManager && (
              <Button
                variant="ghost"
                size="icon"
                className="size-7 text-muted-foreground"
                title="Einsatzort wiederherstellen"
                disabled={isPendingRow(site.id)}
                onClick={() => onToggleSiteActive(site)}
              >
                <ArchiveRestore className="size-3.5" />
                <span className="sr-only">Einsatzort wiederherstellen</span>
              </Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ClientSitesCard({
  clientId,
  clientAddress,
  contacts,
  roles,
  onOpenRoles,
  activeSites,
  inactiveSites,
  equipment,
  equipmentLoadFailed,
  isAdminOrManager,
  isPendingRow,
  onAddSite,
  onAdoptAddress,
  onEditSite,
  onToggleSiteActive,
}: ClientSitesCardProps) {
  const contactNameById = new Map(contacts.map((contact) => [contact.id, contact.name]));

  return (
    <div id="einsatzorte" className="scroll-mt-4 rounded-lg border bg-card p-4 sm:p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <SectionTitle icon={<MapPin className="size-4" />}>Einsatzorte</SectionTitle>
        {isAdminOrManager && (
          <Button variant="ghost" size="sm" className="h-8 gap-1 text-xs" onClick={onAddSite}>
            <Plus className="size-3.5" />
            Einsatzort hinzufügen
          </Button>
        )}
      </div>

      {equipmentLoadFailed && (
        <RegionLoadError className="mb-3">Anlagen und Geräte konnten nicht geladen werden.</RegionLoadError>
      )}

      {activeSites.length === 0 ? (
        <div className="space-y-2">
          <EmptyState size="compact" title="Noch keine Einsatzorte hinterlegt." />
          {isAdminOrManager && clientAddress && (
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={onAdoptAddress}>
              Adresse als Einsatzort übernehmen
            </Button>
          )}
        </div>
      ) : (
        <ul className="space-y-2">
          {activeSites.map((site) => (
            <ClientSiteRow
              key={site.id}
              clientId={clientId}
              site={site}
              contactNameById={contactNameById}
              siteContacts={contacts.filter((contact) => contact.isActive && contact.siteId === site.id)}
              siteRoles={roles?.filter((role) => role.siteId === site.id) ?? null}
              onOpenRoles={onOpenRoles}
              equipment={equipment}
              equipmentLoadFailed={equipmentLoadFailed}
              isAdminOrManager={isAdminOrManager}
              isPendingRow={isPendingRow}
              onEditSite={onEditSite}
              onToggleSiteActive={onToggleSiteActive}
            />
          ))}
        </ul>
      )}

      <ClientSiteArchivedList
        inactiveSites={inactiveSites}
        isAdminOrManager={isAdminOrManager}
        isPendingRow={isPendingRow}
        onToggleSiteActive={onToggleSiteActive}
      />
    </div>
  );
}
