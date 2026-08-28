-- P1-17: make release lineage tenant-structural and fail closed on malformed gates.

alter table public.work_handover_releases
  drop constraint work_handover_releases_previous_fkey,
  add constraint work_handover_releases_previous_fkey
    foreign key (previous_release_id, organization_id)
    references public.work_handover_releases(id, organization_id) on delete restrict;

alter table public.work_handover_draft_items
  drop constraint work_handover_draft_items_child_handover_release_id_fkey,
  add constraint work_handover_draft_items_child_handover_release_fkey
    foreign key (child_handover_release_id, organization_id)
    references public.work_handover_releases(id, organization_id) on delete restrict;

alter table public.work_handover_release_items
  drop constraint work_handover_release_items_child_handover_release_id_fkey,
  add constraint work_handover_release_items_child_handover_release_fkey
    foreign key (child_handover_release_id, organization_id)
    references public.work_handover_releases(id, organization_id) on delete restrict;

alter table public.work_handover_events
  drop constraint work_handover_events_release_id_fkey,
  drop constraint work_handover_events_previous_release_id_fkey,
  add constraint work_handover_events_release_fkey
    foreign key (release_id, organization_id)
    references public.work_handover_releases(id, organization_id) on delete restrict,
  add constraint work_handover_events_previous_release_fkey
    foreign key (previous_release_id, organization_id)
    references public.work_handover_releases(id, organization_id) on delete restrict;

alter function app_private.build_work_gate_snapshot(uuid, uuid, uuid)
  rename to build_work_gate_snapshot_p1_17_inner;

revoke all on function app_private.build_work_gate_snapshot_p1_17_inner(
  uuid, uuid, uuid
) from public, anon, authenticated, service_role;

create function app_private.build_work_gate_snapshot(
  p_organization_id uuid,
  p_job_id uuid,
  p_project_id uuid
)
returns jsonb language sql stable security definer set search_path = ''
as $$
  with snapshot as (
    select app_private.build_work_gate_snapshot_p1_17_inner(
      p_organization_id, p_job_id, p_project_id
    ) as value
  ), deduplicated as (
    select entry.value, min(entry.ordinality) as first_ordinality
    from snapshot,
      jsonb_array_elements(coalesce(snapshot.value->'notAssessable', '[]'::jsonb))
        with ordinality as entry(value, ordinality)
    group by entry.value
  )
  select snapshot.value || jsonb_build_object(
    'notAssessable',
    coalesce(
      (select jsonb_agg(deduplicated.value order by deduplicated.first_ordinality)
       from deduplicated),
      '[]'::jsonb
    )
  )
  from snapshot;
$$;

revoke all on function app_private.build_work_gate_snapshot(
  uuid, uuid, uuid
) from public, anon, authenticated;
grant execute on function app_private.build_work_gate_snapshot(
  uuid, uuid, uuid
) to service_role;

create or replace function app_private.transition_work_execution_for_handover(
  p_organization_id uuid,
  p_actor_id uuid,
  p_target_type text,
  p_target_id uuid,
  p_expected_version bigint,
  p_to_state public.work_execution_state,
  p_reason text,
  p_override_gates boolean,
  p_origin text
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
  v_snapshot jsonb;
  v_active_clocks text;
begin
  if p_origin = 'p1_17_release' then
    v_snapshot := app_private.build_work_gate_snapshot(
      p_organization_id,
      case when p_target_type = 'job' then p_target_id else null end,
      case when p_target_type = 'project' then p_target_id else null end
    );
    if jsonb_typeof(v_snapshot->'activeJobClocks') is distinct from 'number'
    then raise exception 'work_handover_active_clock'; end if;
    v_active_clocks := v_snapshot->>'activeJobClocks';
    if v_active_clocks !~ '^[0-9]+$' or v_active_clocks::numeric <> 0
    then raise exception 'work_handover_active_clock'; end if;
  end if;

  return query select * from app_private.transition_work_execution_for_handover_p1_17_inner(
    p_organization_id, p_actor_id, p_target_type, p_target_id,
    p_expected_version, p_to_state, p_reason, p_override_gates, p_origin
  );
  perform set_config('app.work_execution_write', '', true);
exception when others then
  perform set_config('app.work_execution_write', '', true);
  raise;
end;
$$;
