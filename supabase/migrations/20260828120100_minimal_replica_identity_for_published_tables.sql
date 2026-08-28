-- Stage B (platform hardening): replace replica identity FULL and DEFAULT on
-- every published organization-scoped table with REPLICA IDENTITY USING INDEX
-- on a minimal unique (id, organization_id) index.
--
-- Why (Stage B research, docs/technical/realtime-and-caching.md):
-- postgres_changes applies no RLS to DELETE events — only the subscription
-- filter gates them, and the payload is whatever replica identity logs.
-- FULL therefore leaked complete deleted rows (sickness reports included) to
-- any authenticated subscription, across organizations and across the in-org
-- privacy matrix. DEFAULT (primary key only) leaked nothing but also delivered
-- NO org-filtered DELETE events at all, leaving deletions invisible to live
-- surfaces. The (id, organization_id) index keeps DELETE events filterable
-- while their payload carries only the two ids. Events are invalidation
-- signals; consumers must not read row content from DELETE payloads.
--
-- Exceptions: profiles has no organization column (stays DEFAULT, PK-only
-- payloads); organization_settings and organization_qualification_settings
-- have organization_id as their primary key, so DEFAULT already yields a
-- filterable, minimal DELETE payload.
--
-- Operational note: each CREATE INDEX takes a SHARE lock (blocks writes for
-- the build; instant at current data volumes) and adds one small permanent
-- index of write amplification per table. Revisit only if a write-heavy
-- table (time_entries, inventory_movements) ever shows index pressure —
-- the broadcast transport end-state would remove the need entirely.
--
-- Caution: dropping one of these indexes silently degrades the table to
-- REPLICA IDENTITY NOTHING, which makes UPDATE/DELETE on a published table
-- fail outright. The preflight parity check
-- (scripts/check-realtime-parity.ts) catches drift before a battery runs.

create unique index attention_events_replident_idx
  on public.attention_events (id, organization_id);
alter table public.attention_events
  replica identity using index attention_events_replident_idx;

create unique index attention_read_states_replident_idx
  on public.attention_read_states (id, organization_id);
alter table public.attention_read_states
  replica identity using index attention_read_states_replident_idx;

create unique index client_communication_preferences_replident_idx
  on public.client_communication_preferences (id, organization_id);
alter table public.client_communication_preferences
  replica identity using index client_communication_preferences_replident_idx;

create unique index client_communication_settings_replident_idx
  on public.client_communication_settings (id, organization_id);
alter table public.client_communication_settings
  replica identity using index client_communication_settings_replident_idx;

create unique index client_contacts_replident_idx
  on public.client_contacts (id, organization_id);
alter table public.client_contacts
  replica identity using index client_contacts_replident_idx;

create unique index client_follow_ups_replident_idx
  on public.client_follow_ups (id, organization_id);
alter table public.client_follow_ups
  replica identity using index client_follow_ups_replident_idx;

create unique index client_requests_replident_idx
  on public.client_requests (id, organization_id);
alter table public.client_requests
  replica identity using index client_requests_replident_idx;

create unique index client_sites_replident_idx
  on public.client_sites (id, organization_id);
alter table public.client_sites
  replica identity using index client_sites_replident_idx;

create unique index clients_replident_idx
  on public.clients (id, organization_id);
alter table public.clients
  replica identity using index clients_replident_idx;

create unique index document_audit_events_replident_idx
  on public.document_audit_events (id, organization_id);
alter table public.document_audit_events
  replica identity using index document_audit_events_replident_idx;

create unique index document_folders_replident_idx
  on public.document_folders (id, organization_id);
alter table public.document_folders
  replica identity using index document_folders_replident_idx;

create unique index document_links_replident_idx
  on public.document_links (id, organization_id);
alter table public.document_links
  replica identity using index document_links_replident_idx;

create unique index document_versions_replident_idx
  on public.document_versions (id, organization_id);
alter table public.document_versions
  replica identity using index document_versions_replident_idx;

create unique index documents_replident_idx
  on public.documents (id, organization_id);
alter table public.documents
  replica identity using index documents_replident_idx;

create unique index employee_capabilities_replident_idx
  on public.employee_capabilities (id, organization_id);
alter table public.employee_capabilities
  replica identity using index employee_capabilities_replident_idx;

create unique index employee_records_replident_idx
  on public.employee_records (id, organization_id);
alter table public.employee_records
  replica identity using index employee_records_replident_idx;

create unique index employment_conditions_replident_idx
  on public.employment_conditions (id, organization_id);
alter table public.employment_conditions
  replica identity using index employment_conditions_replident_idx;

create unique index entry_change_requests_replident_idx
  on public.entry_change_requests (id, organization_id);
alter table public.entry_change_requests
  replica identity using index entry_change_requests_replident_idx;

create unique index inventory_asset_instances_replident_idx
  on public.inventory_asset_instances (id, organization_id);
