'use client';

import Link from 'next/link';
import { Archive, ArchiveRestore, KeyRound, MapPin, Pencil, Plus, Star, Users, Wrench } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { InlinePending } from '@/components/ui/inline-pending';
import { formatSiteAddress, type ClientContact, type ClientSite } from '@/lib/clients/types';
import { EQUIPMENT_STATE_LABELS, type EquipmentListItem } from '@/lib/installed-equipment/types';
import { RegionLoadError } from '@/components/shared/region-load-error';
import { SectionTitle } from '@/components/shared/section-title';

interface ClientSiteRowProps {
  site: ClientSite;
  contactNameById: ReadonlyMap<string, string>;
  equipment: EquipmentListItem[];
  equipmentLoadFailed: boolean;
  isAdminOrManager: boolean;
  isPendingRow: (id: string) => boolean;
  onEditSite: (site: ClientSite) => void;
  onToggleSiteActive: (site: ClientSite) => void;
}

function ClientSiteRow({
  site,
  contactNameById,
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
          </div>
          {site.notes && <p className="mt-1 text-xs text-muted-foreground">{site.notes}</p>}
          {!equipmentLoadFailed && equipment.some((item) => item.siteId === site.id && !item.archivedAt) && (
            <div className="mt-3 border-t pt-3">
              <p className="mb-2 flex items-center gap-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <Wrench className="size-3" />
                Anlagen & Geräte
              </p>
              <div className="flex flex-wrap gap-2">
                {equipment
                  .filter((item) => item.siteId === site.id && !item.archivedAt)
                  .map((item) => (
                    <Link
                      key={item.id}
                      href={`/service/anlagen/${encodeURIComponent(item.equipmentNumber)}`}
                      className="rounded-md border px-2.5 py-1.5 text-xs transition-colors hover:bg-muted/50"
                    >
                      <span className="font-medium">{item.name}</span>
                      <span className="ml-1 text-muted-foreground">
                        · {EQUIPMENT_STATE_LABELS[item.state]}
                      </span>
                    </Link>
                  ))}
              </div>
            </div>
          )}
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

interface ClientSitesCardProps extends Omit<ClientSiteRowProps, 'site' | 'contactNameById'> {
  clientAddress: string | null;
  contacts: ClientContact[];
  activeSites: ClientSite[];
  inactiveSites: ClientSite[];
  onAddSite: () => void;
  onAdoptAddress: () => void;
}

export function ClientSitesCard({
  clientAddress,
  contacts,
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
        <div className="rounded-md border border-dashed bg-muted/20 px-3 py-4 text-center">
          <p className="text-sm text-muted-foreground">Noch keine Einsatzorte hinterlegt.</p>
          {isAdminOrManager && clientAddress && (
            <Button variant="outline" size="sm" className="mt-2 h-8 text-xs" onClick={onAdoptAddress}>
              Adresse als Einsatzort übernehmen
            </Button>
          )}
        </div>
      ) : (
        <ul className="space-y-2">
          {activeSites.map((site) => (
            <ClientSiteRow
              key={site.id}
              site={site}
              contactNameById={contactNameById}
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

      {inactiveSites.length > 0 && (
        <div className="mt-3 border-t pt-3">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground/70">
            Archiviert
          </p>
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
      )}
    </div>
  );
}
