import type { Database } from '@/lib/supabase/database.types';
import { COLUMN_LABELS } from './column-labels';

// The German names of the organization export (werk-flow/werkflow-planning#287):
// one CSV file per table and one column name per database column. The types
// make the dictionary complete: a new table or column fails the typecheck
// until it has a German name here or a reason to stay out. The data part also
// refuses a column the dictionary does not know, so a schema the types missed
// never leaves a column out silently.

type PublicTables = Database['public']['Tables'];
type TableName = keyof PublicTables & string;

/** Tables that hold no record of the organization. */
type ExcludedTable =
  // Account-wide sign-in codes of a person, no business record.
  | 'email_change_challenges'
  // Rate-limit state of a person before any membership exists.
  | 'organization_join_attempts'
  // Keyed subject hashes of the abuse limits.
  | 'rate_limit_attempts'
  // Transport signals of the live views, gone after an hour.
  | 'realtime_deletions'
  // Storage keys of files already deleted from WerkFlow.
  | 'storage_purge_queue'
  // A person's problem reports to WerkFlow support: no admin reads another
  // person's report (werk-flow/werkflow-planning#331).
  | 'problem_reports'
  | 'problem_report_events'
  | 'problem_report_files'
  // The paying account's billing state, not the organization's records.
  | 'subscriptions'
  // The file plan and part state of earlier exports, whose archives are gone
  // after seven days; one row per file would grow every export by the last.
  // Their history stays in `organization_exports` and `organization_export_events`.
  | 'organization_export_files'
  | 'organization_export_parts';

export type ExportTable = Exclude<TableName, ExcludedTable>;
type ColumnOf<Table extends ExportTable> = keyof PublicTables[Table]['Row'] & string;
type ExportColumn = { [Table in ExportTable]: ColumnOf<Table> }[ExportTable];

/** Capability secrets: a join code or an invite code admits a person to the organization. */
const SECRET_COLUMNS = {
  organizations: ['unique_code'],
  organization_invites: ['invite_code'],
} satisfies { [Table in ExportTable]?: readonly ColumnOf<Table>[] };
type SecretColumn = (typeof SECRET_COLUMNS)[keyof typeof SECRET_COLUMNS][number];
/** Every column the export writes: each column of an exported table but the secrets. */
export type LabeledColumn = Exclude<ExportColumn, SecretColumn>;

