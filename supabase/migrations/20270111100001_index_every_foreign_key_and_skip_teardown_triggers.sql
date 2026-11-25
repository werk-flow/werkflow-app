-- An organization's deletion is one statement: it cascades to every row the
-- organization owns. With the typical profile (1,000 customers, 2,500 jobs) it
-- ran 16-20 s on a loaded machine, past the 8 s statement timeout of API
-- requests. Two causes, fixed here:
--
-- 1. Foreign keys without an index the referential check can use. Each deleted
--    parent row runs one lookup per referencing foreign key; without an index
--    that lookup scans the child table. planning_occurrences.job_id had only
--    partial indexes (start_at or start_date not null), so every deleted job
--    scanned all occurrences. supabase/tests/foreign_key_indexes.sql now
--    refuses a foreign key without a usable index.
-- 2. Per-row triggers that ran for rows of an organization being deleted,
--    where they have nothing to do. app_private.mark_organization_cascade_delete
--    names that organization in app.deleting_organization_ids before the
--    cascade starts. A WHEN clause now skips the trigger call for those rows.

-- 1. An index for every foreign key, in the key's column order.
create index client_contacts_created_by_fk_idx on public.client_contacts (created_by);
create index client_contacts_organization_id_client_id_site_id_fk_idx on public.client_contacts (organization_id, client_id, site_id);
create index client_request_events_created_by_fk_idx on public.client_request_events (created_by);
create index client_request_events_organization_id_fk_idx on public.client_request_events (organization_id);
create index client_requests_assigned_to_fk_idx on public.client_requests (assigned_to);
create index client_requests_closed_by_fk_idx on public.client_requests (closed_by);
create index client_requests_contact_id_fk_idx on public.client_requests (contact_id);
create index client_requests_converted_by_fk_idx on public.client_requests (converted_by);
create index client_requests_converted_offer_fk_idx on public.client_requests (converted_offer_id, organization_id);
create index client_requests_created_by_fk_idx on public.client_requests (created_by);
create index client_requests_site_id_fk_idx on public.client_requests (site_id);
create index client_sites_created_by_fk_idx on public.client_sites (created_by);
create index client_sites_primary_contact_id_fk_idx on public.client_sites (primary_contact_id);
create index employee_record_events_created_by_fk_idx on public.employee_record_events (created_by);
create index employee_records_created_by_fk_idx on public.employee_records (created_by);
create index employee_records_user_id_fk_idx on public.employee_records (user_id);
create index employment_conditions_created_by_fk_idx on public.employment_conditions (created_by);
create index inventory_asset_instances_current_job_id_fk_idx on public.inventory_asset_instances (current_job_id);
create index inventory_asset_instances_organization_id_fk_idx on public.inventory_asset_instances (organization_id);
create index inventory_audit_events_actor_id_fk_idx on public.inventory_audit_events (actor_id);
create index inventory_audit_events_location_id_fk_idx on public.inventory_audit_events (location_id);
create index inventory_import_batches_booked_by_fk_idx on public.inventory_import_batches (booked_by);
create index inventory_import_batches_created_by_fk_idx on public.inventory_import_batches (created_by);
create index inventory_import_batches_organization_id_fk_idx on public.inventory_import_batches (organization_id);
create index inventory_item_prices_organization_id_item_id_fk_idx on public.inventory_item_prices (organization_id, item_id);
create index inventory_item_suppliers_organization_id_item_id_fk_idx on public.inventory_item_suppliers (organization_id, item_id);
create index inventory_item_suppliers_organization_id_supplier_id_fk_idx on public.inventory_item_suppliers (organization_id, supplier_id);
create index inventory_items_created_by_fk_idx on public.inventory_items (created_by);
create index inventory_locations_created_by_fk_idx on public.inventory_locations (created_by);
create index inventory_movements_actor_id_fk_idx on public.inventory_movements (actor_id);
create index inventory_movements_project_id_fk_idx on public.inventory_movements (project_id);
create index inventory_supplier_catalog_articles_import_fk_idx on public.inventory_supplier_catalog_articles (import_id, organization_id);
create index inventory_supplier_catalog_import_lines_import_fk_idx on public.inventory_supplier_catalog_import_lines (import_id, organization_id);
create index inventory_supplier_catalog_imports_organization_id_fk_idx on public.inventory_supplier_catalog_imports (organization_id);
create index inventory_supplier_catalog_imports_supplier_fk_idx on public.inventory_supplier_catalog_imports (supplier_id, organization_id);
create index inventory_supplier_rebate_groups_import_fk_idx on public.inventory_supplier_rebate_groups (import_id, organization_id);
create index invoice_lines_organization_id_fk_idx on public.invoice_lines (organization_id);
create index job_assignments_organization_id_fk_idx on public.job_assignments (organization_id);
create index job_instruction_item_evidence_fulfillments_requirement_fk_idx on public.job_instruction_item_evidence_fulfillments (evidence_requirement_id);
create index job_material_lines_created_by_fk_idx on public.job_material_lines (created_by);
create index job_material_lines_organization_id_fk_idx on public.job_material_lines (organization_id);
create index job_material_lines_project_id_fk_idx on public.job_material_lines (project_id);
create index job_material_use_events_job_id_fk_idx on public.job_material_use_events (job_id);
create index job_material_use_events_organization_id_fk_idx on public.job_material_use_events (organization_id);
create index job_material_use_events_project_id_fk_idx on public.job_material_use_events (project_id);
create index jobs_contact_id_fk_idx on public.jobs (contact_id);
create index leistung_price_versions_created_by_fk_idx on public.leistung_price_versions (created_by);
create index leistung_price_versions_organization_id_leistung_id_fk_idx on public.leistung_price_versions (organization_id, leistung_id);
create index leistungen_created_by_fk_idx on public.leistungen (created_by);
create index leistungen_updated_by_fk_idx on public.leistungen (updated_by);
create index on_call_shift_members_shift_fk_idx on public.on_call_shift_members (shift_id, organization_id);
create index organization_export_events_organization_id_export_id_fk_idx on public.organization_export_events (organization_id, export_id);
create index organization_export_files_organization_id_export_id_fk_idx on public.organization_export_files (organization_id, export_id);
create index organization_export_files_organization_id_part_id_fk_idx on public.organization_export_files (organization_id, part_id);
create index organization_export_parts_organization_id_export_id_fk_idx on public.organization_export_parts (organization_id, export_id);
create index organization_join_requests_organization_id_fk_idx on public.organization_join_requests (organization_id);
create index planning_occurrences_job_id_fk_idx on public.planning_occurrences (job_id);
create index problem_report_events_organization_id_report_id_fk_idx on public.problem_report_events (organization_id, report_id);
create index projects_contact_id_fk_idx on public.projects (contact_id);
create index projects_site_id_fk_idx on public.projects (site_id);
create index site_access_proposals_organization_id_fk_idx on public.site_access_proposals (organization_id);
create index time_account_opening_corrections_created_by_fk_idx on public.time_account_opening_corrections (created_by);
create index time_account_opening_corrections_opening_org_fk_idx on public.time_account_opening_corrections (organization_id, opening_event_id);
create index time_account_opening_corrections_reversal_org_fk_idx on public.time_account_opening_corrections (organization_id, reversal_event_id);
create index time_account_opening_corrections_reversed_org_fk_idx on public.time_account_opening_corrections (organization_id, reversed_event_id);
create index werkflow_subscriptions_reserved_by_fk_idx on public.werkflow_subscriptions (reserved_by);
create index work_artifact_draft_operations_revision_fk_idx on public.work_artifact_draft_operations (organization_id, revision_id);
create index work_blockers_organization_id_fk_idx on public.work_blockers (organization_id);
create index work_dependencies_organization_id_fk_idx on public.work_dependencies (organization_id);
create index work_handover_events_organization_id_fk_idx on public.work_handover_events (organization_id);
create index work_leads_organization_id_fk_idx on public.work_leads (organization_id);
create index work_request_entries_created_by_fk_idx on public.work_request_entries (created_by);
create index work_request_entries_job_id_fk_idx on public.work_request_entries (job_id);
create index work_request_entries_organization_id_fk_idx on public.work_request_entries (organization_id);
create index work_request_entries_project_id_fk_idx on public.work_request_entries (project_id);

