'use client';

import Link from 'next/link';
import type { ReactElement } from 'react';
import { ArrowRight, ExternalLink, LinkIcon, Loader2, MapPin, RefreshCw, Unlink } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { InlinePending } from '@/components/ui/inline-pending';
import { ListRow } from '@/components/ui/list-row';
import { setInstalledEquipmentWorkLink } from '@/lib/installed-equipment/actions';
import { EQUIPMENT_IDENTIFIER_TYPE_LABELS, type EquipmentDetail } from '@/lib/installed-equipment/types';
import { Fact } from './equipment-detail-sections';
import type { EquipmentDetailActions } from './use-equipment-detail-actions';

function EquipmentClientSection({ item }: { item: EquipmentDetail }): ReactElement {
  return (
    <section className="rounded-lg border p-4 shadow-xs">
      <h2 className="text-base font-semibold">Kunde & Einsatzort</h2>
      <ListRow asChild interactive className="mt-3">
        <Link href={`/kunden/${encodeURIComponent(item.clientId)}`}>
          <span className="min-w-0">
            <span className="block text-sm font-medium">{item.clientName}</span>
            <span className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
              <MapPin className="size-3" />
              {item.siteName}
            </span>
            <span className="mt-1 block text-xs text-muted-foreground">{item.siteAddress}</span>
          </span>
        </Link>
      </ListRow>
    </section>
  );
}

function EquipmentIdentifiersSection({ item }: { item: EquipmentDetail }): ReactElement {
  return (
    <section className="rounded-lg border p-4 shadow-xs">
      <h2 className="text-base font-semibold">Kennungen</h2>
      {item.identifiers.length ? (
        <dl className="mt-3 space-y-3">
          {item.identifiers.map((identifier) => (
            <Fact
              key={identifier.id}
              label={EQUIPMENT_IDENTIFIER_TYPE_LABELS[identifier.identifierType]}
              value={identifier.issuer ? `${identifier.value} · ${identifier.issuer}` : identifier.value}
            />
          ))}
        </dl>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">Keine Kennung erfasst.</p>
      )}
    </section>
  );
}

function EquipmentRelationsSection({ item }: { item: EquipmentDetail }): ReactElement {
  return (
    <section className="rounded-lg border p-4 shadow-xs">
      <h2 className="text-base font-semibold">Anlagenbeziehungen</h2>
      <div className="mt-3 space-y-2">
        {item.parent && (
          <ListRow asChild interactive className="text-sm">
            <Link href={`/service/anlagen/${item.parent.equipmentNumber}`}>
              <span>Übergeordnet: {item.parent.name}</span>
              <ArrowRight className="size-4" />
            </Link>
          </ListRow>
        )}
        {item.components.map((component) => (
          <ListRow key={component.id} asChild interactive className="text-sm">
            <Link href={`/service/anlagen/${component.equipmentNumber}`}>
              <span>Komponente: {component.name}</span>
              <ArrowRight className="size-4" />
            </Link>
          </ListRow>
        ))}
        {item.predecessor && (
          <ListRow asChild interactive className="text-sm">
            <Link href={`/service/anlagen/${item.predecessor.equipmentNumber}`}>
              <span>Vorgänger: {item.predecessor.name}</span>
              <ArrowRight className="size-4" />
            </Link>
          </ListRow>
        )}
        {item.successor && (
          <ListRow asChild interactive className="text-sm">
            <Link href={`/service/anlagen/${item.successor.equipmentNumber}`}>
              <span>Nachfolger: {item.successor.name}</span>
              <ArrowRight className="size-4" />
            </Link>
          </ListRow>
        )}
      </div>
    </section>
  );
}

function EquipmentWorkLinksSection({
  actions,
  onOpenWorkLink,
}: {
  actions: EquipmentDetailActions;
  onOpenWorkLink: () => void;
}): ReactElement {
  const { busy, item, perform } = actions;
  const workBusy =
    busy.isBusy('work-link') || item.workLinks.some((link) => busy.isBusy(`unlink:${link.id}`));
  // A removed link leaves the list at once. Its scope stays busy until the
  // live read confirms it; a refusal ends the scope and the row returns
  // with the reason.
  const shownWorkLinks = item.workLinks.filter((link) => !busy.isBusy(`unlink:${link.id}`));
  return (
    <section className="rounded-lg border p-4 shadow-xs">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold">Verknüpfte Arbeit</h2>
        <span className="flex items-center gap-2">
          <InlinePending active={workBusy} label="Änderungen werden übernommen" />
          <Button type="button" variant="ghost" size="sm" onClick={onOpenWorkLink}>
            <LinkIcon className="size-4" />
            Verknüpfen
          </Button>
        </span>
      </div>
      {shownWorkLinks.length > 0 ? (
        <div className="mt-3 space-y-2">
          {shownWorkLinks.map((link) => (
            <div key={link.id} className="flex items-center gap-1">
              <ListRow asChild interactive className="min-w-0 flex-1 text-sm">
                <Link href={link.href}>
                  <span className="truncate">{link.label}</span>
                  <ExternalLink className="size-4 shrink-0" />
                </Link>
              </ListRow>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Verknüpfung ${link.label} entfernen`}
                disabled={workBusy}
                onClick={() =>
                  perform(`unlink:${link.id}`, () =>
                    setInstalledEquipmentWorkLink({
                      equipmentId: item.id,
                      expectedVersion: item.version,
                      jobId: link.jobId,
                      projectId: link.projectId,
                      linked: false,
                      reason: 'Verknüpfung entfernt',
                      idempotencyKey: crypto.randomUUID(),
                    }),
                  )
                }
              >
                <Unlink className="size-4" />
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">Noch kein Auftrag oder Projekt verknüpft.</p>
      )}
    </section>
  );
}

type EquipmentDetailSidebarProps = {
  actions: EquipmentDetailActions;
  canCorrectTerminalAction: boolean;
  onOpenWorkLink: () => void;
  onOpenSource: () => void;
  onOpenCorrection: () => void;
  onOpenArchive: () => void;
};

/** Right column of the equipment detail page: context cards and the secondary actions. */
export function EquipmentDetailSidebar({
  actions,
  canCorrectTerminalAction,
  onOpenWorkLink,
  onOpenSource,
  onOpenCorrection,
  onOpenArchive,
}: EquipmentDetailSidebarProps): ReactElement {
  const { busy, item } = actions;
  return (
    <aside className="space-y-6">
      <EquipmentClientSection item={item} />
      <EquipmentIdentifiersSection item={item} />
      {(item.parent || item.components.length || item.predecessor || item.successor) && (
        <EquipmentRelationsSection item={item} />
      )}
      <EquipmentWorkLinksSection actions={actions} onOpenWorkLink={onOpenWorkLink} />
      <Button
        type="button"
        variant="outline"
        className="w-full"
        onClick={onOpenSource}
        disabled={busy.isBusy('source-options')}
      >
        {busy.isBusy('source-options') ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <LinkIcon className="size-4" />
        )}
        Herkunftsnachweis verknüpfen
      </Button>
      {canCorrectTerminalAction && (
        <Button type="button" variant="outline" className="w-full" onClick={onOpenCorrection}>
          <RefreshCw className="size-4" />
          Abschlussaktion korrigieren
        </Button>
      )}
      <Button
        type="button"
        variant="ghost"
        className="w-full text-muted-foreground"
        onClick={onOpenArchive}
        disabled={!item.archivedAt && !['removed', 'replaced', 'decommissioned'].includes(item.state)}
      >
        {item.archivedAt ? 'Aus Archiv wiederherstellen' : 'Archivieren'}
      </Button>
    </aside>
  );
}