alter table public.inventory_asset_instances
  replica identity using index inventory_asset_instances_replident_idx;

create unique index inventory_audit_events_replident_idx
  on public.inventory_audit_events (id, organization_id);
alter table public.inventory_audit_events
  replica identity using index inventory_audit_events_replident_idx;

create unique index inventory_categories_replident_idx
  on public.inventory_categories (id, organization_id);
alter table public.inventory_categories
  replica identity using index inventory_categories_replident_idx;

create unique index inventory_import_batches_replident_idx
  on public.inventory_import_batches (id, organization_id);
alter table public.inventory_import_batches
  replica identity using index inventory_import_batches_replident_idx;

create unique index inventory_item_barcodes_replident_idx
  on public.inventory_item_barcodes (id, organization_id);
alter table public.inventory_item_barcodes
  replica identity using index inventory_item_barcodes_replident_idx;

create unique index inventory_items_replident_idx
  on public.inventory_items (id, organization_id);
alter table public.inventory_items
  replica identity using index inventory_items_replident_idx;

create unique index inventory_locations_replident_idx
  on public.inventory_locations (id, organization_id);
alter table public.inventory_locations
  replica identity using index inventory_locations_replident_idx;

create unique index inventory_movements_replident_idx
  on public.inventory_movements (id, organization_id);
alter table public.inventory_movements
  replica identity using index inventory_movements_replident_idx;

create unique index inventory_stock_levels_replident_idx
  on public.inventory_stock_levels (id, organization_id);
alter table public.inventory_stock_levels
  replica identity using index inventory_stock_levels_replident_idx;

create unique index inventory_suppliers_replident_idx
  on public.inventory_suppliers (id, organization_id);
alter table public.inventory_suppliers
  replica identity using index inventory_suppliers_replident_idx;

create unique index job_capability_requirement_origins_replident_idx
  on public.job_capability_requirement_origins (id, organization_id);
alter table public.job_capability_requirement_origins
  replica identity using index job_capability_requirement_origins_replident_idx;

create unique index job_capability_requirements_replident_idx
  on public.job_capability_requirements (id, organization_id);
alter table public.job_capability_requirements
  replica identity using index job_capability_requirements_replident_idx;

create unique index job_instruction_item_dependencies_replident_idx
  on public.job_instruction_item_dependencies (id, organization_id);
alter table public.job_instruction_item_dependencies
  replica identity using index job_instruction_item_dependencies_replident_idx;

create unique index job_instruction_item_evidence_fulfillments_replident_idx
  on public.job_instruction_item_evidence_fulfillments (id, organization_id);
alter table public.job_instruction_item_evidence_fulfillments
  replica identity using index job_instruction_item_evidence_fulfillments_replident_idx;

create unique index job_instruction_item_evidence_requirements_replident_idx
  on public.job_instruction_item_evidence_requirements (id, organization_id);
alter table public.job_instruction_item_evidence_requirements
  replica identity using index job_instruction_item_evidence_requirements_replident_idx;

create unique index job_instruction_items_replident_idx
  on public.job_instruction_items (id, organization_id);
alter table public.job_instruction_items
  replica identity using index job_instruction_items_replident_idx;

create unique index job_material_lines_replident_idx
  on public.job_material_lines (id, organization_id);
alter table public.job_material_lines
  replica identity using index job_material_lines_replident_idx;

create unique index jobs_replident_idx
  on public.jobs (id, organization_id);
alter table public.jobs
  replica identity using index jobs_replident_idx;

create unique index organization_capabilities_replident_idx
  on public.organization_capabilities (id, organization_id);
alter table public.organization_capabilities
  replica identity using index organization_capabilities_replident_idx;

create unique index organization_closure_days_replident_idx
  on public.organization_closure_days (id, organization_id);
alter table public.organization_closure_days
  replica identity using index organization_closure_days_replident_idx;

create unique index organization_invites_replident_idx
  on public.organization_invites (id, organization_id);
alter table public.organization_invites
  replica identity using index organization_invites_replident_idx;

create unique index organization_members_replident_idx
  on public.organization_members (id, organization_id);
alter table public.organization_members
  replica identity using index organization_members_replident_idx;

create unique index planning_customer_commitments_replident_idx
  on public.planning_customer_commitments (id, organization_id);
alter table public.planning_customer_commitments
  replica identity using index planning_customer_commitments_replident_idx;

create unique index planning_dispatch_acknowledgements_replident_idx
  on public.planning_dispatch_acknowledgements (id, organization_id);
alter table public.planning_dispatch_acknowledgements
  replica identity using index planning_dispatch_acknowledgements_replident_idx;

create unique index planning_dispatch_recipients_replident_idx
  on public.planning_dispatch_recipients (id, organization_id);
alter table public.planning_dispatch_recipients
  replica identity using index planning_dispatch_recipients_replident_idx;

