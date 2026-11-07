-- P1-03 … P1-09 database rules: the personnel backfill, the owner protection,
-- and the row-level privacy of schedules, responsibilities, vacation, sickness,
-- attention, teams and qualifications. The browser specs prove what a user sees;
-- this file proves which rows each role can read at all.
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
('39000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'people-admin@example.test', '', now(), '{}',
 '{"first_name":"Admin","last_name":"People"}', now(), now()),
('39000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'people-buero@example.test', '', now(), '{}',
 '{"first_name":"Büro","last_name":"People"}', now(), now()),
('39000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'people-employee@example.test', '', now(), '{}',
 '{"first_name":"Employee","last_name":"People"}', now(), now()),
('39000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'people-outsider@example.test', '', now(), '{}',
 '{"first_name":"Outsider","last_name":"People"}', now(), now()),
('39000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'people-colleague@example.test', '', now(), '{}',
 '{"first_name":"Colleague","last_name":"People"}', now(), now());

insert into public.organizations (id, name, admin_id, unique_code) values
('39000000-0000-0000-0000-000000000010', 'People SQL',
 '39000000-0000-0000-0000-000000000001', 'PEOPLESQL'),
('39000000-0000-0000-0000-000000000011', 'People Other',
 '39000000-0000-0000-0000-000000000004', 'PEOPLEOTHER');

insert into public.organization_members (organization_id, user_id, role) values
('39000000-0000-0000-0000-000000000010', '39000000-0000-0000-0000-000000000002', 'buero'),
('39000000-0000-0000-0000-000000000010', '39000000-0000-0000-0000-000000000003', 'employee'),
('39000000-0000-0000-0000-000000000010', '39000000-0000-0000-0000-000000000005', 'employee');

-- The responsibility holder lock lasts to the end of the transaction, and the
-- Büro membership above already took it for People SQL. The lock probes below
-- therefore run on an organization whose setup takes none: its owner
-- membership is written with triggers off, and only employee memberships,
-- which change no role-default holder, follow.
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
('39000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'people-invitee@example.test', '', now(), '{}',
 '{"first_name":"Invitee","last_name":"People"}', now(), now()),
('39000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'people-lock-owner@example.test', '', now(), '{}',
 '{"first_name":"Owner","last_name":"Locks"}', now(), now()),
('39000000-0000-0000-0000-000000000008', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'people-lock-holder-one@example.test', '', now(), '{}',
 '{"first_name":"Holder","last_name":"One"}', now(), now()),
('39000000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'people-lock-holder-two@example.test', '', now(), '{}',
 '{"first_name":"Holder","last_name":"Two"}', now(), now());

set local session_replication_role = replica;
insert into public.organizations (id, name, admin_id, unique_code) values
('39000000-0000-0000-0000-000000000012', 'People Locks',
 '39000000-0000-0000-0000-000000000007', 'PEOPLELOCKS');
insert into public.organization_members (organization_id, user_id, role) values
('39000000-0000-0000-0000-000000000012', '39000000-0000-0000-0000-000000000007', 'admin');
set local session_replication_role = origin;

insert into public.organization_members (organization_id, user_id, role) values
('39000000-0000-0000-0000-000000000012', '39000000-0000-0000-0000-000000000008', 'employee'),
('39000000-0000-0000-0000-000000000012', '39000000-0000-0000-0000-000000000009', 'employee');

insert into public.organization_invites (organization_id, email, invite_code, invited_role) values
('39000000-0000-0000-0000-000000000012', 'people-invitee@example.test',
 '39000000-0000-0000-0000-0000000000c1', 'buero');

-- True while this session holds the organization's responsibility holder lock.
create function pg_temp.holds_responsibility_holder_lock(p_organization_id uuid)
returns boolean language sql as $$
  select exists (
    select 1 from pg_locks held
    where held.locktype = 'advisory' and held.pid = pg_backend_pid()
      and held.granted and held.objsubid = 1
      and ((held.classid::bigint << 32) | held.objid::bigint)
        = hashtextextended(p_organization_id::text || ':responsibility-holders', 0)
  );
$$;
grant execute on function pg_temp.holds_responsibility_holder_lock(uuid) to service_role;

