-- Adding, renewing and correcting an employee capability store the record and
-- its employee record history row in one call or nothing, and refuse with the
-- action's failure codes (migration
-- 20261004190000_write_employee_capability_history_with_its_change.sql).
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
('c2000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'capability-history-admin@example.test', '', now(), '{}',
 '{"first_name":"Admin","last_name":"Fähigkeit"}', now(), now()),
('c2000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'capability-history-buero@example.test', '', now(), '{}',
 '{"first_name":"Büro","last_name":"Fähigkeit"}', now(), now()),
('c2000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'capability-history-employee@example.test', '', now(), '{}',
 '{"first_name":"Employee","last_name":"Fähigkeit"}', now(), now()),
('c2000000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'capability-history-outsider@example.test', '', now(), '{}',
 '{"first_name":"Outsider","last_name":"Fähigkeit"}', now(), now());

insert into public.organizations (id, name, admin_id, unique_code) values
('c2000000-0000-4000-8000-000000000010', 'Capability history SQL',
 'c2000000-0000-4000-8000-000000000001', 'CAPHIST'),
('c2000000-0000-4000-8000-000000000011', 'Capability history SQL other',
 'c2000000-0000-4000-8000-000000000004', 'CAPHISTO');
insert into public.organization_members (organization_id, user_id, role) values
('c2000000-0000-4000-8000-000000000010', 'c2000000-0000-4000-8000-000000000002', 'buero'),
('c2000000-0000-4000-8000-000000000010', 'c2000000-0000-4000-8000-000000000003', 'employee');

insert into public.employee_records (id, organization_id, first_name, last_name) values
('c2000000-0000-4000-8000-000000000020', 'c2000000-0000-4000-8000-000000000010', 'Erika', 'Muster'),
('c2000000-0000-4000-8000-000000000029', 'c2000000-0000-4000-8000-000000000011', 'Fremd', 'Person');

insert into public.organization_capabilities (
  id, organization_id, kind, name, default_expiry_warning_days, retired_at
) values
('c2000000-0000-4000-8000-000000000050', 'c2000000-0000-4000-8000-000000000010', 'skill', 'Löten', 0, null),
('c2000000-0000-4000-8000-000000000051', 'c2000000-0000-4000-8000-000000000010', 'certification', 'Schweißschein', 30, null),
('c2000000-0000-4000-8000-000000000052', 'c2000000-0000-4000-8000-000000000010', 'skill', 'Alt', 0, now()),
('c2000000-0000-4000-8000-000000000059', 'c2000000-0000-4000-8000-000000000011', 'skill', 'Fremd', 0, null);

insert into public.employee_capabilities (
  id, organization_id, employee_record_id, capability_id, capability_kind, valid_from, valid_until
) values
('c2000000-0000-4000-8000-000000000060', 'c2000000-0000-4000-8000-000000000010',
 'c2000000-0000-4000-8000-000000000020', 'c2000000-0000-4000-8000-000000000051', 'certification',
 '2025-01-01', '2025-12-31'),
('c2000000-0000-4000-8000-000000000061', 'c2000000-0000-4000-8000-000000000010',
 'c2000000-0000-4000-8000-000000000020', 'c2000000-0000-4000-8000-000000000050', 'skill',
 '2026-01-01', null),
('c2000000-0000-4000-8000-000000000069', 'c2000000-0000-4000-8000-000000000011',
 'c2000000-0000-4000-8000-000000000029', 'c2000000-0000-4000-8000-000000000059', 'skill',
 '2026-01-01', null);

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

-- Both organizations' capability records and history as one comparable value.
create function pg_temp.capability_state() returns text language sql as $$
  select concat_ws('#',
    (select string_agg(to_jsonb(capability)::text, '|' order by capability.id)
      from public.employee_capabilities capability
      where capability.organization_id in ('c2000000-0000-4000-8000-000000000010', 'c2000000-0000-4000-8000-000000000011')),
    (select count(*)::text from public.employee_record_events event
      where event.organization_id in ('c2000000-0000-4000-8000-000000000010', 'c2000000-0000-4000-8000-000000000011'))
  );
