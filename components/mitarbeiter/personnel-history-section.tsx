'use client';

import { History } from 'lucide-react';

import { employmentTypeLabel, type EmployeeRecordEvent } from '@/lib/personnel/types';
import { isJsonRecord } from '@/lib/supabase/json';
import { RegionLoadError } from '@/components/shared/region-load-error';
import { SectionTitle } from '@/components/shared/section-title';
import { EmptyState } from '@/components/ui/empty-state';
import { formatBerlin, formatBerlinDateTime } from '@/lib/utils';

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
  access_transition: 'Zugang geändert',
  employment_transition: 'Beschäftigungsstatus geändert',
  onboarding_plan_created: 'Einarbeitungsplan angelegt',
  onboarding_requirement_saved: 'Einarbeitungspunkt aktualisiert',
  personnel_document_classified: 'Personaldokument eingeordnet',
  personnel_document_uploaded: 'Personaldokument hochgeladen',
  personnel_acknowledged: 'Kenntnisnahme bestätigt',
};

// `event_type` is free text that database functions also write; an event
// without a label reads as a neutral entry, never as its code.
const UNKNOWN_EVENT_LABEL = 'Änderung dokumentiert';

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

function formatValue(field: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (field === 'employment_type' && typeof value === 'string') {
    return employmentTypeLabel(value);
  }
  if (DATE_FIELDS.has(field) && typeof value === 'string') {
    return Number.isNaN(new Date(value).getTime()) ? value : formatBerlin(value, 'numericDate');
  }
  if (typeof value === 'boolean') return value ? 'Ja' : 'Nein';
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value.toLocaleString('de-DE') : '—';
  }
  return String(value);
}

function detailsFromValues(before: Record<string, unknown>, after: Record<string, unknown>): HistoryDetail[] {
  return Object.keys({ ...before, ...after }).flatMap((field) => {
    const label = FIELD_LABELS[field];
    if (!label || formatValue(field, before[field]) === formatValue(field, after[field])) {
      return [];
    }
    return [{ field, label, before: before[field], after: after[field] }];
  });
}

function historyDetails(event: EmployeeRecordEvent): HistoryDetail[] {
  const payload = event.eventPayload;
  if (isJsonRecord(payload.changes)) {
    return Object.entries(payload.changes).flatMap(([field, change]) =>
      FIELD_LABELS[field] &&
      isJsonRecord(change) &&
      formatValue(field, change.from) !== formatValue(field, change.to)
        ? [
            {
              field,
              label: FIELD_LABELS[field],
              before: change.from,
              after: change.to,
            },
          ]
        : [],
    );
  }
  if (isJsonRecord(payload.before) && isJsonRecord(payload.after)) {
    return detailsFromValues(payload.before, payload.after);
  }
  if (isJsonRecord(payload.deleted)) {
    return detailsFromValues(payload.deleted, {});
  }
  if (event.eventType === 'created' || event.eventType.endsWith('_added')) {
    return detailsFromValues({}, payload);
  }
  return [];
}

interface PersonnelHistorySectionProps {
  events: EmployeeRecordEvent[];
  /** Null when the names could not be read. */
  actorNames: Record<string, string> | null;
}

export function PersonnelHistorySection({ events, actorNames }: PersonnelHistorySectionProps) {
  return (
    <div className="rounded-lg border bg-card p-3 sm:p-4">
      <SectionTitle icon={<History className="size-4" />} className="mb-3">
        Verlauf
      </SectionTitle>
      {actorNames === null && events.length > 0 ? (
        <RegionLoadError className="mb-3">
          Wer die Änderungen vorgenommen hat, konnte gerade nicht geladen werden.
        </RegionLoadError>
      ) : null}
      {events.length === 0 ? (
        <EmptyState size="compact" className="py-3" title="Noch keine Änderungen festgehalten." />
      ) : (
        <ul className="grid gap-2">
          {events.map((event) => {
            const actor = event.createdBy ? actorNames?.[event.createdBy] : undefined;
            const details = historyDetails(event);
            return (
              <li key={event.id} className="text-sm">
                <span className="font-medium">{EVENT_LABELS[event.eventType] ?? UNKNOWN_EVENT_LABEL}</span>
                <span className="block text-xs text-muted-foreground">
                  {formatBerlinDateTime(event.createdAt)}
                  {actor ? ` · ${actor}` : ''}
                </span>
                {details.length > 0 ? (
                  <ul className="mt-1 grid gap-0.5 text-xs text-muted-foreground">
                    {details.map((detail) => (
                      <li key={detail.label}>
                        <span className="font-medium text-foreground">{detail.label}:</span>{' '}
                        {formatValue(detail.field, detail.before)} → {formatValue(detail.field, detail.after)}
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
