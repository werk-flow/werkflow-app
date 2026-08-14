import type { Database } from '@/lib/supabase/database.types';

export type JobParkingReason = Database['public']['Enums']['job_parking_reason'];

// Bounded operational vocabulary for WHY work is parked. Deliberately small;
// P1-14's mature blocker/readiness state machine may supersede it.
export const PARKING_REASON_LABELS: Record<JobParkingReason, string> = {
  warten_auf_kunde: 'Warten auf Kunde',
  warten_auf_material: 'Warten auf Material',
  warten_auf_freigabe: 'Warten auf Freigabe',
  kapazitaet: 'Keine Kapazität',
  sonstiges: 'Sonstiges',
};

export type JobParkingContext = {
  jobId: string;
  reason: JobParkingReason;
  note: string | null;
  responsibleEmployeeRecordId: string | null;
  responsibleName: string | null;
  nextReviewDate: string | null;
  updatedAt: string;
};

export const PARKING_ERROR_MESSAGES: Record<string, string> = {
  invalid_input: 'Die Eingaben sind unvollständig oder ungültig.',
  job_not_found: 'Der Auftrag wurde nicht gefunden.',
  job_not_parked: 'Nur geparkte Aufträge können Parkplatz-Kontext erhalten.',
  responsible_not_manager:
    'Die verantwortliche Person muss ein aktives Büro- oder Admin-Mitglied sein.',
  not_authorized: 'Keine Berechtigung für diese Aktion.',
  load_failed: 'Der Parkplatz-Kontext konnte nicht geladen werden.',
  update_failed: 'Der Parkplatz-Kontext konnte nicht gespeichert werden.',
  unexpected_error: 'Ein unerwarteter Fehler ist aufgetreten.',
};