$$;

create temporary table capability_state_before as select pg_temp.capability_state() as state;

-- Every refusal keeps its code and changes nothing.
set local role service_role;

select pg_temp.expect_refusal('capability added by a field worker', $sql$
  select public.add_employee_capability('c2000000-0000-4000-8000-000000000003', 'c2000000-0000-4000-8000-000000000010',
    'c2000000-0000-4000-8000-000000000020', 'c2000000-0000-4000-8000-000000000050', '2027-01-01', null,
    null, null, null, null, null, null)
$sql$, 'not_authorized');
select pg_temp.expect_refusal('capability added by an outsider', $sql$
  select public.add_employee_capability('c2000000-0000-4000-8000-000000000004', 'c2000000-0000-4000-8000-000000000010',
    'c2000000-0000-4000-8000-000000000020', 'c2000000-0000-4000-8000-000000000050', '2027-01-01', null,
    null, null, null, null, null, null)
$sql$, 'not_authorized');
select pg_temp.expect_refusal('capability ending before it starts', $sql$
  select public.add_employee_capability('c2000000-0000-4000-8000-000000000002', 'c2000000-0000-4000-8000-000000000010',
    'c2000000-0000-4000-8000-000000000020', 'c2000000-0000-4000-8000-000000000050', '2027-01-01', '2026-12-31',
    null, null, null, null, null, null)
$sql$, 'invalid_input');
select pg_temp.expect_refusal('capability of a definition of another organization', $sql$
  select public.add_employee_capability('c2000000-0000-4000-8000-000000000002', 'c2000000-0000-4000-8000-000000000010',
    'c2000000-0000-4000-8000-000000000020', 'c2000000-0000-4000-8000-000000000059', '2027-01-01', null,
    null, null, null, null, null, null)
$sql$, 'definition_not_found');
select pg_temp.expect_refusal('capability of a retired definition', $sql$
  select public.add_employee_capability('c2000000-0000-4000-8000-000000000002', 'c2000000-0000-4000-8000-000000000010',
    'c2000000-0000-4000-8000-000000000020', 'c2000000-0000-4000-8000-000000000052', '2027-01-01', null,
    null, null, null, null, null, null)
$sql$, 'definition_not_found');
select pg_temp.expect_refusal('capability of an employee of another organization', $sql$
  select public.add_employee_capability('c2000000-0000-4000-8000-000000000002', 'c2000000-0000-4000-8000-000000000010',
    'c2000000-0000-4000-8000-000000000029', 'c2000000-0000-4000-8000-000000000050', '2027-01-01', null,
    null, null, null, null, null, null)
$sql$, 'employee_not_found');
select pg_temp.expect_refusal('overlapping skill', $sql$
  select public.add_employee_capability('c2000000-0000-4000-8000-000000000002', 'c2000000-0000-4000-8000-000000000010',
    'c2000000-0000-4000-8000-000000000020', 'c2000000-0000-4000-8000-000000000050', '2027-01-01', null,
    null, null, null, null, null, null)
$sql$, 'overlap');
select pg_temp.expect_refusal('renewal of a skill', $sql$
  select public.add_employee_capability('c2000000-0000-4000-8000-000000000002', 'c2000000-0000-4000-8000-000000000010',
    'c2000000-0000-4000-8000-000000000020', 'c2000000-0000-4000-8000-000000000050', '2027-01-01', null,
    null, null, null, null, null, 'c2000000-0000-4000-8000-000000000061')
$sql$, 'invalid_input');
select pg_temp.expect_refusal('renewal of a record of another organization', $sql$
  select public.add_employee_capability('c2000000-0000-4000-8000-000000000002', 'c2000000-0000-4000-8000-000000000010',
    'c2000000-0000-4000-8000-000000000020', 'c2000000-0000-4000-8000-000000000051', '2026-01-01', null,
    null, null, null, null, null, 'c2000000-0000-4000-8000-000000000069')
$sql$, 'record_not_found');

