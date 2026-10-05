-- Team, membership, capability definition and apprentice warning writes store
-- the change and its history row in one call or nothing, and refuse with the
-- action's failure codes (migration
-- 20261004180000_write_qualification_history_with_its_change.sql).
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
('c1000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'qualification-history-admin@example.test', '', now(), '{}',
 '{"first_name":"Admin","last_name":"Qualifikation"}', now(), now()),
('c1000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'qualification-history-buero@example.test', '', now(), '{}',
 '{"first_name":"Büro","last_name":"Qualifikation"}', now(), now()),
('c1000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'qualification-history-employee@example.test', '', now(), '{}',
 '{"first_name":"Employee","last_name":"Qualifikation"}', now(), now()),
('c1000000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'qualification-history-outsider@example.test', '', now(), '{}',
 '{"first_name":"Outsider","last_name":"Qualifikation"}', now(), now());

insert into public.organizations (id, name, admin_id, unique_code) values
('c1000000-0000-4000-8000-000000000010', 'Qualification history SQL',
 'c1000000-0000-4000-8000-000000000001', 'QUALHIST'),
('c1000000-0000-4000-8000-000000000011', 'Qualification history SQL other',
 'c1000000-0000-4000-8000-000000000004', 'QUALHISTO');
insert into public.organization_members (organization_id, user_id, role) values
('c1000000-0000-4000-8000-000000000010', 'c1000000-0000-4000-8000-000000000002', 'buero'),
('c1000000-0000-4000-8000-000000000010', 'c1000000-0000-4000-8000-000000000003', 'employee');

insert into public.employee_records (id, organization_id, first_name, last_name) values
('c1000000-0000-4000-8000-000000000020', 'c1000000-0000-4000-8000-000000000010', 'Erika', 'Muster'),
('c1000000-0000-4000-8000-000000000021', 'c1000000-0000-4000-8000-000000000010', 'Max', 'Muster'),
('c1000000-0000-4000-8000-000000000029', 'c1000000-0000-4000-8000-000000000011', 'Fremd', 'Person');

insert into public.teams (id, organization_id, name, description, dissolved_at) values
('c1000000-0000-4000-8000-000000000030', 'c1000000-0000-4000-8000-000000000010', 'Team A', 'Bad', null),
('c1000000-0000-4000-8000-000000000031', 'c1000000-0000-4000-8000-000000000010', 'Team B', null, null),
('c1000000-0000-4000-8000-000000000032', 'c1000000-0000-4000-8000-000000000010', 'Team Alt', null, now()),
('c1000000-0000-4000-8000-000000000039', 'c1000000-0000-4000-8000-000000000011', 'Fremdes Team', null, null);

insert into public.team_memberships (id, organization_id, team_id, employee_record_id, valid_from) values
('c1000000-0000-4000-8000-000000000040', 'c1000000-0000-4000-8000-000000000010',
 'c1000000-0000-4000-8000-000000000030', 'c1000000-0000-4000-8000-000000000020', '2026-01-01'),
('c1000000-0000-4000-8000-000000000049', 'c1000000-0000-4000-8000-000000000011',
 'c1000000-0000-4000-8000-000000000039', 'c1000000-0000-4000-8000-000000000029', '2026-01-01');

insert into public.organization_capabilities (
  id, organization_id, kind, name, default_expiry_warning_days, retired_at
) values
('c1000000-0000-4000-8000-000000000050', 'c1000000-0000-4000-8000-000000000010', 'skill', 'Löten', 0, null),
('c1000000-0000-4000-8000-000000000051', 'c1000000-0000-4000-8000-000000000010', 'certification', 'Alt', 30, now()),
('c1000000-0000-4000-8000-000000000059', 'c1000000-0000-4000-8000-000000000011', 'skill', 'Fremd', 0, null);

-- Runs one statement and requires the named refusal.
create function pg_temp.expect_refusal(p_label text, p_statement text, p_refusal text) returns void
language plpgsql as $$
begin
  begin
    execute p_statement;
  exception when others then
    if sqlerrm <> p_refusal then
      raise exception '% refused with % instead of %', p_label, sqlerrm, p_refusal;
    end if;
    return;
  end;
  raise exception '% was not refused', p_label;
