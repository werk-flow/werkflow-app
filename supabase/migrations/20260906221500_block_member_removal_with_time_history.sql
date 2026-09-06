-- SI-006 containment (owner decision 2026-09-06): until P1-33 delivers retained
-- historical identity, a member who has any recorded time may not be removed.
-- The previous contract deleted the member's whole time_entries history in the
-- same statement. Removal of members without time history keeps its behaviour;
-- members with history must go through the P1-24 employment transitions.

create or replace function public.remove_member_with_time_capture(
  p_organization_id uuid,
  p_target_user_id uuid,
  p_actor_id uuid,
  p_operation_id uuid
)
returns boolean
language plpgsql
set search_path to ''
as $$
declare
  v_canonical_closed boolean;
  v_legacy_open boolean := false;
begin
  if not exists (
    select 1 from public.organization_members membership
    where membership.organization_id = p_organization_id
      and membership.user_id = p_target_user_id
  ) then raise exception 'time_member_removal_target_missing'; end if;

  if exists (
    select 1 from public.time_entries entry
    where entry.organization_id = p_organization_id
      and entry.user_id = p_target_user_id
  ) or exists (
    select 1 from public.time_sessions session
    where session.organization_id = p_organization_id
      and session.user_id = p_target_user_id
  ) then raise exception 'time_member_removal_has_history'; end if;

  v_canonical_closed := public.close_time_session_for_member_removal(
    p_organization_id, p_target_user_id, p_actor_id, p_operation_id
  );

  delete from public.organization_members membership
  where membership.organization_id = p_organization_id
    and membership.user_id = p_target_user_id;
  if not found then raise exception 'time_member_removal_target_missing'; end if;
  return coalesce(v_canonical_closed, false) or coalesce(v_legacy_open, false);
end;
$$;
