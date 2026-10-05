import Link from 'next/link';
import type { ReactElement } from 'react';
import { CalendarClock, ExternalLink, History, LinkIcon, MapPin, Wrench } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { InlinePending } from '@/components/ui/inline-pending';
import { ListRow } from '@/components/ui/list-row';
import {
  SERVICE_CASE_CHARGE_CONTEXT_LABELS,
  SERVICE_CASE_RELATION_LABELS,
  type ServiceCaseDetail,
  type ServiceCaseDetailWorkspace,
} from '@/lib/service-cases/types';
import { formatGermanMediumDateTime } from '@/lib/utils';

const EVENT_LABELS: Record<string, string> = {
  created: 'Servicefall erfasst',
  triage_updated: 'Einschätzung geändert',
  status_changed: 'Status geändert',
  job_linked: 'Auftrag verknüpft',
  job_unlinked: 'Auftragsverknüpfung entfernt',
  equipment_links_updated: 'Betroffene Anlagen geändert',
  relation_linked: 'Zusammenhang verknüpft',
  evidence_linked: 'Arbeitsnachweis verknüpft',
  document_linked: 'Dokument verknüpft',
  document_unlinked: 'Dokumentverknüpfung entfernt',
};

function Fact({ label, value }: { label: string; value: string | null | undefined }): ReactElement {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-1 whitespace-pre-wrap text-sm">{value || 'Nicht erfasst'}</dd>
    </div>
  );
}

export function ServiceCaseOriginSection({ item }: { item: ServiceCaseDetail }): ReactElement {
  return (
    <section className="rounded-lg border p-4 shadow-xs">
      <h2 className="text-base font-semibold">Ursprüngliche Kundenaussage</h2>
      <blockquote className="mt-3 whitespace-pre-wrap border-l-2 border-primary pl-3 text-sm">
        {item.originalStatement}
      </blockquote>
      {item.originalDetails && (
        <p className="mt-3 whitespace-pre-wrap text-sm text-muted-foreground">{item.originalDetails}</p>
      )}
      {item.sourceRequestId && (
        <Link
          href={`/anfragen/${item.sourceRequestId}`}
          className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-primary-text hover:underline"
        >
          Ursprüngliche Anfrage öffnen
          <ExternalLink className="size-3" />
        </Link>
      )}
    </section>
  );
}

export function ServiceCaseTriageSection({ item }: { item: ServiceCaseDetail }): ReactElement {
  return (
    <section className="rounded-lg border p-4 shadow-xs">
      <h2 className="text-base font-semibold">Einschätzung</h2>
      <dl className="mt-4 grid gap-4 sm:grid-cols-2">
        <Fact
          label="Vorläufiger Kostenkontext"
          value={SERVICE_CASE_CHARGE_CONTEXT_LABELS[item.chargeContext]}
        />
        <Fact label="Zugang und Hinweise vor Ort" value={item.accessInstructions} />
        <div className="sm:col-span-2">
          <Fact label="Interne Einschätzung" value={item.triageNote} />
        </div>
        {item.resolutionNote && (
          <div className="sm:col-span-2">
            <Fact label="Abschlussbegründung" value={item.resolutionNote} />
          </div>
        )}
      </dl>
      <p className="mt-4 rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
        Diese Einordnung dient nur der Einsatzplanung. Sie ist keine rechtliche Gewährleistungs- oder
        endgültige Kostenentscheidung.
      </p>
    </section>
  );
}

export function ServiceCaseRelationsSection({
  workspace,
  isStale,
  busy,
  onLinkClick,
}: {
  workspace: ServiceCaseDetailWorkspace;
  isStale: boolean;
  busy: boolean;
  onLinkClick: () => void;
}): ReactElement {
  const item = workspace.serviceCase;
  return (
    <section className="rounded-lg border p-4 shadow-xs" data-testid="service-case-relations">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Zusammenhänge</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Duplikate und Folgefälle bleiben als eigene Vorgänge erhalten.
          </p>
        </div>
        <span className="flex items-center gap-2">
          <InlinePending active={busy} label="Änderungen werden übernommen" />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onLinkClick}
            disabled={isStale || workspace.relatedCases.length === 0}
          >
            <LinkIcon className="size-4" />
            Verknüpfen
          </Button>
        </span>
      </div>
      {item.relations.length ? (
        <div className="mt-3 space-y-2">
          {item.relations.map((relation) => (
            <ListRow key={relation.id} asChild interactive className="text-sm">
              <Link href={`/service/faelle/${relation.relatedCaseNumber}`}>
                <span className="min-w-0">
                  <span className="block font-medium">
                    {SERVICE_CASE_RELATION_LABELS[relation.relationType]} {relation.relatedCaseNumber}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {relation.relatedSummary} · {relation.reason}
                  </span>
                </span>
                <ExternalLink className="size-4 shrink-0" />
              </Link>
            </ListRow>
          ))}
        </div>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">Noch keine verwandten Servicefälle.</p>
      )}
    </section>
  );
}