-- 2a. The realtime deletion notice already returned early for an organization
-- being deleted (20260907010200); the WHEN clause skips the call itself.
-- profiles has no organization_id and keeps its trigger.
do $$
declare
  v_table regclass;
begin
  for v_table in
    select trigger_row.tgrelid::regclass
    from pg_catalog.pg_trigger trigger_row
    where trigger_row.tgfoid = 'app_private.emit_realtime_deletion()'::regprocedure
      and trigger_row.tgrelid <> 'public.profiles'::regclass
  loop
    execute format($trigger$
      create or replace trigger emit_realtime_deletion after delete on %s
      for each row
      when (not coalesce(old.organization_id::text = any (pg_catalog.string_to_array(
        pg_catalog.current_setting('app.deleting_organization_ids', true), ',')), false))
      execute function app_private.emit_realtime_deletion()
    $trigger$, v_table);
  end loop;
end;
$$;

-- 2b. A deleted job touches its project's work lead, and a deleted visit
-- projects the remaining plan onto its job. Neither has anything to do when
-- the organization goes, nor without a project or job. The delete side moves to
-- its own trigger, whose WHEN clause can read the old row; the functions stay.
create or replace trigger touch_work_lead after insert or update on public.jobs
  for each row execute function app_private.touch_work_lead_from_job();
