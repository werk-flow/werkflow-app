'use client';

import Link from 'next/link';
import type { ReactElement } from 'react';
import { ArrowLeft, ExternalLink, History, Pencil, Replace } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { InlinePending } from '@/components/ui/inline-pending';
import {
  EQUIPMENT_CATEGORY_LABELS,
  EQUIPMENT_STATE_LABELS,
  EQUIPMENT_SUBTYPE_LABELS,
  type EquipmentDetail,
} from '@/lib/installed-equipment/types';
import { formatGermanMediumDateTime, parseIsoLocalDate } from '@/lib/utils';

const EVENT_LABELS: Record<string, string> = {
  registered: 'Anlage erfasst',
  details_corrected: 'Anlagendaten geändert',
  installation_recorded: 'Installation dokumentiert',
  commissioning_recorded: 'Inbetriebnahme dokumentiert',
  warranty_recorded: 'Gewährleistungsdaten geändert',
  activated: 'Aktiviert',
  inactivated: 'Vorübergehend außer Betrieb genommen',
  removed: 'Entfernt',
  replaced: 'Ersetzt',
  decommissioned: 'Stillgelegt',
  terminal_action_corrected: 'Abschlussaktion korrigiert',
  archived: 'Archiviert',
  archive_restored: 'Aus Archiv wiederhergestellt',
  work_linked: 'Arbeitsbezug hinzugefügt',
  work_unlinked: 'Arbeitsbezug entfernt',
  source_linked: 'Herkunftsnachweis verknüpft',
  document_linked: 'Dokument verknüpft',
  document_unlinked: 'Dokumentverknüpfung entfernt',
};

const equipmentDateFormat = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium' });

function formatEquipmentDate(value: string | null | undefined): string {
  if (!value) return 'Nicht erfasst';
  const date = parseIsoLocalDate(value);
  return date ? equipmentDateFormat.format(date) : value;
}

export function Fact({
  label,
  value,
  testId,
}: {
  label: string;
  value: string | null | undefined;
  testId?: string;
}): ReactElement {
  return (
    <div data-testid={testId}>
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-sm">{value || 'Nicht erfasst'}</dd>
    </div>
  );
}

type EquipmentDetailHeaderProps = {
  item: EquipmentDetail;
  headerBusy: boolean;
  canChangeState: boolean;
  onEdit: () => void;
  onReplace: () => void;
  onChangeState: () => void;
};

export function EquipmentDetailHeader({
  item,
  headerBusy,
  canChangeState,
  onEdit,
  onReplace,
  onChangeState,
}: EquipmentDetailHeaderProps): ReactElement {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <Link
          href="/service/anlagen"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Anlagen & Geräte
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <h2 className="min-w-0 break-words text-xl font-semibold">{item.name}</h2>
          <span className="rounded-md bg-muted px-2 py-1 text-xs font-medium">
            {item.archivedAt ? 'Archiviert' : EQUIPMENT_STATE_LABELS[item.state]}
          </span>
          <InlinePending active={headerBusy} label="Änderungen werden übernommen" />
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {item.equipmentNumber} · {EQUIPMENT_CATEGORY_LABELS[item.category]}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={onEdit} disabled={Boolean(item.voidedAt)}>
          <Pencil className="size-4" />
          Bearbeiten
        </Button>
        {!['replaced', 'decommissioned'].includes(item.state) && !item.archivedAt && (
          <Button type="button" variant="outline" onClick={onReplace}>
            <Replace className="size-4" />
            Ersetzen
          </Button>
        )}
        <Button type="button" onClick={onChangeState} disabled={!canChangeState}>
          Zustand ändern
        </Button>
      </div>
    </div>
  );
}

export function EquipmentDataSection({
  item,
  detailsBusy,
}: {
  item: EquipmentDetail;
  detailsBusy: boolean;
}): ReactElement {
  return (
    <section className="rounded-lg border p-4 shadow-xs">
      <div className="flex items-center gap-2">
        <h2 className="text-base font-semibold">Anlagendaten</h2>
        <InlinePending active={detailsBusy} label="Änderungen werden übernommen" />
      </div>
      <dl className="mt-4 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        <Fact label="Kategorie" value={EQUIPMENT_CATEGORY_LABELS[item.category]} />
        <Fact label="Untertyp" value={item.subtype ? EQUIPMENT_SUBTYPE_LABELS[item.subtype] : null} />
        <Fact label="Hersteller" value={item.manufacturer} testId="equipment-fact-manufacturer" />
        <Fact label="Modell" value={item.model} />
        <Fact label="Position" value={item.locationDetail} />
        <Fact label="Installation" value={formatEquipmentDate(item.installationDate)} />
        <Fact
          label="Inbetriebnahme"
          value={formatEquipmentDate(item.commissioningDate)}
          testId="equipment-fact-commissioning"
        />
        <Fact label="Gewährleistungsgeber" value={item.warrantyProvider} />
        <Fact
          label="Gewährleistungszeitraum"
          value={
            item.warrantyStartDate || item.warrantyEndDate
              ? `${formatEquipmentDate(item.warrantyStartDate)} bis ${formatEquipmentDate(item.warrantyEndDate)}`
              : null
          }
        />
      </dl>
      {item.technicalNotes && (
        <div className="mt-5 border-t pt-4">
          <Fact label="Technische Hinweise" value={item.technicalNotes} />
        </div>
      )}
    </section>
  );
}

export function EquipmentHistorySection({
  events,
  sourceBusy,
}: {
  events: EquipmentDetail['events'];
  sourceBusy: boolean;
}): ReactElement {
  return (
    <section className="rounded-lg border p-4 shadow-xs">
      <div className="flex items-center gap-2">
        <History className="size-4 text-muted-foreground" />
        <h2 className="text-base font-semibold">Servicehistorie</h2>
        <InlinePending active={sourceBusy} label="Änderungen werden übernommen" />
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Strukturierte Änderungen und exakte Bezüge, neueste zuerst.
      </p>
      <div className="mt-4 space-y-0">
        {events.map((event, index) => (
          <div key={event.id} className="relative grid grid-cols-[1rem_minmax(0,1fr)] gap-3 pb-5 last:pb-0">
            <div className="relative">
              <span className="absolute left-1/2 top-1.5 size-2 -translate-x-1/2 rounded-full bg-primary" />
              {index < events.length - 1 && (
                <span className="absolute left-1/2 top-3 h-[calc(100%+0.5rem)] w-px -translate-x-1/2 bg-border" />
              )}
            </div>
            <div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-medium">{EVENT_LABELS[event.eventType] ?? event.eventType}</h3>
                <time className="text-xs text-muted-foreground">
                  {formatGermanMediumDateTime(event.effectiveAt)}
                </time>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {event.actorName} · erfasst {formatGermanMediumDateTime(event.recordedAt)}
              </p>
              {event.reason && <p className="mt-2 text-sm">{event.reason}</p>}
              {event.links.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {event.links.map((link) =>
                    link.href ? (
                      <Link
                        key={link.id}
                        href={link.href}
                        className="inline-flex items-center gap-1 text-xs font-medium text-primary-text hover:underline"
                      >
                        {link.label}
                        <ExternalLink className="size-3" />
                      </Link>
                    ) : (
                      <span key={link.id} className="text-xs text-muted-foreground">
                        {link.label}
                      </span>
                    ),
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
