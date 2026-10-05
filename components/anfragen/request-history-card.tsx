import { History } from 'lucide-react';

import { formatGermanDateTime as formatDateTime } from '@/lib/utils';
import type { RequestEventEntry } from './request-detail-content';
import { SectionTitle } from '@/components/shared/section-title';

const EVENT_LABELS: Record<string, string> = {
  created: 'Anfrage erfasst',
  updated: 'Anfrage bearbeitet',
  status_changed: 'Status geändert',
  matched: 'Kunde zugeordnet',
  promoted: 'Als neuer Kunde angelegt',
  converted_to_service_case: 'Als Servicefall übernommen',
  converted: 'Umgewandelt',
  closed: 'Geschlossen',
  reopened: 'Wieder geöffnet',
};

// `event_type` is free text; an event without a label reads as a neutral
// entry, never as its code.
const UNKNOWN_EVENT_LABEL = 'Änderung dokumentiert';

export function RequestHistoryCard({ events }: { events: RequestEventEntry[] }) {
  return (
    <div className="rounded-lg border bg-card p-4 sm:p-5">
      <SectionTitle as="h2" icon={<History className="size-4" />}>
        Verlauf
      </SectionTitle>
      {events.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">Noch keine Einträge.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {events.map((event) => (
            <li key={event.id} className="flex items-baseline gap-2 text-sm">
              <span className="shrink-0 font-mono text-xs text-muted-foreground">
                {formatDateTime(event.createdAt)}
              </span>
              <span>
                {EVENT_LABELS[event.eventType] ?? UNKNOWN_EVENT_LABEL}
                {event.actorName ? <span className="text-muted-foreground"> · {event.actorName}</span> : null}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