create trigger touch_work_lead_on_delete after delete on public.jobs
  for each row
  when (old.project_id is not null and not coalesce(old.organization_id::text = any (
    pg_catalog.string_to_array(pg_catalog.current_setting('app.deleting_organization_ids', true), ',')), false))
  execute function app_private.touch_work_lead_from_job();

create or replace trigger sync_job_status_from_planning_occurrences
  after insert or update of status, job_id on public.planning_occurrences
  for each row execute function app_private.sync_job_status_from_planning_occurrences();
create trigger sync_job_status_from_planning_occurrences_on_delete after delete on public.planning_occurrences
  for each row
  when (old.job_id is not null and not coalesce(old.organization_id::text = any (
    pg_catalog.string_to_array(pg_catalog.current_setting('app.deleting_organization_ids', true), ',')), false))
  execute function app_private.sync_job_status_from_planning_occurrences();

-- 2c. The event-ledger guard lets a cascade remove a ledger row only when a
-- cascading parent is gone; it found that out by reading the catalog and
-- querying every such parent, per row. An organization being deleted takes
-- every ledger row it owns, so the guard now allows those rows first: inside a
-- cascade, for an organization app.deleting_organization_ids names and whose
-- row is already gone. The setting alone is no proof, since a session can set
-- it; the missing organization row is the parent check the loop would make.
create or replace function app_private.guard_event_ledger_history()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  foreign_key record;
  old_payload jsonb := to_jsonb(old);
  new_payload jsonb;
  parent_exists boolean;
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 and old_payload ->> 'organization_id' = any (
    string_to_array(current_setting('app.deleting_organization_ids', true), ',')
  ) and not exists (
    select 1 from public.organizations organization
    where organization.id = (old_payload ->> 'organization_id')::uuid
  ) then return old; end if;
  if pg_trigger_depth() > 1 then
    if tg_op = 'UPDATE' then new_payload := to_jsonb(new); end if;
    for foreign_key in
      select constraint_row.confrelid, constraint_row.confdeltype,
        array_agg(child_column.attname::text order by key_column.ordinality) as child_columns,
        jsonb_object_agg(parent_column.attname, old_payload -> child_column.attname) as parent_key,
        bool_and(old_payload -> child_column.attname <> 'null'::jsonb) as has_parent_key,
        string_agg(format('parent.%I is not distinct from expected.%I', parent_column.attname,
          parent_column.attname), ' and ' order by key_column.ordinality) as parent_match
      from pg_catalog.pg_constraint constraint_row
      cross join lateral unnest(constraint_row.conkey, constraint_row.confkey)
        with ordinality as key_column(child_number, parent_number, ordinality)
      join pg_catalog.pg_attribute child_column on child_column.attrelid = constraint_row.conrelid
        and child_column.attnum = key_column.child_number
      join pg_catalog.pg_attribute parent_column on parent_column.attrelid = constraint_row.confrelid
        and parent_column.attnum = key_column.parent_number
      where constraint_row.conrelid = tg_relid and constraint_row.contype = 'f'
        and ((tg_op = 'DELETE' and constraint_row.confdeltype = 'c')
          or (tg_op = 'UPDATE' and constraint_row.confdeltype = 'n'))
      group by constraint_row.oid, constraint_row.confrelid, constraint_row.confdeltype
    loop
      if not foreign_key.has_parent_key then continue; end if;
      if tg_op = 'UPDATE' and (
        old_payload - foreign_key.child_columns is distinct from new_payload - foreign_key.child_columns
        or exists (select 1 from unnest(foreign_key.child_columns) column_name
          where new_payload -> column_name is distinct from 'null'::jsonb)
      ) then continue; end if;

      execute format('select exists (select 1 from %s parent, jsonb_populate_record(null::%s, $1) expected where %s)',
        foreign_key.confrelid::regclass, foreign_key.confrelid::regclass, foreign_key.parent_match)
        into parent_exists using foreign_key.parent_key;
      if not parent_exists then
        if tg_op = 'DELETE' then return old; else return new; end if;
      end if;
    end loop;
  end if;
  raise exception 'event_ledger_history_immutable';
end;
$$;
revoke all on function app_private.guard_event_ledger_history() from public, anon, authenticated;