-- P1-03-F01/F05: every member got exactly one personnel record whose entry date is the
-- membership's Berlin join date; nothing invented an employee number or an exit date.
do $$
declare
  member record;
  record_count bigint;
  stored_record record;
begin
  for member in
    select user_id, joined_at from public.organization_members
    where organization_id = '39000000-0000-0000-0000-000000000010'
  loop
    select count(*) into record_count from public.employee_records
    where organization_id = '39000000-0000-0000-0000-000000000010' and user_id = member.user_id;
    if record_count <> 1 then
      raise exception 'member % has % personnel records instead of exactly one', member.user_id, record_count;
    end if;
    select entry_date, exit_date, employee_number into stored_record from public.employee_records
    where organization_id = '39000000-0000-0000-0000-000000000010' and user_id = member.user_id;
    if stored_record.entry_date is distinct from (member.joined_at at time zone 'Europe/Berlin')::date then
      raise exception 'member % entry date is not the Berlin join date', member.user_id;
    end if;
    if stored_record.exit_date is not null or stored_record.employee_number is not null then
      raise exception 'member % personnel record invented an exit date or employee number', member.user_id;
    end if;
  end loop;
end;
$$;

set local role service_role;

-- P1-05: the organization owner cannot be demoted, so the last admin stays protected.
do $$
begin
  begin
    update public.organization_members set role = 'employee'
    where organization_id = '39000000-0000-0000-0000-000000000010'
      and user_id = '39000000-0000-0000-0000-000000000001';
    raise exception 'owner role mutation was accepted';
  exception when others then
    if sqlerrm not like '%organization_owner_is_protected%' then raise; end if;
  end;
  if (select role from public.organization_members
      where organization_id = '39000000-0000-0000-0000-000000000010'
        and user_id = '39000000-0000-0000-0000-000000000001') <> 'admin'
  then raise exception 'owner membership changed despite the owner protection'; end if;
end;
$$;

-- One row per person and table, so each role's visible set is exact.
do $$
declare
  org constant uuid := '39000000-0000-0000-0000-000000000010';
  admin_user constant uuid := '39000000-0000-0000-0000-000000000001';
  buero_record uuid;
  employee_record uuid;
  colleague_record uuid;
  configuration_id uuid;
  employee_vacation_id uuid;
  team_id uuid;
  certification_id uuid;
  job_id uuid;
begin
  select id into buero_record from public.employee_records
  where organization_id = org and user_id = '39000000-0000-0000-0000-000000000002';
  select id into employee_record from public.employee_records
  where organization_id = org and user_id = '39000000-0000-0000-0000-000000000003';
  select id into colleague_record from public.employee_records
  where organization_id = org and user_id = '39000000-0000-0000-0000-000000000005';

  insert into public.work_schedules (organization_id, employee_record_id, valid_from, monday_minutes, created_by)
  values (org, employee_record, '2026-09-01', 480, admin_user),
         (org, buero_record, '2026-09-01', 480, admin_user),
         (org, colleague_record, '2026-09-01', 480, admin_user);

  insert into public.organization_responsibility_configurations (organization_id, responsibility, mode, created_by)
  values (org, 'time_approval', 'selected', admin_user)
  returning id into configuration_id;
  insert into public.organization_responsibility_assignments (organization_id, configuration_id, employee_record_id, source)
  values (org, configuration_id, employee_record, 'direct');

  insert into public.vacation_requests (organization_id, employee_record_id, requested_by, start_date, end_date)
  values (org, employee_record, '39000000-0000-0000-0000-000000000003', '2026-12-01', '2026-12-01')
  returning id into employee_vacation_id;
  insert into public.vacation_requests (organization_id, employee_record_id, requested_by, start_date, end_date)
  values (org, colleague_record, '39000000-0000-0000-0000-000000000005', '2026-12-02', '2026-12-02');

  insert into public.sickness_reports (organization_id, employee_record_id, start_date, end_date, reported_by)
  values (org, employee_record, '2026-09-10', '2026-09-10', '39000000-0000-0000-0000-000000000003'),
         (org, buero_record, '2026-09-11', '2026-09-11', admin_user);

  insert into public.attention_read_states (organization_id, user_id, source_type, source_id, state_version)
  values (org, '39000000-0000-0000-0000-000000000003', 'vacation_decision', employee_vacation_id, 'pending:1');
  insert into public.attention_events (organization_id, user_id, source_type, source_id, event_type)
  values (org, '39000000-0000-0000-0000-000000000003', 'vacation_decision', employee_vacation_id, 'marked_read');

  insert into public.teams (organization_id, name, created_by) values (org, 'People Team', admin_user)
  returning id into team_id;
  insert into public.team_memberships (organization_id, team_id, employee_record_id, valid_from, created_by)
  values (org, team_id, employee_record, '2026-09-01', admin_user),
         (org, team_id, colleague_record, '2026-09-01', admin_user);

  insert into public.organization_capabilities (organization_id, kind, name, created_by)
  values (org, 'certification', 'People Zertifikat', admin_user)
  returning id into certification_id;
  insert into public.employee_capabilities (
    organization_id, employee_record_id, capability_id, capability_kind, valid_from, evidence_state, created_by
  ) values
    (org, employee_record, certification_id, 'certification', '2026-01-01', 'received', admin_user),
    (org, colleague_record, certification_id, 'certification', '2026-01-01', 'pending', admin_user);

  insert into public.jobs (organization_id, title, created_by) values (org, 'People Auftrag', admin_user)
  returning id into job_id;
  insert into public.job_capability_requirements (organization_id, job_id, capability_id, created_by)
  values (org, job_id, certification_id, admin_user);
  insert into public.job_qualification_assessments (
    organization_id, job_id, assessed_for_date, coverage_fingerprint, created_by
  ) values (org, job_id, '2026-09-15', 'people-sql', admin_user);
