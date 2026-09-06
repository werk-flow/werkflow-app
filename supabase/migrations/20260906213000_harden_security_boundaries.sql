-- Security and infrastructure hardening (docs/plans/security-infrastructure-hardening-2026-09.md).
--
-- SI-008: DEV carried an older body of fulfill_instruction_evidence without the
--   requirement-not-found guard that 20260824024602 committed and PROD runs.
--   Re-creating the committed body aligns both projects; PROD is unchanged.
-- SI-008: trigger functions and two lookup RPCs were executable by anon and
--   authenticated through PostgREST because of default PUBLIC grants.
-- SI-022: check_user_exists_by_email answered account existence to anyone;
--   the app only ever calls it and get_invite_by_code with the service role.
-- SI-011: inventory_movements and inventory_audit_events are ledgers, but the
--   manager policy granted UPDATE and DELETE. They become append-only; the
--   organization cascade (app.deleting_organization_ids) stays allowed.

create or replace function public.fulfill_instruction_evidence(
  p_organization_id uuid,
  p_actor_id uuid,
  p_fulfillment_id uuid,
  p_evidence_requirement_id uuid,
  p_document_id uuid,
  p_artifact_revision_id uuid,
  p_note text
)
returns public.job_instruction_item_evidence_fulfillments
language plpgsql security definer set search_path = ''
as $$
declare
  v_existing public.job_instruction_item_evidence_fulfillments%rowtype;
  v_requirement public.job_instruction_item_evidence_requirements%rowtype;
  v_item public.job_instruction_items%rowtype;
  v_artifact public.work_artifacts%rowtype;
  v_result public.job_instruction_item_evidence_fulfillments%rowtype;
begin
  select * into v_existing from public.job_instruction_item_evidence_fulfillments fulfillment
  where fulfillment.id = p_fulfillment_id;
  if found then
    if v_existing.evidence_requirement_id <> p_evidence_requirement_id
      or v_existing.document_id is distinct from p_document_id
      or v_existing.artifact_revision_id is distinct from p_artifact_revision_id then
      raise exception 'instruction_evidence_idempotency_conflict';
    end if;
    return v_existing;
  end if;

  select * into v_requirement from public.job_instruction_item_evidence_requirements requirement
  where requirement.id = p_evidence_requirement_id
    and requirement.organization_id = p_organization_id;
  if not found then raise exception 'instruction_evidence_requirement_not_found'; end if;
  select * into v_item from public.job_instruction_items item
  where item.id = v_requirement.instruction_item_id and item.organization_id = p_organization_id;
  if not found then raise exception 'instruction_evidence_requirement_not_found'; end if;
  if not app_private.can_access_work_artifact_target(
    p_organization_id, v_item.job_id, v_item.project_id, p_actor_id
  ) then raise exception 'instruction_evidence_not_authorized'; end if;
  if exists (
    select 1 from public.job_instruction_item_evidence_fulfillments fulfillment
    where fulfillment.evidence_requirement_id = p_evidence_requirement_id
      and fulfillment.removed_at is null
  ) then raise exception 'instruction_evidence_already_fulfilled'; end if;

  if p_document_id is not null and not exists (
    select 1
    from public.documents document
    join public.document_links link on link.document_id = document.id
    where document.id = p_document_id and document.organization_id = p_organization_id
      and document.deleted_at is null and document.category = v_requirement.document_category
      and ((v_item.job_id is not null and link.job_id = v_item.job_id)
        or (v_item.project_id is not null and link.project_id = v_item.project_id))
  ) then raise exception 'instruction_evidence_document_target_or_category_mismatch'; end if;

  if p_artifact_revision_id is not null then
    select artifact.* into v_artifact
    from public.work_artifact_revisions revision
    join public.work_artifacts artifact on artifact.id = revision.artifact_id
    where revision.id = p_artifact_revision_id and revision.organization_id = p_organization_id;
    if not found or v_artifact.status = 'voided'
      or (v_artifact.job_id is distinct from v_item.job_id
        or v_artifact.project_id is distinct from v_item.project_id) then
      raise exception 'instruction_evidence_artifact_target_mismatch';
    end if;
  end if;

  insert into public.job_instruction_item_evidence_fulfillments (
    id, organization_id, evidence_requirement_id, document_id,
    artifact_revision_id, note, created_by
  ) values (
    p_fulfillment_id, p_organization_id, p_evidence_requirement_id,
    p_document_id, p_artifact_revision_id, nullif(btrim(p_note), ''), p_actor_id
  ) returning * into v_result;
  return v_result;
end;
$$;

-- Trigger functions are invoked by their triggers as the table owner and must
-- not be callable as RPCs.
revoke all on function public.set_job_assignment_organization() from public, anon, authenticated;
revoke all on function public.guard_automatic_time_entry_timestamps() from public, anon, authenticated;
revoke all on function public.update_subscriptions_updated_at() from public, anon, authenticated;
revoke all on function public.update_time_entries_updated_at() from public, anon, authenticated;
revoke all on function public.update_updated_at_column() from public, anon, authenticated;
grant execute on function public.set_job_assignment_organization() to postgres, service_role;
grant execute on function public.guard_automatic_time_entry_timestamps() to postgres, service_role;
grant execute on function public.update_subscriptions_updated_at() to postgres, service_role;
grant execute on function public.update_time_entries_updated_at() to postgres, service_role;
grant execute on function public.update_updated_at_column() to postgres, service_role;

-- Service-role-only lookups (the application calls them with the admin client).
revoke all on function public.check_user_exists_by_email(text) from public, anon, authenticated;
revoke all on function app_private.check_user_exists_by_email(text) from public, anon, authenticated;
revoke all on function public.get_invite_by_code(text) from public, anon, authenticated;
revoke all on function app_private.get_invite_by_code(text) from public, anon, authenticated;
grant execute on function public.check_user_exists_by_email(text) to postgres, service_role;
grant execute on function app_private.check_user_exists_by_email(text) to postgres, service_role;
grant execute on function public.get_invite_by_code(text) to postgres, service_role;
grant execute on function app_private.get_invite_by_code(text) to postgres, service_role;

-- Signed-in members never need these with a foreign user id; the security
-- invoker wrappers (get_org_members, redeem_organization_invite) pass auth.uid().
revoke all on function app_private.get_org_members_for_user(uuid, uuid) from public, anon;
revoke all on function app_private.redeem_organization_invite_for_user(text, uuid) from public, anon;

-- Inventory ledgers are append-only.
revoke update, delete on public.inventory_movements from public, anon, authenticated;
revoke update, delete on public.inventory_audit_events from public, anon, authenticated;

create or replace function app_private.guard_inventory_ledger_append_only()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  if tg_op = 'DELETE'
    and old.organization_id::text = any(string_to_array(coalesce(
      current_setting('app.deleting_organization_ids', true), ''
    ), ','))
  then return old; end if;
  raise exception 'inventory_ledger_append_only';
end;
$$;

revoke all on function app_private.guard_inventory_ledger_append_only() from public, anon, authenticated;
grant execute on function app_private.guard_inventory_ledger_append_only() to postgres, service_role;

drop trigger if exists guard_inventory_movements_append_only on public.inventory_movements;
create trigger guard_inventory_movements_append_only
before update or delete on public.inventory_movements
for each row execute function app_private.guard_inventory_ledger_append_only();

drop trigger if exists guard_inventory_audit_events_append_only on public.inventory_audit_events;
create trigger guard_inventory_audit_events_append_only
before update or delete on public.inventory_audit_events
for each row execute function app_private.guard_inventory_ledger_append_only();