select pg_temp.expect_refusal('correction of a record of another organization', $sql$
  select public.update_employee_capability('c2000000-0000-4000-8000-000000000002', 'c2000000-0000-4000-8000-000000000010',
    'c2000000-0000-4000-8000-000000000069', '2026-02-01', null, null, null, 'unconfirmed', 'not_required', null)
$sql$, 'record_not_found');
select pg_temp.expect_refusal('correction by a field worker', $sql$
  select public.update_employee_capability('c2000000-0000-4000-8000-000000000003', 'c2000000-0000-4000-8000-000000000010',
    'c2000000-0000-4000-8000-000000000061', '2026-02-01', null, null, null, 'unconfirmed', 'not_required', null)
$sql$, 'not_authorized');
select pg_temp.expect_refusal('correction with an unknown evidence state', $sql$
  select public.update_employee_capability('c2000000-0000-4000-8000-000000000002', 'c2000000-0000-4000-8000-000000000010',
    'c2000000-0000-4000-8000-000000000061', '2026-02-01', null, null, null, 'unconfirmed', 'lost', null)
$sql$, 'invalid_input');

reset role;

-- The history row is the last step. When it is refused, the change is rolled
-- back with it: nothing changes without its history row.
create function pg_temp.refuse_history() returns trigger language plpgsql as $$
begin
  raise exception 'history refused';
end;
$$;
create trigger refuse_employee_record_event before insert on public.employee_record_events
  for each row execute function pg_temp.refuse_history();

set local role service_role;
select pg_temp.expect_refusal('capability whose history row is refused', $sql$
  select public.add_employee_capability('c2000000-0000-4000-8000-000000000002', 'c2000000-0000-4000-8000-000000000010',
    'c2000000-0000-4000-8000-000000000020', 'c2000000-0000-4000-8000-000000000051', '2026-01-01', null,
    'TÜV', null, 'confirmed', 'received', null, null)
$sql$, 'history refused');
select pg_temp.expect_refusal('renewal whose history row is refused', $sql$
  select public.add_employee_capability('c2000000-0000-4000-8000-000000000002', 'c2000000-0000-4000-8000-000000000010',
    'c2000000-0000-4000-8000-000000000020', 'c2000000-0000-4000-8000-000000000051', '2026-01-01', null,
    'TÜV', null, 'confirmed', 'received', null, 'c2000000-0000-4000-8000-000000000060')
$sql$, 'history refused');
select pg_temp.expect_refusal('correction whose history row is refused', $sql$
  select public.update_employee_capability('c2000000-0000-4000-8000-000000000002', 'c2000000-0000-4000-8000-000000000010',
    'c2000000-0000-4000-8000-000000000061', '2026-02-01', null, null, null, 'unconfirmed', 'not_required', 'Neu')
$sql$, 'history refused');
reset role;

drop trigger refuse_employee_record_event on public.employee_record_events;

do $$
begin
  if pg_temp.capability_state() <> (select state from capability_state_before) then
    raise exception 'a refused capability write changed rows or history';
  end if;
end;
$$;

-- Each clean write stores the change and exactly its history row.
set local role service_role;

do $$
declare
  v_org constant uuid := 'c2000000-0000-4000-8000-000000000010';
  v_actor constant uuid := 'c2000000-0000-4000-8000-000000000002';
  v_employee constant uuid := 'c2000000-0000-4000-8000-000000000020';
  v_skill constant uuid := 'c2000000-0000-4000-8000-000000000050';
  v_certification constant uuid := 'c2000000-0000-4000-8000-000000000051';
  v_expired constant uuid := 'c2000000-0000-4000-8000-000000000060';
  v_skill_record constant uuid := 'c2000000-0000-4000-8000-000000000061';
  v_renewed_id uuid;
  v_record public.employee_capabilities;
  v_payload jsonb;