end;
$$;

-- Every change to who holds a responsibility takes one organization lock: the
-- owner's save, the last-holder check on a member removal and the role-default
-- snapshot after a Büro invite is redeemed. The second of two concurrent
-- changes waits for the first to commit, and its check, a new statement under
-- read committed, sees the result. So two removals cannot each count the other
-- as the remaining holder, and a redemption cannot append a role-default
-- snapshot after the owner's selection without seeing it. Each probe rolls
-- back, and the lock goes with it.
do $$
declare
  org constant uuid := '39000000-0000-0000-0000-000000000012';
  owner_user constant uuid := '39000000-0000-0000-0000-000000000007';
  holder_one_record uuid;
  holder_two_record uuid;
  configuration_id uuid;
  saved_configuration_id uuid;
  save_source text;
begin
  select id into holder_one_record from public.employee_records
  where organization_id = org and user_id = '39000000-0000-0000-0000-000000000008';
  select id into holder_two_record from public.employee_records
  where organization_id = org and user_id = '39000000-0000-0000-0000-000000000009';
  insert into public.organization_responsibility_configurations (organization_id, responsibility, mode, created_by)
  values (org, 'time_approval', 'selected', owner_user)
  returning id into configuration_id;
  insert into public.organization_responsibility_assignments (organization_id, configuration_id, employee_record_id, source)
  values (org, configuration_id, holder_one_record, 'direct'),
         (org, configuration_id, holder_two_record, 'direct');

  if pg_temp.holds_responsibility_holder_lock(org)
    then raise exception 'the responsibility holder lock was held before the probes'; end if;

  begin
    perform public.apply_responsibility_configuration(
      org, 'leave_approval', 'selected', array[holder_one_record], owner_user, null);
    if not pg_temp.holds_responsibility_holder_lock(org)
      then raise exception 'the owner''s responsibility save does not take the organization holder lock'; end if;
    raise exception 'responsibility_holder_probe';
  exception when others then
    if sqlerrm <> 'responsibility_holder_probe' then raise; end if;
  end;
  if pg_temp.holds_responsibility_holder_lock(org)
    then raise exception 'the responsibility holder lock outlived the save probe'; end if;

  begin
    -- The second holder stays, so removing the first one is legal.
    delete from public.organization_members
    where organization_id = org and user_id = '39000000-0000-0000-0000-000000000008';
    if not pg_temp.holds_responsibility_holder_lock(org)
      then raise exception 'a holder''s member removal does not take the organization holder lock'; end if;
    raise exception 'responsibility_holder_probe';
  exception when others then
    if sqlerrm <> 'responsibility_holder_probe' then raise; end if;
  end;

  begin
    perform public.redeem_organization_invite_for_user(
      '39000000-0000-0000-0000-0000000000c1', '39000000-0000-0000-0000-000000000006');
    if not pg_temp.holds_responsibility_holder_lock(org)
      then raise exception 'a Büro invite redemption does not take the organization holder lock'; end if;
    raise exception 'responsibility_holder_probe';
  exception when others then
    if sqlerrm <> 'responsibility_holder_probe' then raise; end if;
  end;

  -- A change that waited for the lock reads what committed meanwhile. Its
  -- transaction began before that save, so reading by now() would hide it;
  -- inside this test transaction every save lies after now() as well.
  begin
    saved_configuration_id := public.apply_responsibility_configuration(
      org, 'time_approval', 'selected', array[holder_one_record], owner_user, configuration_id);
    perform public.apply_responsibility_configuration(
      org, 'time_approval', 'selected', array[holder_one_record], owner_user, saved_configuration_id);
    begin
      delete from public.organization_members
      where organization_id = org and user_id = '39000000-0000-0000-0000-000000000008';
      raise exception 'a removal ignored the selection saved after its transaction began';
    exception when others then
      if sqlerrm <> 'last_responsibility_holder:time_approval' then raise; end if;
    end;
    raise exception 'responsibility_holder_probe';
  exception when others then
    if sqlerrm <> 'responsibility_holder_probe' then raise; end if;
  end;

  -- Lock order: a member's row, then the organization lock, then personnel
  -- records, which a role-default snapshot or a save locks through its
  -- foreign keys after the organization lock. A removal locks the removed
  -- person's record FOR UPDATE, so it takes the organization lock first. The
  -- save keeps its per-responsibility lock, which delegations share, after
  -- the organization lock.
  save_source := pg_get_functiondef(
    'public.remove_member_with_time_capture(uuid,uuid,uuid,uuid)'::regprocedure);
  if strpos(save_source, ':responsibility-holders') = 0
    or strpos(save_source, ':responsibility-holders') < strpos(save_source, 'from public.organization_members')
    or strpos(save_source, ':responsibility-holders') > strpos(save_source, 'from public.employee_records')
  then raise exception 'a member removal locks the personnel record before the organization holder lock'; end if;
  save_source := pg_get_functiondef(
    'public.apply_responsibility_configuration(uuid,public.organization_responsibility,public.responsibility_configuration_mode,uuid[],uuid,uuid)'::regprocedure);
  if strpos(save_source, ':responsibility-holders') = 0
    or strpos(save_source, ':responsibility-holders') > strpos(save_source, 'p_responsibility::text')
  then raise exception 'the owner''s save takes the responsibility lock before the organization holder lock'; end if;
