-- No surface subscribes to these tables. Their changes reach users through a
-- published owning row: an attention read state, an instruction item, a
-- template version, a capability requirement, an inventory item or a payroll
-- export. Each published table costs a replication binding per connected
-- organization channel, so the rows that signal nothing leave the publication.
--
-- The deletion trigger leaves with the publication: a deletion notice for a
-- table that no client binds would only fill realtime_deletions. The unique
-- (id, organization_id) indexes and the replica identities stay; they are
-- inert outside a publication and other constraints may depend on the indexes.
-- lib/realtime/tables.ts drops the same names in the same change, and
-- realtime:check fails until the list and the publication agree.
do $$
declare
  trimmed text;
begin
  foreach trimmed in array array[
    'payroll_mapping_profiles',
    'attention_events',
    'job_instruction_item_evidence_requirements',
    'job_instruction_item_dependencies',
    'work_template_items',
    'work_template_item_evidence_requirements',
    'work_template_item_dependencies',
    'work_template_material_lines',
    'work_template_capability_requirements',
    'job_capability_requirement_origins',
    'inventory_audit_events'
  ] loop
    if exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = trimmed
    ) then
      execute format('alter publication supabase_realtime drop table public.%I', trimmed);
    end if;
    execute format('drop trigger if exists emit_realtime_deletion on public.%I', trimmed);
  end loop;
end;
$$;
