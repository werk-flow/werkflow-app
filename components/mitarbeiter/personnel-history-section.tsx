'use client';

import { History } from 'lucide-react';

import {
  EMPLOYMENT_TYPE_LABELS,
  type EmployeeRecordEvent,
  type EmploymentType,
} from '@/lib/personnel/types';

const EVENT_LABELS: Record<string, string> = {
  created: 'Personalakte angelegt',
  master_data_updated: 'Personalien geändert',
  condition_added: 'Kondition hinzugefügt',
  condition_updated: 'Kondition geändert',
  condition_deleted: 'Kondition gelöscht',
  schedule_added: 'Wochenplan hinzugefügt',
  schedule_updated: 'Wochenplan geändert',
  schedule_deleted: 'Wochenplan gelöscht',
  invite_connected: 'Einladung versendet',
  login_linked: 'Zugang verknüpft',
  membership_removed: 'Aus der Organisation entfernt',
};

const FIELD_LABELS: Record<string, string> = {
  employee_number: 'Personalnummer',
  first_name: 'Vorname',
  last_name: 'Nachname',
  phone: 'Telefon',
  private_email: 'Private E-Mail',
  street: 'Straße',
  postal_code: 'PLZ',
  city: 'Ort',
  emergency_contact_name: 'Notfallkontakt',
  emergency_contact_phone: 'Notfallkontakt Telefon',
  entry_date: 'Eintrittsdatum',
  exit_date: 'Austrittsdatum',
  notes: 'Notizen',
  valid_from: 'Gültig ab',
  employment_type: 'Beschäftigungsart',
  weekly_hours: 'Wochenstunden',
  vacation_days_per_year: 'Urlaubstage pro Jahr',
  note: 'Notiz',
};

const DATE_FIELDS = new Set(['entry_date', 'exit_date', 'valid_from']);

type HistoryDetail = {
  field: string;
  label: string;
  before: unknown;
  after: unknown;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function formatValue(field: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (field === 'employment_type' && typeof value === 'string') {
    return EMPLOYMENT_TYPE_LABELS[value as EmploymentType] ?? value;
  }
  if (DATE_FIELDS.has(field) && typeof value === 'string') {
    const date = new Date(
      /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00` : value
    );
    return Number.isNaN(date.getTime())
      ? value
      : date.toLocaleDateString('de-DE', { timeZone: 'Europe/Berlin' });
  }
  if (typeof value === 'boolean') return value ? 'Ja' : 'Nein';
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value.toLocaleString('de-DE') : '—';
  }
  return String(value);
}

function detailsFromValues(
  before: Record<string, unknown>,
  after: Record<string, unknown>
): HistoryDetail[] {
  return Object.keys({ ...before, ...after })
    .filter(
      (field) =>
        FIELD_LABELS[field] &&
        formatValue(field, before[field]) !== formatValue(field, after[field])
    )
    .map((field) => ({
      field,
      label: FIELD_LABELS[field],
      before: before[field],
      after: after[field],
    }));
}

function historyDetails(event: EmployeeRecordEvent): HistoryDetail[] {
  const payload = event.eventPayload;
  if (isObject(payload.changes)) {
    return Object.entries(payload.changes).flatMap(([field, change]) =>
      FIELD_LABELS[field] &&
      isObject(change) &&
      formatValue(field, change.from) !== formatValue(field, change.to)
        ? [
            {
              field,
              label: FIELD_LABELS[field],
              before: change.from,
              after: change.to,
            },
          ]
        : []
    );
  }
  if (isObject(payload.before) && isObject(payload.after)) {
    return detailsFromValues(payload.before, payload.after);
  }
  if (isObject(payload.deleted)) {
    return detailsFromValues(payload.deleted, {});
  }
  if (event.eventType === 'created' || event.eventType.endsWith('_added')) {
    return detailsFromValues({}, payload);
  }
  return [];
}

function formatTimestamp(value: string): string {
  // Pin the timezone so server-side rendering (UTC) and every browser agree.
  return new Date(value).toLocaleString('de-DE', {
    timeZone: 'Europe/Berlin',
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
            const details = historyDetails(event);
            return (
              <li key={event.id} className="text-sm">
                <span className="font-medium">
                  {EVENT_LABELS[event.eventType] ?? event.eventType}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {formatTimestamp(event.createdAt)}
                  {actor ? ` · ${actor}` : ''}
                </span>
                {details.length > 0 ? (
                  <ul className="mt-1 grid gap-0.5 text-xs text-muted-foreground">
                    {details.map((detail) => (
                      <li key={detail.label}>
                        <span className="font-medium text-foreground">
                          {detail.label}:
                        </span>{' '}
                        {formatValue(detail.field, detail.before)} →{' '}
                        {formatValue(detail.field, detail.after)}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
