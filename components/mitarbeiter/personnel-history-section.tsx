'use client';

import { History } from 'lucide-react';

import type { EmployeeRecordEvent } from '@/lib/personnel/types';

const EVENT_LABELS: Record<string, string> = {
  created: 'Personalakte angelegt',
  master_data_updated: 'Personalien geändert',
  condition_added: 'Kondition hinzugefügt',
  condition_updated: 'Kondition geändert',
  condition_deleted: 'Kondition gelöscht',
  invite_connected: 'Einladung versendet',
  login_linked: 'Zugang verknüpft',
  membership_removed: 'Aus der Organisation entfernt',
};

function formatTimestamp(value: string): string {
  return new Date(value).toLocaleString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

interface PersonnelHistorySectionProps {
  events: EmployeeRecordEvent[];
  actorNames: Record<string, string>;
}

export function PersonnelHistorySection({
  events,
  actorNames,
}: PersonnelHistorySectionProps) {
  return (
    <div className="rounded-lg border bg-card p-3 sm:p-4">
      <h3 className="mb-3 flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        <History className="size-4" />
        Verlauf
      </h3>
      {events.length === 0 ? (
        <p className="py-3 text-sm text-muted-foreground">
          Noch keine Änderungen festgehalten.
        </p>
      ) : (
        <ul className="grid gap-2">
          {events.map((event) => {
            const actor = event.createdBy
              ? actorNames[event.createdBy]
              : undefined;
            return (
              <li key={event.id} className="text-sm">
                <span className="font-medium">
                  {EVENT_LABELS[event.eventType] ?? event.eventType}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {formatTimestamp(event.createdAt)}
                  {actor ? ` · ${actor}` : ''}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