end;
$$;
grant execute on function pg_temp.expect_refusal(text, text, text) to service_role;

-- Both organizations' qualification rows and history as one comparable value.
create function pg_temp.qualification_state() returns text language sql as $$
  select concat_ws('#',
    (select string_agg(to_jsonb(team)::text, '|' order by team.id) from public.teams team
      where team.organization_id in ('c1000000-0000-4000-8000-000000000010', 'c1000000-0000-4000-8000-000000000011')),
    (select string_agg(to_jsonb(membership)::text, '|' order by membership.id) from public.team_memberships membership
      where membership.organization_id in ('c1000000-0000-4000-8000-000000000010', 'c1000000-0000-4000-8000-000000000011')),
    (select string_agg(to_jsonb(capability)::text, '|' order by capability.id)
      from public.organization_capabilities capability
      where capability.organization_id in ('c1000000-0000-4000-8000-000000000010', 'c1000000-0000-4000-8000-000000000011')),
    (select string_agg(to_jsonb(settings)::text, '|' order by settings.organization_id)
      from public.organization_qualification_settings settings
      where settings.organization_id in ('c1000000-0000-4000-8000-000000000010', 'c1000000-0000-4000-8000-000000000011')),
    (select count(*)::text from public.team_events event
      where event.organization_id in ('c1000000-0000-4000-8000-000000000010', 'c1000000-0000-4000-8000-000000000011')),
    (select count(*)::text from public.qualification_events event
      where event.organization_id in ('c1000000-0000-4000-8000-000000000010', 'c1000000-0000-4000-8000-000000000011'))
  );
$$;

create temporary table qualification_state_before as select pg_temp.qualification_state() as state;

-- Every refusal keeps its code and changes nothing.
set local role service_role;

select pg_temp.expect_refusal('team created by a field worker', $sql$
  select public.create_team('c1000000-0000-4000-8000-000000000003', 'c1000000-0000-4000-8000-000000000010', 'Team C', null)
$sql$, 'not_authorized');
select pg_temp.expect_refusal('team created by an outsider', $sql$
  select public.create_team('c1000000-0000-4000-8000-000000000004', 'c1000000-0000-4000-8000-000000000010', 'Team C', null)
$sql$, 'not_authorized');
select pg_temp.expect_refusal('team created without a name', $sql$
  select public.create_team('c1000000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-000000000010', '  ', null)
$sql$, 'invalid_input');
select pg_temp.expect_refusal('team created with a taken name', $sql$
  select public.create_team('c1000000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-000000000010', 'team a', null)
$sql$, 'duplicate_name');

select pg_temp.expect_refusal('edit of a team of another organization', $sql$
  select public.update_team('c1000000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-000000000010',
    'c1000000-0000-4000-8000-000000000039', 'Neu', null)
$sql$, 'team_not_found');
select pg_temp.expect_refusal('edit of a dissolved team', $sql$
  select public.update_team('c1000000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-000000000010',
    'c1000000-0000-4000-8000-000000000032', 'Neu', null)
$sql$, 'team_not_found');
select pg_temp.expect_refusal('edit by a field worker', $sql$
  select public.update_team('c1000000-0000-4000-8000-000000000003', 'c1000000-0000-4000-8000-000000000010',
    'c1000000-0000-4000-8000-000000000031', 'Neu', null)
$sql$, 'not_authorized');
select pg_temp.expect_refusal('edit without a name', $sql$
  select public.update_team('c1000000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-000000000010',
    'c1000000-0000-4000-8000-000000000031', ' ', null)
$sql$, 'invalid_input');
select pg_temp.expect_refusal('edit to a taken name', $sql$
  select public.update_team('c1000000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-000000000010',
    'c1000000-0000-4000-8000-000000000031', 'Team A', null)
$sql$, 'duplicate_name');

