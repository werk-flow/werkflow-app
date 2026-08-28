create or replace function public.transition_work_execution(
  p_organization_id uuid,
  p_actor_id uuid,
  p_target_type text,
  p_target_id uuid,
  p_expected_version bigint,
  p_to_state public.work_execution_state,
  p_reason text default null,
  p_override_gates boolean default false
)
returns table (
  execution_state public.work_execution_state,
  execution_version bigint,
  event_id uuid,
  gate_snapshot jsonb,
  gate_fingerprint text
)
language plpgsql security definer set search_path = ''
as $$
declare
  v_origin text := coalesce(current_setting('app.work_transition_origin', true), '');
begin
  if v_origin in ('p1_17_release', 'p1_17_withdrawal', 'p1_17_correction') then
    perform set_config('app.work_transition_origin', '', true);
    return query select * from app_private.transition_work_execution_for_handover(
      p_organization_id, p_actor_id, p_target_type, p_target_id,
      p_expected_version, p_to_state, p_reason, p_override_gates, v_origin
    );
    return;
  end if;
  if p_to_state = 'handed_over' then raise exception 'work_handover_release_required'; end if;
  return query select * from public.transition_work_execution_p1_15(
    p_organization_id, p_actor_id, p_target_type, p_target_id,
    p_expected_version, p_to_state, p_reason, p_override_gates
  );
end;
$$;

revoke all on function public.transition_work_execution(
  uuid, uuid, text, uuid, bigint, public.work_execution_state, text, boolean
) from public, anon, authenticated;
grant execute on function public.transition_work_execution(
  uuid, uuid, text, uuid, bigint, public.work_execution_state, text, boolean
) to service_role;