begin
  -- A renewal supersedes the current certification and records 'qualification_renewed'.
  v_renewed_id := public.add_employee_capability(v_actor, v_org, v_employee, v_certification,
    '2026-01-01', '2026-12-31', 'TÜV', '2026-11-30', 'confirmed', 'received', 'Kurs', v_expired);
  select * into v_record from public.employee_capabilities where id = v_renewed_id;
  if v_record.capability_kind <> 'certification' or v_record.issuer <> 'TÜV'
    or v_record.confirmation_status <> 'confirmed' or v_record.confirmed_by <> v_actor
    or v_record.evidence_state <> 'received' or v_record.supersedes_id <> v_expired
    or v_record.created_by <> v_actor
  then raise exception 'renewing stored the wrong row: %', to_jsonb(v_record); end if;
  if (select superseded_at from public.employee_capabilities where id = v_expired) is null then
    raise exception 'renewing did not supersede the previous certification';
  end if;
  select event_payload into v_payload from public.employee_record_events
  where employee_record_id = v_employee and event_type = 'qualification_renewed' and created_by = v_actor;
  if v_payload is distinct from jsonb_build_object(
    'employee_capability_id', v_renewed_id, 'capability_id', v_certification, 'kind', 'certification',
    'valid_from', '2026-01-01', 'valid_until', '2026-12-31', 'supersedes_id', v_expired
  ) then raise exception 'renewing recorded the wrong history: %', v_payload; end if;

  -- A correction of a skill drops certification fields and records before and after.
  perform public.update_employee_capability(v_actor, v_org, v_skill_record, '2026-02-01', null,
    'Ignoriert', '2026-03-01', 'confirmed', 'received', 'Neu');
  select * into v_record from public.employee_capabilities where id = v_skill_record;
  if v_record.valid_from <> '2026-02-01' or v_record.issuer is not null or v_record.renewal_due_date is not null
    or v_record.confirmation_status <> 'unconfirmed' or v_record.evidence_state <> 'not_required'
    or v_record.operational_note <> 'Neu' or v_record.updated_by <> v_actor
  then raise exception 'correcting stored the wrong row: %', to_jsonb(v_record); end if;
  select event_payload into v_payload from public.employee_record_events
  where employee_record_id = v_employee and event_type = 'qualification_corrected' and created_by = v_actor;
  if v_payload -> 'before' is distinct from jsonb_build_object(
      'valid_from', '2026-01-01', 'valid_until', null, 'issuer', null, 'renewal_due_date', null,
      'confirmation_status', 'unconfirmed', 'evidence_state', 'not_required', 'operational_note', null)
    or v_payload -> 'after' is distinct from jsonb_build_object(
      'valid_from', '2026-02-01', 'valid_until', null, 'issuer', null, 'renewal_due_date', null,
      'confirmation_status', 'unconfirmed', 'confirmed_by', null, 'confirmed_at', null,
      'evidence_state', 'not_required', 'operational_note', 'Neu', 'updated_by', v_actor)
    or v_payload ->> 'employee_capability_id' <> v_skill_record::text
  then raise exception 'correcting recorded the wrong history: %', v_payload; end if;

  -- A new skill keeps no certification fields and records 'qualification_added'.
  perform public.update_employee_capability(v_actor, v_org, v_skill_record, '2026-02-01', '2026-06-30',
    null, null, 'unconfirmed', 'not_required', null);
  v_renewed_id := public.add_employee_capability(v_actor, v_org, v_employee, v_skill,
    '2026-07-01', null, 'Ignoriert', null, 'confirmed', 'pending', null, null);
  select * into v_record from public.employee_capabilities where id = v_renewed_id;
  if v_record.capability_kind <> 'skill' or v_record.issuer is not null
    or v_record.confirmation_status <> 'unconfirmed' or v_record.evidence_state <> 'not_required'
  then raise exception 'adding a skill stored the wrong row: %', to_jsonb(v_record); end if;
  if (select count(*) from public.employee_record_events
      where employee_record_id = v_employee and event_type = 'qualification_added'
        and event_payload ->> 'employee_capability_id' = v_renewed_id::text) <> 1
  then raise exception 'adding a skill did not record its history row'; end if;
end;
$$;

reset role;

do $$
declare
  v_function text;
  v_role text;
begin
  foreach v_function in array array[
    'public.add_employee_capability(uuid, uuid, uuid, uuid, date, date, text, date, text, text, text, uuid)',
    'public.update_employee_capability(uuid, uuid, uuid, date, date, text, date, text, text, text)'
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
end;
$$;

rollback;