select pg_temp.expect_refusal('dissolving a team of another organization', $sql$
  select public.dissolve_team('c1000000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-000000000010',
    'c1000000-0000-4000-8000-000000000039', null)
$sql$, 'team_not_found');
select pg_temp.expect_refusal('dissolving a dissolved team', $sql$
  select public.dissolve_team('c1000000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-000000000010',
    'c1000000-0000-4000-8000-000000000032', null)
$sql$, 'team_not_found');
select pg_temp.expect_refusal('dissolving by a field worker', $sql$
  select public.dissolve_team('c1000000-0000-4000-8000-000000000003', 'c1000000-0000-4000-8000-000000000010',
    'c1000000-0000-4000-8000-000000000031', null)
$sql$, 'not_authorized');

select pg_temp.expect_refusal('membership in a team of another organization', $sql$
  select public.add_team_membership('c1000000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-000000000010',
    'c1000000-0000-4000-8000-000000000039', 'c1000000-0000-4000-8000-000000000021', '2026-03-01', null)
$sql$, 'team_not_found');
select pg_temp.expect_refusal('membership in a dissolved team', $sql$
  select public.add_team_membership('c1000000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-000000000010',
    'c1000000-0000-4000-8000-000000000032', 'c1000000-0000-4000-8000-000000000021', '2026-03-01', null)
$sql$, 'team_not_found');
select pg_temp.expect_refusal('membership added by a field worker', $sql$
  select public.add_team_membership('c1000000-0000-4000-8000-000000000003', 'c1000000-0000-4000-8000-000000000010',
    'c1000000-0000-4000-8000-000000000031', 'c1000000-0000-4000-8000-000000000021', '2026-03-01', null)
$sql$, 'not_authorized');
select pg_temp.expect_refusal('membership of an employee of another organization', $sql$
  select public.add_team_membership('c1000000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-000000000010',
    'c1000000-0000-4000-8000-000000000031', 'c1000000-0000-4000-8000-000000000029', '2026-03-01', null)
$sql$, 'employee_not_found');
select pg_temp.expect_refusal('overlapping membership', $sql$
  select public.add_team_membership('c1000000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-000000000010',
    'c1000000-0000-4000-8000-000000000030', 'c1000000-0000-4000-8000-000000000020', '2026-06-01', null)
$sql$, 'overlap');
select pg_temp.expect_refusal('membership ending before it starts', $sql$
  select public.add_team_membership('c1000000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-000000000010',
    'c1000000-0000-4000-8000-000000000031', 'c1000000-0000-4000-8000-000000000021', '2026-03-01', '2026-02-01')
$sql$, 'invalid_input');

select pg_temp.expect_refusal('ending a membership of another organization', $sql$
  select public.end_team_membership('c1000000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-000000000010',
    'c1000000-0000-4000-8000-000000000049', '2026-12-31')
$sql$, 'record_not_found');
select pg_temp.expect_refusal('ending a membership by a field worker', $sql$
  select public.end_team_membership('c1000000-0000-4000-8000-000000000003', 'c1000000-0000-4000-8000-000000000010',
    'c1000000-0000-4000-8000-000000000040', '2026-12-31')
$sql$, 'not_authorized');
select pg_temp.expect_refusal('ending a membership before it starts', $sql$
  select public.end_team_membership('c1000000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-000000000010',
    'c1000000-0000-4000-8000-000000000040', '2025-12-31')
$sql$, 'invalid_input');

select pg_temp.expect_refusal('definition created by a field worker', $sql$
  select public.create_capability_definition('c1000000-0000-4000-8000-000000000003',
    'c1000000-0000-4000-8000-000000000010', 'skill', 'Schweißen', null, 0)
$sql$, 'not_authorized');
select pg_temp.expect_refusal('definition of an unknown kind', $sql$
  select public.create_capability_definition('c1000000-0000-4000-8000-000000000002',
    'c1000000-0000-4000-8000-000000000010', 'hobby', 'Schweißen', null, 0)
$sql$, 'invalid_input');
select pg_temp.expect_refusal('definition with too many warning days', $sql$
  select public.create_capability_definition('c1000000-0000-4000-8000-000000000002',
    'c1000000-0000-4000-8000-000000000010', 'certification', 'Schweißschein', null, 400)
$sql$, 'invalid_input');
select pg_temp.expect_refusal('definition with a taken name', $sql$
  select public.create_capability_definition('c1000000-0000-4000-8000-000000000002',
    'c1000000-0000-4000-8000-000000000010', 'skill', ' löten ', null, 0)
$sql$, 'duplicate_name');

