// The one home of the Realtime table list. The provider subscribes to
// these business tables (all org-filtered except profiles) plus the deletion
// transport below. The parity check
// (scripts/check-realtime-parity.ts) diffs them against the database's
// supabase_realtime publication and replica-identity state, and the
// RealtimeTable type derives from this array so list and type cannot drift.
export const REALTIME_TABLES = [
  'time_entries',
  'time_sessions',
  'time_segments',
  'entry_change_requests',
  'time_correction_requests',
  'time_account_policies',
  'time_accounts',
  'time_account_adjustment_requests',
  'time_periods',
  'payroll_exports',
  'organization_invites',
  'organization_join_requests',
  'organization_members',
  'organization_settings',
  'profiles',
  'employee_records',
  'personnel_access_lifecycles',
  'personnel_employment_lifecycles',
  'personnel_documents',
  'personnel_document_releases',
  'personnel_onboarding_templates',
  'personnel_onboarding_plans',
  'personnel_onboarding_requirements',
  'employment_conditions',
  'work_schedules',
  'organization_closure_days',
  'vacation_requests',
  'sickness_reports',
  'teams',
  'team_memberships',
  'organization_capabilities',
  'employee_capabilities',
  'organization_qualification_settings',
  'job_capability_requirements',
  'attention_read_states',
  'organization_responsibility_configurations',
  'organization_responsibility_assignments',
  'organization_responsibility_delegations',
  'clients',
  'client_contacts',
  'client_sites',
  'client_requests',
  'client_follow_ups',
  'client_communication_settings',
  'client_communication_preferences',
  'maintenance_coverages',
  'maintenance_plans',
  'maintenance_due_work',
  'installed_equipment',
  'service_cases',
  'jobs',
  'projects',
  'job_assignments',
  'planning_series',
  'planning_occurrences',
  'planning_occurrence_assignments',
  'planning_dispatches',
  'planning_dispatch_recipients',
  'planning_dispatch_acknowledgements',
  'planning_customer_commitments',
  'work_blockers',
  'work_dependencies',
  'job_instruction_items',
  'job_instruction_item_evidence_fulfillments',
  'work_artifacts',
  'work_handover_packages',
  'work_templates',
  'work_template_versions',
  'work_template_applications',
  'document_folders',
  'documents',
  'document_links',
  'document_audit_events',
  'document_versions',
  'inventory_categories',
  'inventory_locations',
  'inventory_suppliers',
  'inventory_items',
  'inventory_item_barcodes',
  'inventory_stock_levels',
  'inventory_import_batches',
  'job_material_lines',
  'inventory_movements',
  'inventory_asset_instances',
] as const;

export type RealtimeTable = (typeof REALTIME_TABLES)[number];

// Transport-only INSERTs become business-table DELETE invalidations. It is not
// a domain table and must never be exposed as a consumer subscription target.
export const REALTIME_DELETION_TABLE = 'realtime_deletions';
export const REALTIME_PUBLISHED_TABLES = [...REALTIME_TABLES, REALTIME_DELETION_TABLE] as const;

// profiles is the one published table without an organization_id column
// (profile data is referenced across organization views); every other
// subscription carries the server-side organization filter.
export const UNFILTERED_REALTIME_TABLES: readonly RealtimeTable[] = ['profiles'];

// Published tables whose DEFAULT replica identity is already minimal:
// organization_settings and organization_qualification_settings
// have organization_id as their primary key; profiles has no organization
// column at all. Every other published table uses the committed
// unique (id, organization_id) index. Raw DELETE delivery is disabled; these
// identities retain the minimal logical-decoding contract for other changes.
export const DEFAULT_IDENTITY_REALTIME_TABLES: readonly RealtimeTable[] = [
  'profiles',
  'organization_settings',
  'organization_qualification_settings',
];

// Published tables whose every row version carries its transaction's start
// time: `updated_at` defaults to now() and an enabled BEFORE UPDATE row
// trigger sets it to now(). All rows one transaction writes share that stamp,
// so an event of such a table names the transaction it came from
// (lib/realtime/own-writes.ts). `bun run realtime:check` fails while a listed
// table lacks the default or the trigger.
export const TRANSACTION_STAMPED_TABLES: readonly RealtimeTable[] = [
  'client_communication_preferences',
  'client_communication_settings',
  'client_contacts',
  'client_follow_ups',
  'client_requests',
  'client_sites',
  'clients',
  'document_folders',
  'documents',
  'employee_capabilities',
  'employee_records',
  'employment_conditions',
  'inventory_asset_instances',
  'inventory_categories',
  'inventory_items',
  'inventory_locations',
  'inventory_stock_levels',
  'inventory_suppliers',
  'job_capability_requirements',
  'job_instruction_items',
  'job_material_lines',
  'jobs',
  'organization_capabilities',
  'organization_qualification_settings',
  'organization_responsibility_delegations',
  'payroll_exports',
  'personnel_access_lifecycles',
  'personnel_documents',
  'personnel_employment_lifecycles',
  'personnel_onboarding_plans',
  'personnel_onboarding_requirements',
  'personnel_onboarding_templates',
  'planning_occurrences',
  'planning_series',
  'projects',
  'sickness_reports',
  'team_memberships',
  'teams',
  'time_account_adjustment_requests',
  'time_account_policies',
  'time_accounts',
  'time_correction_requests',
  'time_entries',
  'time_periods',
  'vacation_requests',
  'work_schedules',
];