export function ServiceCaseHistorySection({ item }: { item: ServiceCaseDetail }): ReactElement {
  return (
    <section className="rounded-lg border p-4 shadow-xs">
      <div className="flex items-center gap-2">
        <History className="size-4 text-muted-foreground" />
        <h2 className="text-base font-semibold">Verlauf</h2>
      </div>
      <div className="mt-4 divide-y">
        {item.events.map((event) => (
          <div key={event.id} className="py-3 first:pt-0 last:pb-0">
            <div className="flex items-start justify-between gap-3">
              <span className="text-sm font-medium">{EVENT_LABELS[event.eventType] ?? event.eventType}</span>
              <time className="text-xs text-muted-foreground">
                {formatGermanMediumDateTime(event.recordedAt)}
              </time>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {event.actorName}
              {event.reason ? ` · ${event.reason}` : ''}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

export function ServiceCaseDetailSidebar({
  workspace,
  isStale,
  onFollowUpClick,
}: {
  workspace: ServiceCaseDetailWorkspace;
  isStale: boolean;
  onFollowUpClick: () => void;
}): ReactElement {
  const item = workspace.serviceCase;
  return (
    <aside className="space-y-4">
      <section className="rounded-lg border p-4 shadow-xs">
        <h2 className="text-base font-semibold">Kunde & Einsatzort</h2>
        <Link
          href={`/kunden/${item.clientId}`}
          className="mt-3 block font-medium text-primary-text hover:underline"
        >
          {item.clientName}
        </Link>
        <p className="mt-2 flex items-start gap-2 text-sm text-muted-foreground">
          <MapPin className="mt-0.5 size-4 shrink-0" />
          <span>
            {item.siteName}
            <br />
            {item.siteAddress}
          </span>
        </p>
        {item.contactName && <p className="mt-2 text-sm">Ansprechpartner: {item.contactName}</p>}
      </section>
      <section className="rounded-lg border p-4 shadow-xs">
        <h2 className="text-base font-semibold">Betroffene Anlagen</h2>
        {item.equipment.length ? (
          <div className="mt-3 space-y-2">
            {item.equipment.map((equipment) => (
              <ListRow key={equipment.id} asChild interactive className="text-sm">
                <Link href={`/service/anlagen/${equipment.equipmentNumber}`}>
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{equipment.name}</span>
                    <span className="text-xs text-muted-foreground">{equipment.equipmentNumber}</span>
                  </span>
                  <Wrench className="size-4 shrink-0" />
                </Link>
              </ListRow>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">Noch keine Anlage zugeordnet.</p>
        )}
      </section>
      <section className="rounded-lg border p-4 shadow-xs">
        <h2 className="text-base font-semibold">Operativer Auftrag</h2>
        {item.jobId ? (
          <Button asChild variant="outline" className="mt-3 w-full">
            <Link href={`/auftraege/${encodeURIComponent(item.jobNumber ?? item.jobId)}`}>
              {item.jobNumber ?? 'Auftrag öffnen'}
              <ExternalLink className="size-4" />
            </Link>
          </Button>
        ) : (
          <>
            <p className="mt-2 text-sm text-muted-foreground">
              Lege den Auftrag im bestehenden Auftragsbereich an und ordne ihn anschließend hier zu.
            </p>
            <Button asChild variant="outline" className="mt-3 w-full">
              <Link href="/auftraege/neu">Auftrag anlegen</Link>
            </Button>
          </>
        )}
      </section>
      <section className="rounded-lg border p-4 shadow-xs" data-testid="service-case-follow-up">
        <h2 className="text-base font-semibold">Nächster Schritt</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Plane eine Büro-, Gewährleistungs- oder Kundenrückfrage als bestehende Nachfassaktion.
        </p>
        <Button
          type="button"
          variant="outline"
          className="mt-3 w-full"
          onClick={onFollowUpClick}
          disabled={isStale || workspace.followUpOwners.length === 0}
        >
          <CalendarClock className="size-4" />
          Nachfassaktion anlegen
        </Button>
      </section>
    </aside>
  );
}