create unique index planning_dispatches_replident_idx
  on public.planning_dispatches (id, organization_id);
alter table public.planning_dispatches
  replica identity using index planning_dispatches_replident_idx;

create unique index planning_occurrence_assignments_replident_idx
  on public.planning_occurrence_assignments (id, organization_id);
alter table public.planning_occurrence_assignments
  replica identity using index planning_occurrence_assignments_replident_idx;

create unique index planning_occurrences_replident_idx
  on public.planning_occurrences (id, organization_id);
alter table public.planning_occurrences
  replica identity using index planning_occurrences_replident_idx;

create unique index planning_series_replident_idx
  on public.planning_series (id, organization_id);
alter table public.planning_series
  replica identity using index planning_series_replident_idx;

create unique index sickness_reports_replident_idx
  on public.sickness_reports (id, organization_id);
alter table public.sickness_reports
  replica identity using index sickness_reports_replident_idx;

create unique index team_memberships_replident_idx
  on public.team_memberships (id, organization_id);
alter table public.team_memberships
  replica identity using index team_memberships_replident_idx;

create unique index teams_replident_idx
  on public.teams (id, organization_id);
alter table public.teams
  replica identity using index teams_replident_idx;

create unique index time_entries_replident_idx
  on public.time_entries (id, organization_id);
alter table public.time_entries
  replica identity using index time_entries_replident_idx;

create unique index vacation_requests_replident_idx
  on public.vacation_requests (id, organization_id);
alter table public.vacation_requests
  replica identity using index vacation_requests_replident_idx;

create unique index work_artifacts_replident_idx
  on public.work_artifacts (id, organization_id);
alter table public.work_artifacts
  replica identity using index work_artifacts_replident_idx;

create unique index work_blockers_replident_idx
  on public.work_blockers (id, organization_id);
alter table public.work_blockers
  replica identity using index work_blockers_replident_idx;

create unique index work_dependencies_replident_idx
  on public.work_dependencies (id, organization_id);
alter table public.work_dependencies
  replica identity using index work_dependencies_replident_idx;

create unique index work_handover_packages_replident_idx
  on public.work_handover_packages (id, organization_id);
alter table public.work_handover_packages
  replica identity using index work_handover_packages_replident_idx;

create unique index work_schedules_replident_idx
  on public.work_schedules (id, organization_id);
alter table public.work_schedules
  replica identity using index work_schedules_replident_idx;

create unique index work_template_applications_replident_idx
  on public.work_template_applications (id, organization_id);
alter table public.work_template_applications
  replica identity using index work_template_applications_replident_idx;

create unique index work_template_capability_requirements_replident_idx
  on public.work_template_capability_requirements (id, organization_id);
alter table public.work_template_capability_requirements
  replica identity using index work_template_capability_requirements_replident_idx;

create unique index work_template_item_dependencies_replident_idx
  on public.work_template_item_dependencies (id, organization_id);
alter table public.work_template_item_dependencies
  replica identity using index work_template_item_dependencies_replident_idx;

create unique index work_template_item_evidence_requirements_replident_idx
  on public.work_template_item_evidence_requirements (id, organization_id);
alter table public.work_template_item_evidence_requirements
  replica identity using index work_template_item_evidence_requirements_replident_idx;

create unique index work_template_items_replident_idx
  on public.work_template_items (id, organization_id);
alter table public.work_template_items
  replica identity using index work_template_items_replident_idx;

create unique index work_template_material_lines_replident_idx
  on public.work_template_material_lines (id, organization_id);
alter table public.work_template_material_lines
  replica identity using index work_template_material_lines_replident_idx;

create unique index work_template_versions_replident_idx
  on public.work_template_versions (id, organization_id);
alter table public.work_template_versions
  replica identity using index work_template_versions_replident_idx;

create unique index work_templates_replident_idx
  on public.work_templates (id, organization_id);
alter table public.work_templates
  replica identity using index work_templates_replident_idx;

create unique index organization_responsibility_assignments_replident_idx
  on public.organization_responsibility_assignments (id, organization_id);
alter table public.organization_responsibility_assignments
  replica identity using index organization_responsibility_assignments_replident_idx;

create unique index organization_responsibility_configurations_replident_idx
  on public.organization_responsibility_configurations (id, organization_id);
alter table public.organization_responsibility_configurations
  replica identity using index organization_responsibility_configurations_replident_idx;

create unique index organization_responsibility_delegations_replident_idx
  on public.organization_responsibility_delegations (id, organization_id);
alter table public.organization_responsibility_delegations
  replica identity using index organization_responsibility_delegations_replident_idx;

create unique index projects_replident_idx
  on public.projects (id, organization_id);
alter table public.projects
  replica identity using index projects_replident_idx;

-- organization_qualification_settings was FULL; its primary key IS the
-- organization id, so DEFAULT gives the same filterable minimal payload.
alter table public.organization_qualification_settings
  replica identity default;