/** The CSV file of each exported table, without its folder and extension. */
export const TABLE_FILES: Record<ExportTable, string> = {
  attention_events: 'Hinweise_Ereignisse',
  attention_read_states: 'Hinweise_Lesestatus',
  client_communication_preference_events: 'Kunden_Kontaktwünsche_Ereignisse',
  client_communication_preferences: 'Kunden_Kontaktwünsche',
  client_communication_settings: 'Kunden_Kommunikationseinstellungen',
  client_contacts: 'Kunden_Ansprechpartner',
  client_follow_up_events: 'Kunden_Wiedervorlagen_Ereignisse',
  client_master_events: 'Kunden_Stammdaten_Ereignisse',
  client_follow_ups: 'Kunden_Wiedervorlagen',
  client_request_events: 'Anfragen_Ereignisse',
  client_requests: 'Anfragen',
  client_site_roles: 'Kunden_Objektrollen',
  client_sites: 'Kunden_Standorte',
  clients: 'Kunden',
  document_audit_events: 'Dokumente_Protokoll',
  document_folders: 'Dokumente_Ordner',
  document_links: 'Dokumente_Verknüpfungen',
  document_versions: 'Dokumente_Versionen',
  documents: 'Dokumente',
  employee_capabilities: 'Mitarbeiter_Qualifikationen',
  employee_record_events: 'Mitarbeiter_Ereignisse',
  employee_records: 'Mitarbeiter',
  employment_conditions: 'Mitarbeiter_Beschäftigungsbedingungen',
  entry_change_requests: 'Zeiterfassung_Änderungsanträge',
  installed_equipment: 'Anlagen',
  installed_equipment_event_links: 'Anlagen_Ereignisverknüpfungen',
  installed_equipment_events: 'Anlagen_Ereignisse',
  installed_equipment_identifiers: 'Anlagen_Kennungen',
  installed_equipment_work_links: 'Anlagen_Arbeitsverknüpfungen',
  inventory_asset_instances: 'Lager_Einzelstücke',
  inventory_audit_events: 'Lager_Protokoll',
  inventory_categories: 'Lager_Kategorien',
  inventory_import_batches: 'Lager_Importe',
  inventory_item_barcodes: 'Lager_Barcodes',
  inventory_items: 'Lager_Artikel',
  inventory_locations: 'Lager_Lagerorte',
  inventory_movements: 'Lager_Bewegungen',
  inventory_stock_levels: 'Lager_Bestände',
  inventory_suppliers: 'Lager_Lieferanten',
  job_assignments: 'Aufträge_Zuweisungen',
  job_capability_requirement_origins: 'Aufträge_Qualifikationsanforderungen_Herkunft',
  job_capability_requirements: 'Aufträge_Qualifikationsanforderungen',
  job_instruction_item_dependencies: 'Aufträge_Arbeitsschritte_Abhängigkeiten',
  job_instruction_item_events: 'Aufträge_Arbeitsschritte_Ereignisse',
  job_instruction_item_evidence_fulfillments: 'Aufträge_Arbeitsschritte_Nachweise',
  job_instruction_item_evidence_requirements: 'Aufträge_Arbeitsschritte_Nachweisanforderungen',
  job_instruction_items: 'Aufträge_Arbeitsschritte',
  job_material_lines: 'Aufträge_Material',
  job_qualification_assessments: 'Aufträge_Qualifikationsprüfungen',
  jobs: 'Aufträge',
  maintenance_coverage_events: 'Wartungsverträge_Ereignisse',
  maintenance_coverages: 'Wartungsverträge',
  maintenance_due_evidence_links: 'Wartungen_Nachweisverknüpfungen',
  maintenance_due_work: 'Wartungen_Fällige_Arbeiten',
  maintenance_due_work_events: 'Wartungen_Fällige_Arbeiten_Ereignisse',
  maintenance_plan_events: 'Wartungspläne_Ereignisse',
  maintenance_plan_revision_equipment: 'Wartungspläne_Anlagen',
  maintenance_plan_revisions: 'Wartungspläne_Fassungen',
  maintenance_plans: 'Wartungspläne',
  maintenance_service_case_links: 'Wartungen_Servicefälle',
  organization_capabilities: 'Organisation_Qualifikationen',
  organization_closure_days: 'Organisation_Schließtage',
  organization_export_events: 'Datenexporte_Protokoll',
  organization_exports: 'Datenexporte',
  organization_invites: 'Organisation_Einladungen',
  organization_join_requests: 'Organisation_Beitrittsanfragen',
  organization_members: 'Organisation_Mitglieder',
  organization_qualification_settings: 'Organisation_Qualifikationseinstellungen',
  organization_responsibility_assignments: 'Zuständigkeiten_Zuweisungen',
  organization_responsibility_configurations: 'Zuständigkeiten',
  organization_responsibility_delegations: 'Zuständigkeiten_Vertretungen',
  organization_responsibility_events: 'Zuständigkeiten_Ereignisse',
  organization_settings: 'Organisation_Einstellungen',
  organization_user_preferences: 'Organisation_Persönliche_Einstellungen',
  organizations: 'Organisation',
  payroll_code_mappings: 'Lohnexport_Lohnarten',
  payroll_employee_mappings: 'Lohnexport_Personalnummern',
  payroll_export_events: 'Lohnexporte_Ereignisse',
  payroll_exports: 'Lohnexporte',
  payroll_mapping_profiles: 'Lohnexport_Zuordnungen',
  payroll_mapping_versions: 'Lohnexport_Zuordnungen_Fassungen',
  personnel_access_lifecycles: 'Personal_Zugang',
  personnel_access_transitions: 'Personal_Zugang_Änderungen',
  personnel_acknowledgements: 'Personal_Bestätigungen',
  personnel_document_releases: 'Personal_Dokumentfreigaben',
  personnel_documents: 'Personal_Dokumente',
  personnel_employment_lifecycles: 'Personal_Beschäftigung',
  personnel_employment_transitions: 'Personal_Beschäftigung_Änderungen',
  personnel_lifecycle_operations: 'Personal_Vorgänge',
  personnel_onboarding_plans: 'Personal_Einarbeitungspläne',
  personnel_onboarding_requirements: 'Personal_Einarbeitung_Anforderungen',
  personnel_onboarding_template_items: 'Personal_Einarbeitungsvorlagen_Punkte',
  personnel_onboarding_template_versions: 'Personal_Einarbeitungsvorlagen_Fassungen',
  personnel_onboarding_templates: 'Personal_Einarbeitungsvorlagen',
  personnel_requirement_references: 'Personal_Anforderungen_Verweise',
  planning_customer_commitment_events: 'Planung_Kundenzusagen_Ereignisse',
  planning_customer_commitments: 'Planung_Kundenzusagen',
  planning_dispatch_acknowledgements: 'Planung_Einsatzbestätigungen',
  planning_dispatch_events: 'Planung_Einsätze_Ereignisse',
  planning_dispatch_recipients: 'Planung_Einsätze_Empfänger',
  planning_dispatch_revisions: 'Planung_Einsätze_Fassungen',
  planning_dispatches: 'Planung_Einsätze',
  planning_events: 'Planung_Ereignisse',
  planning_occurrence_assessments: 'Planung_Termine_Prüfungen',
  planning_occurrence_assignments: 'Planung_Termine_Zuweisungen',
  planning_occurrences: 'Planung_Termine',
  planning_operation_assessments: 'Planung_Vorgangsprüfungen',
  planning_series: 'Planung_Serien',
  profiles: 'Personen',
  projects: 'Projekte',
  qualification_events: 'Qualifikationen_Ereignisse',
  service_case_equipment_links: 'Servicefälle_Anlagen',
  service_case_events: 'Servicefälle_Ereignisse',
  service_case_evidence_links: 'Servicefälle_Nachweise',
  service_case_relations: 'Servicefälle_Beziehungen',
  service_cases: 'Servicefälle',
  sickness_report_events: 'Krankmeldungen_Ereignisse',
  sickness_reports: 'Krankmeldungen',
  team_events: 'Teams_Ereignisse',
  team_memberships: 'Teams_Mitglieder',
  teams: 'Teams',
  time_account_adjustment_events: 'Zeitkonten_Korrekturen_Ereignisse',
  time_account_adjustment_requests: 'Zeitkonten_Korrekturen',
  time_account_events: 'Zeitkonten_Buchungen',
  time_account_opening_corrections: 'Zeitkonten_Eröffnungskorrekturen',
  time_account_policies: 'Zeitkonten_Regeln',
  time_account_policy_assignments: 'Zeitkonten_Regeln_Zuweisungen',
  time_account_policy_credit_rules: 'Zeitkonten_Regeln_Anrechnung',
  time_account_policy_supplement_rules: 'Zeitkonten_Regeln_Zuschläge',
  time_account_policy_versions: 'Zeitkonten_Regeln_Fassungen',
  time_account_policy_warning_rules: 'Zeitkonten_Regeln_Warnungen',
  time_accounts: 'Zeitkonten',
  time_correction_applications: 'Zeitkorrekturen_Anwendungen',
  time_correction_events: 'Zeitkorrekturen_Ereignisse',
  time_correction_request_revisions: 'Zeitkorrekturen_Fassungen',
  time_correction_request_sources: 'Zeitkorrekturen_Quellen',
  time_correction_requests: 'Zeitkorrekturen',
  time_entries: 'Zeiterfassung_Buchungen',
  time_entry_audit_events: 'Zeiterfassung_Protokoll',
  time_entry_withdrawals: 'Zeiterfassung_Rücknahmen',
  time_operations: 'Zeiterfassung_Vorgänge',
  time_period_calculations: 'Perioden_Berechnungen',
  time_period_close_versions: 'Perioden_Abschlüsse',
  time_period_daily_results: 'Perioden_Tagesergebnisse',
  time_period_employee_results: 'Perioden_Mitarbeiterergebnisse',
  time_period_events: 'Perioden_Ereignisse',
  time_period_finding_decisions: 'Perioden_Befunde_Entscheidungen',
  time_period_findings: 'Perioden_Befunde',
  time_period_result_sources: 'Perioden_Ergebnisquellen',
  time_periods: 'Perioden',
  time_segment_events: 'Zeiterfassung_Abschnitte_Ereignisse',
  time_segments: 'Zeiterfassung_Abschnitte',
  time_sessions: 'Zeiterfassung_Sitzungen',
  time_timeline_revisions: 'Zeiterfassung_Zeitleistenstände',
  vacation_request_events: 'Urlaubsanträge_Ereignisse',
  vacation_requests: 'Urlaubsanträge',
  work_artifact_actions: 'Arbeitsnachweise_Aktionen',
  work_artifact_change_details: 'Arbeitsnachweise_Änderungen',
  work_artifact_defect_details: 'Arbeitsnachweise_Mängel',
  work_artifact_measurement_lines: 'Arbeitsnachweise_Messwerte',
  work_artifact_revision_documents: 'Arbeitsnachweise_Fassungen_Dokumente',
  work_artifact_revision_sources: 'Arbeitsnachweise_Fassungen_Quellen',
  work_artifact_revisions: 'Arbeitsnachweise_Fassungen',
  work_artifact_signature_uploads: 'Arbeitsnachweise_Unterschriften',
  work_artifacts: 'Arbeitsnachweise',
  work_billing_parties: 'Arbeit_Auftraggeber_und_Rechnungsempfänger',
  work_blocker_events: 'Arbeit_Hindernisse_Ereignisse',
  work_blockers: 'Arbeit_Hindernisse',
  work_dependencies: 'Arbeit_Abhängigkeiten',
  work_dependency_events: 'Arbeit_Abhängigkeiten_Ereignisse',
  work_execution_events: 'Arbeit_Ausführung_Ereignisse',
  work_handover_draft_items: 'Übergaben_Entwurf',
  work_handover_events: 'Übergaben_Ereignisse',
  work_handover_packages: 'Übergaben',
  work_handover_release_items: 'Übergaben_Freigaben_Inhalte',
  work_handover_releases: 'Übergaben_Freigaben',
  work_request_entries: 'Arbeit_Hinzugefügte_Anfragen',
  work_schedules: 'Arbeitszeitmodelle',
  work_template_applications: 'Arbeitsvorlagen_Anwendungen',
  work_template_capability_requirements: 'Arbeitsvorlagen_Qualifikationsanforderungen',
  work_template_events: 'Arbeitsvorlagen_Ereignisse',
  work_template_item_dependencies: 'Arbeitsvorlagen_Schritte_Abhängigkeiten',
  work_template_item_evidence_requirements: 'Arbeitsvorlagen_Schritte_Nachweisanforderungen',
  work_template_items: 'Arbeitsvorlagen_Schritte',
  work_template_material_lines: 'Arbeitsvorlagen_Material',
  work_template_versions: 'Arbeitsvorlagen_Fassungen',
  work_templates: 'Arbeitsvorlagen',
};

function isExportTable(name: string): name is ExportTable {
  return Object.hasOwn(TABLE_FILES, name);
}

/** Every table the export writes, in name order. */
export const EXPORT_TABLES: readonly ExportTable[] = Object.keys(TABLE_FILES).filter(isExportTable).sort();

function isLabeledColumn(name: string): name is keyof typeof COLUMN_LABELS {
  return Object.hasOwn(COLUMN_LABELS, name);
}

function isSecretColumn(table: ExportTable, column: string): boolean {
  return Object.entries(SECRET_COLUMNS).some(
    ([secretTable, columns]) => secretTable === table && columns.some((secret) => secret === column),
  );
}

/** One exported column: its database name and its German name. */
export type ExportedColumn = { column: string; label: string };

/**
 * The exported columns of a table, in table order, without its secrets. A
 * column the dictionary does not know throws `export_dictionary_incomplete`:
 * an export never leaves one out silently.
 */
export function exportedColumns(table: ExportTable, columns: readonly string[]): ExportedColumn[] {
  return columns.flatMap((column) => {
    if (isSecretColumn(table, column)) return [];
    if (!isLabeledColumn(column)) throw new Error('export_dictionary_incomplete');
    return [{ column, label: COLUMN_LABELS[column] }];
  });
}
