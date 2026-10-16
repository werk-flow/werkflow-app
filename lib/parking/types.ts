import type { Database } from '@/lib/supabase/database.types';
import { WORK_BLOCKER_REASON_LABELS } from '@/lib/work-lifecycle/types';

export type JobParkingReason = Database['public']['Enums']['work_blocker_reason'];

export const PARKING_REASON_LABELS: Record<JobParkingReason, string> = WORK_BLOCKER_REASON_LABELS;

export type JobParkingContext = {
  jobId: string;
  blockerId: string;
  version: number;
  reason: JobParkingReason;
  note: string | null;
  responsibleEmployeeRecordId: string | null;
  responsibleName: string | null;
  nextReviewDate: string | null;
  updatedAt: string;
};

/** Parking-owned sentences; the shared codes come from `describeFailure`. */
export const PARKING_ERROR_MESSAGES: Record<string, string> = {
  job_not_found: 'Der Auftrag wurde nicht gefunden.',
  job_not_parked: 'Nur geparkte Aufträge können Parkplatz-Kontext erhalten.',
  responsible_not_manager: 'Die verantwortliche Person muss ein aktives Büro- oder Admin-Mitglied sein.',
  load_failed: 'Der Parkplatz-Kontext konnte nicht geladen werden.',
  update_failed: 'Der Parkplatz-Kontext konnte nicht gespeichert werden.',
  stale_version: 'Der Parkplatz-Kontext wurde inzwischen geändert. Bitte lade ihn neu.',
};