end;
$$;

create function pg_temp.visible_people(p_org uuid)
returns table (relation text, record_ids uuid[], user_ids uuid[], row_count bigint)
language sql as $$
  select 'work_schedules', array_agg(distinct employee_record_id), null::uuid[], count(*)
    from public.work_schedules where organization_id = p_org
  union all
  select 'responsibility_assignments', array_agg(distinct employee_record_id), null, count(*)
    from public.organization_responsibility_assignments where organization_id = p_org
  union all
  select 'vacation_requests', array_agg(distinct employee_record_id), null, count(*)
    from public.vacation_requests where organization_id = p_org
  union all
  select 'sickness_reports', array_agg(distinct employee_record_id), null, count(*)
    from public.sickness_reports where organization_id = p_org
  union all
  select 'attention_read_states', null, array_agg(distinct user_id), count(*)
    from public.attention_read_states where organization_id = p_org
  union all
  select 'attention_events', null, array_agg(distinct user_id), count(*)
    from public.attention_events where organization_id = p_org
  union all
  select 'team_memberships', array_agg(distinct employee_record_id), null, count(*)
    from public.team_memberships where organization_id = p_org
  union all
  select 'employee_capabilities', array_agg(distinct employee_record_id), null, count(*)
    from public.employee_capabilities where organization_id = p_org
  union all
  select 'job_capability_requirements', null, null, count(*)
    from public.job_capability_requirements where organization_id = p_org
  union all
  select 'job_qualification_assessments', null, null, count(*)
    from public.job_qualification_assessments where organization_id = p_org;