select pg_temp.expect_refusal('retiring a definition of another organization', $sql$
  select public.retire_capability_definition('c1000000-0000-4000-8000-000000000002',
    'c1000000-0000-4000-8000-000000000010', 'c1000000-0000-4000-8000-000000000059')
$sql$, 'definition_not_found');
select pg_temp.expect_refusal('retiring a retired definition', $sql$
  select public.retire_capability_definition('c1000000-0000-4000-8000-000000000002',
    'c1000000-0000-4000-8000-000000000010', 'c1000000-0000-4000-8000-000000000051')
$sql$, 'definition_not_found');
select pg_temp.expect_refusal('retiring by a field worker', $sql$
  select public.retire_capability_definition('c1000000-0000-4000-8000-000000000003',
    'c1000000-0000-4000-8000-000000000010', 'c1000000-0000-4000-8000-000000000050')
$sql$, 'not_authorized');

select pg_temp.expect_refusal('apprentice warning switched by the office', $sql$
  select public.set_apprentice_warning_enabled('c1000000-0000-4000-8000-000000000002',
    'c1000000-0000-4000-8000-000000000010', true)
$sql$, 'not_authorized');
select pg_temp.expect_refusal('apprentice warning switched by an outsider', $sql$
  select public.set_apprentice_warning_enabled('c1000000-0000-4000-8000-000000000004',
    'c1000000-0000-4000-8000-000000000010', true)
$sql$, 'not_authorized');

reset role;

-- The history row is the last step. When it is refused, the change is rolled
-- back with it: nothing changes without its history row.
create function pg_temp.refuse_history() returns trigger language plpgsql as $$
begin
  raise exception 'history refused';
end;
$$;
create trigger refuse_team_event before insert on public.team_events
  for each row execute function pg_temp.refuse_history();
create trigger refuse_qualification_event before insert on public.qualification_events
  for each row execute function pg_temp.refuse_history();

set local role service_role;
select pg_temp.expect_refusal('team creation whose history row is refused', $sql$
  select public.create_team('c1000000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-000000000010', 'Team C', null)
$sql$, 'history refused');
select pg_temp.expect_refusal('team edit whose history row is refused', $sql$
  select public.update_team('c1000000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-000000000010',
    'c1000000-0000-4000-8000-000000000031', 'Team Neu', 'Heizung')
$sql$, 'history refused');
select pg_temp.expect_refusal('dissolving whose history row is refused', $sql$
  select public.dissolve_team('c1000000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-000000000010',
    'c1000000-0000-4000-8000-000000000031', 'Umbau')
$sql$, 'history refused');
select pg_temp.expect_refusal('membership whose history row is refused', $sql$
  select public.add_team_membership('c1000000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-000000000010',
    'c1000000-0000-4000-8000-000000000031', 'c1000000-0000-4000-8000-000000000021', '2026-03-01', null)
$sql$, 'history refused');
select pg_temp.expect_refusal('membership end whose history row is refused', $sql$
  select public.end_team_membership('c1000000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-000000000010',
    'c1000000-0000-4000-8000-000000000040', '2026-12-31')
$sql$, 'history refused');
select pg_temp.expect_refusal('definition whose history row is refused', $sql$
  select public.create_capability_definition('c1000000-0000-4000-8000-000000000002',
    'c1000000-0000-4000-8000-000000000010', 'skill', 'Schweißen', null, 0)
$sql$, 'history refused');
select pg_temp.expect_refusal('retirement whose history row is refused', $sql$
  select public.retire_capability_definition('c1000000-0000-4000-8000-000000000002',
    'c1000000-0000-4000-8000-000000000010', 'c1000000-0000-4000-8000-000000000050')
$sql$, 'history refused');
select pg_temp.expect_refusal('apprentice warning whose history row is refused', $sql$
  select public.set_apprentice_warning_enabled('c1000000-0000-4000-8000-000000000001',
    'c1000000-0000-4000-8000-000000000010', true)
$sql$, 'history refused');
reset role;

