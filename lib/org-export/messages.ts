import type { SharedFailureCode } from '@/lib/action-result';

// The failure codes of the organization export and their German sentences.
// A part's stored failure reason reads through the same map.

export type OrganizationExportFailureCode =
  | SharedFailureCode
  | 'export_plan_stale'
  | 'export_plan_invalid'
  | 'export_plan_repeats_file'
  | 'export_plan_repeats_name'
  | 'export_start_failed'
  | 'export_part_not_found'
  | 'export_part_ready'
  | 'export_part_not_ready'
  | 'export_part_expired'
  | 'export_part_failed'
  | 'export_download_failed';

export const ORGANIZATION_EXPORT_MESSAGES: Readonly<Partial<Record<string, string>>> = {
  not_authorized: 'Nur ein Admin kann die Organisation exportieren.',
  export_plan_stale: 'Während des Starts haben sich Dokumente geändert. Starte den Export noch einmal.',
  export_plan_invalid: 'Der Export konnte nicht geplant werden. Starte ihn noch einmal.',
  export_plan_repeats_file: 'Der Export konnte nicht geplant werden. Starte ihn noch einmal.',
  export_plan_repeats_name: 'Der Export konnte nicht geplant werden. Starte ihn noch einmal.',
  export_start_failed: 'Der Export konnte nicht gestartet werden. Versuche es in einem Moment erneut.',
  export_part_not_found: 'Diesen Exportteil gibt es nicht.',
  export_part_ready: 'Dieser Teil ist schon fertig.',
  export_part_not_ready: 'Dieser Teil ist noch nicht fertig.',
  export_part_expired: 'Dieser Export ist abgelaufen. Starte einen neuen Export.',
  export_part_failed: 'Der Teil konnte nicht erstellt werden. Versuche es erneut.',
  export_download_failed: 'Der Download konnte nicht vorbereitet werden. Versuche es erneut.',
  // A part's stored failure reason.
  storage_object_missing: 'Eine Originaldatei fehlt im Speicher. Starte einen neuen Export.',
  export_too_large: 'Der Teil ist zu groß. Melde dich beim WerkFlow-Support.',
  export_dictionary_incomplete: 'Der Export kennt nicht alle Daten. Melde dich beim WerkFlow-Support.',
  build_failed: 'Der Teil konnte nicht erstellt werden.',
};