$$;

reset role;
create temporary table people_records on commit drop as
select user_id, id from public.employee_records
where organization_id = '39000000-0000-0000-0000-000000000010';
grant select on people_records to authenticated;
grant execute on function pg_temp.visible_people(uuid) to authenticated;

-- The employee sees exactly their own rows; read markers and pattern events stay their own.
set local role authenticated;
select set_config('request.jwt.claim.sub', '39000000-0000-0000-0000-000000000003', true);
do $$
declare
  own_record uuid := (select id from people_records where user_id = '39000000-0000-0000-0000-000000000003');
  visible record;
begin
  for visible in select * from pg_temp.visible_people('39000000-0000-0000-0000-000000000010') loop
    if visible.relation in ('job_capability_requirements', 'job_qualification_assessments') then
      if visible.row_count <> 0 then
        raise exception 'employee can read % although only managers may', visible.relation;
      end if;
    elsif visible.relation in ('attention_read_states', 'attention_events') then
      if visible.user_ids is distinct from array['39000000-0000-0000-0000-000000000003'::uuid] then
        raise exception 'employee sees foreign or missing % rows', visible.relation;
      end if;
    elsif visible.record_ids is distinct from array[own_record] then
      raise exception 'employee sees foreign or missing % rows', visible.relation;
    end if;
  end loop;
end;
$$;

-- A colleague without any responsibility sees nothing of the employee: no schedule,
-- no vacation, no sickness, no team row, no qualification, no attention state.
select set_config('request.jwt.claim.sub', '39000000-0000-0000-0000-000000000005', true);
do $$
declare
  employee_record uuid := (select id from people_records where user_id = '39000000-0000-0000-0000-000000000003');
  visible record;
begin
  for visible in select * from pg_temp.visible_people('39000000-0000-0000-0000-000000000010') loop
    if employee_record = any(coalesce(visible.record_ids, '{}'))
      or '39000000-0000-0000-0000-000000000003'::uuid = any(coalesce(visible.user_ids, '{}'))
    then
      raise exception 'colleague can read the employee''s % rows', visible.relation;
    end if;
  end loop;
end;
$$;

-- Managers see the organization, except read markers: those stay strictly personal.
select set_config('request.jwt.claim.sub', '39000000-0000-0000-0000-000000000001', true);
do $$
declare
  visible record;
begin
  for visible in select * from pg_temp.visible_people('39000000-0000-0000-0000-000000000010') loop
    if visible.relation = 'attention_read_states' then
      if visible.row_count <> 0 then
        raise exception 'admin can read another person''s attention read markers';
      end if;
    elsif visible.relation = 'attention_events' then
      if not ('39000000-0000-0000-0000-000000000003'::uuid = any(coalesce(visible.user_ids, '{}'))) then
        raise exception 'admin cannot read the employee''s attention pattern events';
      end if;
    elsif visible.relation = 'sickness_reports' then
      if visible.row_count <> 2 then
        raise exception 'admin does not see every sickness report of the organization';
      end if;
    elsif visible.row_count = 0 then
      raise exception 'admin cannot read the organization''s % rows', visible.relation;
    end if;
  end loop;
end;
$$;

-- Another organization's admin sees no row of this organization.
select set_config('request.jwt.claim.sub', '39000000-0000-0000-0000-000000000004', true);
do $$
declare
  visible record;
begin
  for visible in select * from pg_temp.visible_people('39000000-0000-0000-0000-000000000010') loop
    if visible.row_count <> 0 then
      raise exception 'outsider can read % rows of a foreign organization', visible.relation;
    end if;
  end loop;
  if (select count(*) from public.employee_records
      where organization_id = '39000000-0000-0000-0000-000000000010') <> 0
  then raise exception 'outsider can read foreign personnel records'; end if;
end;
$$;

rollback;
