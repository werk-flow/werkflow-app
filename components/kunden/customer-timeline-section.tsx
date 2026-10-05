'use client';

import Link from 'next/link';
import { Clock3, ExternalLink, Filter, History, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PlainButton } from '@/components/ui/plain-button';
import type { TimelineItem } from '@/lib/customer-relationships/types';
import type { TimelineFilter } from './use-customer-timeline';
import type { FollowUpSource } from './use-follow-up-editor';
import { formatBerlinDateTime } from '@/lib/utils';

const TIMELINE_LABELS: Record<TimelineItem['kind'], string> = {
  customer_created: 'Kunde angelegt',
  contact_created: 'Ansprechpartner angelegt',
  site_created: 'Einsatzort angelegt',
  request_received: 'Anfrage eingegangen',
  request_event: 'Anfrage aktualisiert',
  request_closed: 'Anfrage abgeschlossen',
  request_converted: 'Anfrage in Arbeit überführt',
  job_created: 'Auftrag angelegt',
  project_created: 'Projekt angelegt',
  document_linked: 'Dokument verknüpft',
  follow_up_event: 'Nachfassaktion geändert',
  communication_preference_event: 'Kontaktvorgabe geändert',
};

function sourceForTimelineItem(item: TimelineItem): FollowUpSource | null {
  if (item.kind === 'contact_created') {
    return { type: 'contact', id: item.sourceId, label: item.reference };
  }
  if (item.kind === 'site_created') {
    return { type: 'site', id: item.sourceId, label: item.reference };
  }
  if (
    item.kind === 'request_received' ||
    item.kind === 'request_closed' ||
    item.kind === 'request_converted'
  ) {
    return { type: 'request', id: item.sourceId, label: item.reference };
  }
  if (item.kind === 'job_created') {
    return { type: 'job', id: item.sourceId, label: item.reference };
  }
  if (item.kind === 'project_created') {
    return { type: 'project', id: item.sourceId, label: item.reference };
  }
  return null;
}

interface CustomerTimelineSectionProps {
  visibleTimeline: TimelineItem[];
  timelineFilter: TimelineFilter;
  /** Set while older entries exist on the server. */
  olderTimelineCursor: string | null;
  isPending: boolean;
  onTimelineFilterChange: (filter: TimelineFilter) => void;
  onLoadOlder: (cursor: string) => void;
  onFollowUp: (source: FollowUpSource) => void;
}

export function CustomerTimelineSection({
  visibleTimeline,
  timelineFilter,
  olderTimelineCursor,
  isPending,
  onTimelineFilterChange,
  onLoadOlder,
  onFollowUp,
}: CustomerTimelineSectionProps) {
  return (
    <section className="space-y-3" aria-labelledby="timeline-heading">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 id="timeline-heading" className="flex items-center gap-2 text-sm font-semibold">
            <History className="size-4 text-muted-foreground" />
            Kundenhistorie
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Verknüpfte Quelldatensätze und nachvollziehbare Änderungen – keine Kopien.
          </p>
        </div>
        <div role="group" className="flex items-center gap-1" aria-label="Kundenhistorie filtern">
          <Filter className="mr-1 size-3.5 text-muted-foreground" />
          {(
            [
              ['all', 'Alle'],
              ['work', 'Arbeit'],
              ['documents', 'Dokumente'],
              ['internal', 'Intern'],
            ] as const
          ).map(([value, label]) => (
            <Button
              key={value}
              variant={timelineFilter === value ? 'secondary' : 'ghost'}
              size="sm"
              className="h-8"
              aria-pressed={timelineFilter === value}
              onClick={() => onTimelineFilterChange(value)}
            >
              {label}
            </Button>
          ))}
        </div>
      </div>

      {visibleTimeline.length === 0 ? (
        <p className="rounded-md border border-dashed px-3 py-4 text-sm text-muted-foreground">
          Für diesen Filter sind noch keine Einträge vorhanden.
        </p>
      ) : (
        <ol className="divide-y rounded-lg border bg-card" data-testid="customer-timeline">
          {visibleTimeline.map((item) => {
            const followUpSource = sourceForTimelineItem(item);
            return (
              <li key={item.stableKey} className="flex gap-3 px-4 py-3" data-timeline-key={item.stableKey}>
                <Clock3 className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium">{TIMELINE_LABELS[item.kind]}</p>
                    <time className="text-xs tabular-nums text-muted-foreground" dateTime={item.occurredAt}>
                      {formatBerlinDateTime(item.occurredAt)}
                    </time>
                  </div>
                  <p className="mt-0.5 text-sm text-muted-foreground">{item.reference}</p>
                  {item.detail && <p className="mt-0.5 text-xs text-muted-foreground">{item.detail}</p>}
                  <p className="mt-1 text-xs text-muted-foreground">
                    {item.actorName ?? 'Nicht erfasst'}
                    {item.currentStateOnly ? ' · aktueller Quelldatensatz' : ''}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-3">
                    {item.sourceHref && item.sourceAvailable ? (
                      <Link
                        href={item.sourceHref}
                        className="inline-flex items-center gap-1 text-xs text-primary-text hover:underline"
                      >
                        Quelle öffnen <ExternalLink className="size-3" />
                      </Link>
                    ) : (
                      <span className="text-xs text-muted-foreground">Quelle nicht mehr verfügbar</span>
                    )}
                    {followUpSource && (
                      <PlainButton
                        type="button"
                        className="text-xs text-primary-text hover:underline"
                        onClick={() => onFollowUp(followUpSource)}
                      >
                        Hierzu nachfassen
                      </PlainButton>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {olderTimelineCursor && (
        <div className="space-y-2">
          {timelineFilter !== 'all' && (
            <p className="text-xs text-muted-foreground">
              Der Filter gilt für die bisher geladenen Einträge. Lade ältere Einträge, um weiter
              zurückzusuchen.
            </p>
          )}
          <Button
            variant="outline"
            size="sm"
            disabled={isPending}
            onClick={() => onLoadOlder(olderTimelineCursor)}
          >
            {isPending && <Loader2 className="size-3.5 animate-spin" />}
            Ältere Einträge laden
          </Button>
        </div>
      )}
    </section>
  );
}
