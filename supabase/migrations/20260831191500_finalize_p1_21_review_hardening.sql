-- P1-21 review closure: keep replay authorization symmetric and make member
-- removal one transaction across canonical time, legacy time and membership.

create or replace function app_private.mark_time_capture_organization_delete()
returns trigger
language plpgsql
security invoker
as $$
begin
  -- No function-level SET clause: a transaction-local GUC set under a
  -- function configuration frame is restored when that frame exits.
  perform pg_catalog.set_config(
    'app.time_capture_cascade_organization_id', old.id::text, true
  );
  return old;
end;
$$;

create or replace function public.link_work_artifact_time_segment(
  p_organization_id uuid,
  p_actor_id uuid,
  p_artifact_id uuid,
  p_revision_id uuid,
  p_link_id uuid,
  p_expected_version bigint,
  p_time_segment_id uuid,
  p_description text
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_artifact public.work_artifacts%rowtype;
  v_existing public.work_artifact_revision_sources%rowtype;
  v_version bigint;
begin
  select * into v_existing
  from public.work_artifact_revision_sources source
  where source.id = p_link_id
    and source.organization_id = p_organization_id;
  if found then
    if v_existing.revision_id <> p_revision_id
      or v_existing.time_segment_id is distinct from p_time_segment_id
    then raise exception 'work_artifact_source_idempotency_conflict'; end if;
    select * into v_artifact
    from public.work_artifacts artifact
    where artifact.id = p_artifact_id
      and artifact.organization_id = p_organization_id;
    if not found then raise exception 'work_artifact_not_found'; end if;
    if not app_private.can_access_work_artifact_target(
      p_organization_id, v_artifact.job_id, v_artifact.project_id, p_actor_id
    ) then raise exception 'work_artifact_not_authorized'; end if;
    return jsonb_build_object(
      'linkId', p_link_id,
      'version', v_artifact.version,
      'duplicate', true
    );
  end if;

  select * into v_artifact
  from public.work_artifacts artifact
  where artifact.id = p_artifact_id
    and artifact.organization_id = p_organization_id
  for update;
  if not found then raise exception 'work_artifact_not_found'; end if;
  if v_artifact.status = 'voided'
  then raise exception 'work_artifact_is_voided'; end if;
  if v_artifact.version is distinct from p_expected_version
  then raise exception 'work_artifact_stale_version'; end if;
  if v_artifact.current_revision_id is distinct from p_revision_id
  then raise exception 'work_artifact_relation_requires_current_revision'; end if;
  if not app_private.can_access_work_artifact_target(
    p_organization_id, v_artifact.job_id, v_artifact.project_id, p_actor_id
  ) then raise exception 'work_artifact_not_authorized'; end if;

  insert into public.work_artifact_revision_sources (
    id, organization_id, revision_id, time_segment_id, description, created_by
  ) values (
    p_link_id, p_organization_id, p_revision_id, p_time_segment_id,
    nullif(btrim(p_description), ''), p_actor_id
  );
  v_version := v_artifact.version + 1;
  update public.work_artifacts
  set version = v_version, updated_at = now()
  where id = p_artifact_id;
  return jsonb_build_object(
    'linkId', p_link_id,
    'version', v_version,
    'duplicate', false
  );
end;
$$;

create or replace function public.remove_member_with_time_capture(
  p_organization_id uuid,
  p_target_user_id uuid,
  p_actor_id uuid,
  p_operation_id uuid
)
returns boolean
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_canonical_closed boolean;
  v_legacy_open boolean := false;
begin
  v_canonical_closed := public.close_time_session_for_member_removal(
    p_organization_id,
    p_target_user_id,
    p_actor_id,
    p_operation_id
  );

  select entry.entry_type in ('clock_in', 'break_end')
  into v_legacy_open
  from public.time_entries entry
  where entry.organization_id = p_organization_id
    and entry.user_id = p_target_user_id
    and entry.status not in ('rejected', 'pending_delete')
  order by entry.timestamp desc, entry.created_at desc, entry.id desc
  limit 1;

  delete from public.time_entries entry
  where entry.organization_id = p_organization_id
    and entry.user_id = p_target_user_id;

  delete from public.organization_members membership
  where membership.organization_id = p_organization_id
    and membership.user_id = p_target_user_id;
  if not found then raise exception 'time_member_removal_target_missing'; end if;

  return coalesce(v_canonical_closed, false) or coalesce(v_legacy_open, false);
end;
$$;

revoke all on function public.remove_member_with_time_capture(
  uuid, uuid, uuid, uuid
) from public, anon, authenticated;
grant execute on function public.remove_member_with_time_capture(
  uuid, uuid, uuid, uuid
) to service_role;