drop trigger refuse_team_event on public.team_events;
drop trigger refuse_qualification_event on public.qualification_events;

do $$
begin
  if pg_temp.qualification_state() <> (select state from qualification_state_before) then
    raise exception 'a refused qualification write changed rows or history';
  end if;
end;
$$;

-- Each clean write stores the change and exactly its history row.
set local role service_role;

do $$
declare
  v_org constant uuid := 'c1000000-0000-4000-8000-000000000010';
  v_admin constant uuid := 'c1000000-0000-4000-8000-000000000001';
  v_actor constant uuid := 'c1000000-0000-4000-8000-000000000002';
  v_team_b constant uuid := 'c1000000-0000-4000-8000-000000000031';
  v_employee constant uuid := 'c1000000-0000-4000-8000-000000000021';
  v_team_id uuid;
  v_capability_id uuid;
  v_membership public.team_memberships;
  v_team public.teams;
  v_capability public.organization_capabilities;
  v_events text[];
begin
  v_team_id := public.create_team(v_actor, v_org, 'Team C', 'Kundendienst');
  select * into v_team from public.teams where id = v_team_id;
  if v_team.organization_id <> v_org or v_team.name <> 'Team C' or v_team.description <> 'Kundendienst'
    or v_team.created_by <> v_actor or v_team.updated_by <> v_actor or v_team.dissolved_at is not null
  then raise exception 'creating a team stored the wrong row: %', to_jsonb(v_team); end if;
  if (select array_agg(event_type || ':' || event_payload::text || ':' || created_by::text)
      from public.team_events where team_id = v_team_id)
    <> array['created:{"name": "Team C"}:' || v_actor::text]
  then raise exception 'creating a team did not record its history row'; end if;

  perform public.update_team(v_actor, v_org, v_team_b, 'Team Heizung', 'Heizung');
  select * into v_team from public.teams where id = v_team_b;
  if v_team.name <> 'Team Heizung' or v_team.description <> 'Heizung' or v_team.updated_by <> v_actor then
    raise exception 'editing a team stored the wrong row: %', to_jsonb(v_team);
  end if;

  perform public.add_team_membership(v_actor, v_org, v_team_b, v_employee, '2026-03-01', null);
  select * into v_membership from public.team_memberships
  where team_id = v_team_b and employee_record_id = v_employee;
  if v_membership.organization_id <> v_org or v_membership.valid_from <> '2026-03-01'
    or v_membership.valid_until is not null or v_membership.created_by <> v_actor
  then raise exception 'adding a membership stored the wrong row: %', to_jsonb(v_membership); end if;

  perform public.end_team_membership(v_actor, v_org, v_membership.id, '2026-09-30');
  select * into v_membership from public.team_memberships where id = v_membership.id;
  if v_membership.valid_until <> '2026-09-30' or v_membership.ended_by <> v_actor then
    raise exception 'ending a membership stored the wrong row: %', to_jsonb(v_membership);
  end if;

  perform public.dissolve_team(v_actor, v_org, v_team_b, null);
  select * into v_team from public.teams where id = v_team_b;
  if v_team.dissolved_at is null or v_team.updated_by <> v_actor then
    raise exception 'dissolving a team stored the wrong row: %', to_jsonb(v_team);
  end if;

  select array_agg(event_type || ':' || event_payload::text order by created_at, event_type)
  into v_events
  from public.team_events where team_id = v_team_b and created_by = v_actor;
  if v_events is null or array_length(v_events, 1) <> 4
    or not v_events @> array[
      'updated:{"changes": {"name": {"to": "Team Heizung", "from": "Team B"}, '
        || '"description": {"to": "Heizung", "from": null}}}',
      'member_added:' || jsonb_build_object('membership_id', v_membership.id,
        'employee_record_id', v_employee, 'valid_from', '2026-03-01', 'valid_until', null)::text,
      'member_ended:' || jsonb_build_object('membership_id', v_membership.id,
        'employee_record_id', v_employee, 'valid_until', '2026-09-30')::text,
      'dissolved:{"reason": null}'
    ]
  then raise exception 'the team writes recorded the wrong history: %', v_events; end if;

  v_capability_id := public.create_capability_definition(v_actor, v_org, 'certification', 'Schweißschein', null, 45);
  select * into v_capability from public.organization_capabilities where id = v_capability_id;
  if v_capability.organization_id <> v_org or v_capability.kind <> 'certification'
    or v_capability.name <> 'Schweißschein' or v_capability.default_expiry_warning_days <> 45
    or v_capability.created_by <> v_actor or v_capability.retired_at is not null
  then raise exception 'creating a definition stored the wrong row: %', to_jsonb(v_capability); end if;

  perform public.retire_capability_definition(v_actor, v_org, v_capability_id);
  select * into v_capability from public.organization_capabilities where id = v_capability_id;
  if v_capability.retired_at is null or v_capability.updated_by <> v_actor then
    raise exception 'retiring a definition stored the wrong row: %', to_jsonb(v_capability);
  end if;

  select array_agg(event_type || ':' || event_payload::text order by event_type)
  into v_events
  from public.qualification_events where capability_id = v_capability_id and created_by = v_actor;
  if v_events <> array[
    'definition_created:{"kind": "certification", "name": "Schweißschein", "warning_days": 45}',
    'definition_retired:{}'
  ] then raise exception 'the definition writes recorded the wrong history: %', v_events; end if;

  -- The first switch creates the settings row, the second updates it.
  perform public.set_apprentice_warning_enabled(v_admin, v_org, true);
  perform public.set_apprentice_warning_enabled(v_admin, v_org, false);
  if not exists (
    select 1 from public.organization_qualification_settings settings
    where settings.organization_id = v_org and settings.apprentice_warning_enabled = false
      and settings.created_by = v_admin and settings.updated_by = v_admin
  ) then raise exception 'switching the apprentice warning stored the wrong settings'; end if;
  select array_agg(event_payload::text order by event_payload::text)
  into v_events
  from public.qualification_events
  where organization_id = v_org and capability_id is null and event_type = 'apprentice_warning_changed'
    and created_by = v_admin;
  if v_events <> array['{"enabled": false}', '{"enabled": true}'] then
    raise exception 'switching the apprentice warning recorded the wrong history: %', v_events;
  end if;
