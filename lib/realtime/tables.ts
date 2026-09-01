// The one home of the Realtime table list. The provider subscribes to
// exactly these tables (all org-filtered except profiles), the parity check
// (scripts/check-realtime-parity.ts) diffs them against the database's
// supabase_realtime publication and replica-identity state, and the
// RealtimeTable type derives from this array so list and type cannot drift.
export const REALTIME_TABLES = [
  "time_entries",
  "time_sessions",
  "time_segments",
  "entry_change_requests",
  "time_correction_requests",
  "time_account_policies",
  "time_accounts",
  "time_account_adjustment_requests",
  "time_periods",
  "payroll_mapping_profiles",
  "payroll_exports",
  "organization_invites",
  "organization_members",
  "organization_settings",
  "profiles",
  "employee_records",
  "employment_conditions",
  "work_schedules",
  "organization_closure_days",
  "vacation_requests",
  "sickness_reports",
  "teams",
  "team_memberships",
  "organization_capabilities",
  "employee_capabilities",
  "organization_qualification_settings",
  "job_capability_requirements",
  "attention_read_states",
  "attention_events",
  "organization_responsibility_configurations",
  "organization_responsibility_assignments",
  "organization_responsibility_delegations",
  "clients",
  "client_contacts",
  "client_sites",
  "client_requests",
  "client_follow_ups",
  "client_communication_settings",
  "client_communication_preferences",
  "maintenance_coverages",
  "maintenance_plans",
  "maintenance_due_work",
  "installed_equipment",
  "service_cases",
  "jobs",
  "projects",
  "job_assignments",
  "planning_series",
  "planning_occurrences",
  "planning_occurrence_assignments",
  "planning_dispatches",
  "planning_dispatch_recipients",
  "planning_dispatch_acknowledgements",
  "planning_customer_commitments",
  "work_blockers",
  "work_dependencies",
  "job_instruction_items",
  "job_instruction_item_evidence_requirements",
  "job_instruction_item_evidence_fulfillments",
  "job_instruction_item_dependencies",
  "work_artifacts",
  "work_handover_packages",
  "work_templates",
  "work_template_versions",
  "work_template_items",
  "work_template_item_evidence_requirements",
  "work_template_item_dependencies",
  "work_template_material_lines",
  "work_template_capability_requirements",
  "work_template_applications",
  "job_capability_requirement_origins",
  "document_folders",
  "documents",
  "document_links",
  "document_audit_events",
  "document_versions",
  "inventory_categories",
  "inventory_locations",
  "inventory_suppliers",
  "inventory_items",
  "inventory_item_barcodes",
  "inventory_stock_levels",
  "inventory_import_batches",
  "job_material_lines",
  "inventory_movements",
  "inventory_asset_instances",
  "inventory_audit_events",
] as const;

export type RealtimeTable = (typeof REALTIME_TABLES)[number];

// profiles is the one published table without an organization_id column
// (profile data is referenced across organization views); every other
// subscription carries the server-side organization filter.
export const UNFILTERED_REALTIME_TABLES: readonly RealtimeTable[] = [
  "profiles",
];

// Published tables whose DEFAULT replica identity is already minimal and
// filterable: organization_settings and organization_qualification_settings
// have organization_id as their primary key; profiles has no organization
// column at all. Every other published table uses the committed
// a unique (id, organization_id) index (see the replica-identity migrations).
export const DEFAULT_IDENTITY_REALTIME_TABLES: readonly RealtimeTable[] = [
  "profiles",
  "organization_settings",
  "organization_qualification_settings",
];
