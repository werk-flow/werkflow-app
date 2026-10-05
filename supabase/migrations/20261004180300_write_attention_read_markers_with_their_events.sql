-- Marking a notification read writes the read marker and its 'marked_read'
-- event together or not at all. The server actions in lib/attention/actions.ts
-- upserted attention_read_states first and inserted the attention_events row in
-- a second statement whose failure was only logged, so a marker could change
-- without its event. "Mark all read" could equally store every marker and lose
-- every event.
--
-- Division of work: the action establishes identity, the active membership and
-- the role, derives which notifications exist and are visible to the caller,
-- checks the single item's ownership, and passes the server-resolved markers
-- for the caller's own user and organization. The function locks the actor's
-- membership and each marker's source row, repeats the audience check per
-- source type (own vacation decision; own or managed sickness report; managed
-- certification) and raises the action failure code of the first refusal, so
-- nothing changes. It writes only rows of p_actor_id in p_organization_id.
--
-- A function per call, not a trigger on attention_read_states: the event
-- payload carries 'via' = 'mark_all' only for the bulk action, which a trigger
-- on the marker cannot know, and the request ledger writes its history the
-- same way. As before, every call records an event, also when the marker
-- already held the same version.
--
-- Signals stay as before: the marker INSERT or UPDATE reaches the Realtime
-- publication of attention_read_states; attention_events keeps its publication
-- membership and its ledger guard.

-- The actor's role in the organization, held until commit: a removal or a
-- role change waits for this call or makes it refuse.
-- Runs as the calling function's owner; no role executes it directly.
create function app_private.lock_attention_reader(p_organization_id uuid, p_actor_id uuid)
returns text
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_role text;
begin
  select member.role into v_role from public.organization_members member
  where member.organization_id = p_organization_id and member.user_id = p_actor_id
  for share;
  if not found then raise exception 'not_authorized'; end if;
  return v_role;
end;
$$;

-- The source of one marker exists in the organization, stays until commit and
-- belongs to the actor's audience. Refusals: request_not_found, not_authorized.
create function app_private.assert_attention_marker_source(
  p_organization_id uuid,
  p_actor_id uuid,
  p_actor_role text,
  p_source_type text,
  p_source_id uuid
)
returns void
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_is_manager boolean := p_actor_role in ('admin', 'buero');
  v_subject_record_id uuid;
begin
  if p_source_type = 'vacation_decision' then
    select request.employee_record_id into v_subject_record_id from public.vacation_requests request
    where request.organization_id = p_organization_id and request.id = p_source_id
    for key share;
    if not found then raise exception 'request_not_found'; end if;
  elsif p_source_type = 'sickness_report' then
    select report.employee_record_id into v_subject_record_id from public.sickness_reports report
    where report.organization_id = p_organization_id and report.id = p_source_id
    for key share;
    if not found then raise exception 'request_not_found'; end if;
    if v_is_manager then return; end if;
  elsif p_source_type = 'employee_certification_expiry' then
    if not v_is_manager then raise exception 'not_authorized'; end if;
    perform 1 from public.employee_capabilities capability
    where capability.organization_id = p_organization_id and capability.id = p_source_id
      and capability.capability_kind = 'certification'
    for key share;
    if not found then raise exception 'request_not_found'; end if;
    return;
  else
    raise exception 'invalid_input';
  end if;

  -- A vacation decision, and a sickness report for a non-manager, is read
  -- only by the person on the source's employee record.
  if not exists (
    select 1 from public.employee_records record
    where record.organization_id = p_organization_id and record.id = v_subject_record_id
      and record.user_id = p_actor_id
  ) then raise exception 'not_authorized'; end if;
end;
$$;

-- Stores the actor's read markers at the given versions and records one
-- 'marked_read' event per marker with payload {"state_version"} and, for
-- p_via = 'mark_all', {"via": "mark_all"}. p_markers is a non-empty JSON array
-- of {"source_type", "source_id", "state_version"} without duplicates.
-- Refusals: invalid_input, not_authorized, request_not_found.
create function public.mark_attention_notifications_read(
  p_actor_id uuid,
  p_organization_id uuid,
  p_markers jsonb,
  p_via text
)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_role text;
  v_marker record;
begin
  if p_actor_id is null or p_organization_id is null
    or jsonb_typeof(p_markers) is distinct from 'array' or jsonb_array_length(p_markers) = 0
    or (p_via is not null and p_via <> 'mark_all')
  then
    raise exception 'invalid_input';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_markers) element
    where jsonb_typeof(element) <> 'object'
      or coalesce(element ->> 'source_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or coalesce(length(element ->> 'state_version'), 0) not between 1 and 200
  ) or (
    select count(*) <> count(distinct (element ->> 'source_type', lower(element ->> 'source_id')))
    from jsonb_array_elements(p_markers) element
  ) then
    raise exception 'invalid_input';
  end if;

  v_role := app_private.lock_attention_reader(p_organization_id, p_actor_id);

  for v_marker in
    select marker.source_type, marker.source_id, marker.state_version
    from jsonb_to_recordset(p_markers) as marker(source_type text, source_id uuid, state_version text)
  loop
    perform app_private.assert_attention_marker_source(
      p_organization_id, p_actor_id, v_role, v_marker.source_type, v_marker.source_id
    );

    insert into public.attention_read_states (
      organization_id, user_id, source_type, source_id, state_version, read_at, updated_at
    ) values (
      p_organization_id, p_actor_id, v_marker.source_type, v_marker.source_id, v_marker.state_version, now(), now()
    )
    on conflict (organization_id, user_id, source_type, source_id) do update
    set state_version = excluded.state_version, read_at = excluded.read_at, updated_at = excluded.updated_at;

    insert into public.attention_events (
      organization_id, user_id, source_type, source_id, event_type, event_payload
    ) values (
      p_organization_id, p_actor_id, v_marker.source_type, v_marker.source_id, 'marked_read',
      jsonb_build_object('state_version', v_marker.state_version)
        || case when p_via is null then '{}'::jsonb else jsonb_build_object('via', p_via) end
    );
  end loop;
end;
$$;

revoke all on function app_private.lock_attention_reader(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function app_private.assert_attention_marker_source(uuid, uuid, text, text, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.mark_attention_notifications_read(uuid, uuid, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.mark_attention_notifications_read(uuid, uuid, jsonb, text) to service_role;