end;
$$;

reset role;

do $$
declare
  v_function text;
  v_role text;
begin
  foreach v_function in array array[
    'public.create_team(uuid, uuid, text, text)',
    'public.update_team(uuid, uuid, uuid, text, text)',
    'public.dissolve_team(uuid, uuid, uuid, text)',
    'public.add_team_membership(uuid, uuid, uuid, uuid, date, date)',
    'public.end_team_membership(uuid, uuid, uuid, date)',
    'public.create_capability_definition(uuid, uuid, text, text, text, integer)',
    'public.retire_capability_definition(uuid, uuid, uuid)',
    'public.set_apprentice_warning_enabled(uuid, uuid, boolean)'
  ] loop
    if not has_function_privilege('service_role', v_function, 'execute') then
      raise exception '% lost its service_role grant', v_function;
    end if;
    foreach v_role in array array['anon', 'authenticated'] loop
      if has_function_privilege(v_role, v_function, 'execute') then
        raise exception '% is executable by %', v_function, v_role;
      end if;
    end loop;
  end loop;
  foreach v_role in array array['anon', 'authenticated', 'service_role'] loop
    if has_function_privilege(v_role, 'app_private.lock_qualification_actor(uuid, uuid, public.org_role[])', 'execute')
    then raise exception 'the qualification actor lock is executable by %', v_role; end if;
  end loop;
end;
$$;

rollback;
