-- Close the legacy anonymous row privileges (docs/technical/security.md,
-- rule 9 and the residual-exposure list). The anon role only acts for a
-- request without a user JWT, and no signed-out surface reads or writes a
-- public table with it:
-- - login, signup and invite pages call invite lookups and redemption through
--   the admin client (app/(auth)/login/page.tsx, app/(auth)/signup/page.tsx,
--   app/auth/callback/route.ts, app/api/redeem-invite/route.ts,
--   app/invite-error/page.tsx);
-- - the signup form upserts profiles only once signUp returned a session, so
--   the request carries the new user's JWT (app/(auth)/signup/signup-form.tsx);
-- - forgot and reset password use Supabase Auth endpoints only;
-- - proxy.ts reads the session cookie and queries no table;
-- - the edge functions accept only the secret keys and query no table;
-- - Realtime subscriptions start inside the signed-in app shell.
-- RLS already returned no row to anon; this removes the grants themselves.
revoke all on table
  public.attention_events,
  public.attention_read_states,
  public.client_communication_preference_events,
  public.client_communication_preferences,
  public.client_communication_settings,
  public.client_contacts,
  public.client_follow_up_events,
  public.client_follow_ups,
  public.client_request_events,
  public.client_requests,
  public.client_sites,
  public.clients,
  public.document_audit_events,
  public.document_folders,
  public.document_links,
  public.document_versions,
  public.documents,
  public.employee_record_events,
  public.employee_records,
  public.employment_conditions,
  public.entry_change_requests,
  public.installed_equipment,
  public.installed_equipment_event_links,
  public.installed_equipment_events,
  public.installed_equipment_identifiers,
  public.installed_equipment_work_links,
  public.inventory_asset_instances,
  public.inventory_audit_events,
  public.inventory_categories,
  public.inventory_import_batches,
  public.inventory_item_barcodes,
  public.inventory_items,
  public.inventory_locations,
  public.inventory_movements,
  public.inventory_stock_levels,
  public.inventory_suppliers,
  public.job_assignments,
  public.job_instruction_items,
  public.job_material_lines,
  public.jobs,
  public.organization_closure_days,
  public.organization_invites,
  public.organization_members,
  public.organization_settings,
  public.organization_user_preferences,
  public.organizations,
  public.planning_customer_commitment_events,
  public.planning_customer_commitments,
  public.planning_dispatch_acknowledgements,
  public.planning_dispatch_events,
  public.planning_dispatch_recipients,
  public.planning_dispatch_revisions,
  public.planning_dispatches,
  public.profiles,
  public.projects,
  public.service_case_equipment_links,
  public.service_case_events,
  public.service_case_evidence_links,
  public.service_case_relations,
  public.service_cases,
  public.sickness_report_events,
  public.sickness_reports,
  public.subscriptions,
  public.time_entries,
  public.vacation_request_events,
  public.vacation_requests,
  public.work_handover_draft_items,
  public.work_handover_events,
  public.work_handover_packages,
  public.work_handover_release_items,
  public.work_handover_releases,
  public.work_schedules
from anon;

-- The identity sequence of time_segment_events kept an automatic anon grant.
revoke all on sequence public.time_segment_events_event_sequence_seq from anon;
