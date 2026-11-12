-- Berufsschule days (migration 20261202090000_record_apprentice_school_days.sql):
-- client roles only read, Admin and Büro the rows of their organization and a
-- person only their own; another organization reads none. The service role
-- writes but never deletes. A row is never deleted, only cancelled or, as a
-- weekly rule, ended earlier, and none of these writes reaches into a closed
-- period: a new row and a cancellation check their whole span, an end date
-- only the days it removes. A period's source fingerprint changes with the
-- school days inside it and only with those.
-- Runs inside one transaction against the local stack and rolls back.
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
('3c650000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'school-owner@example.test', '', now(), '{}',
 '{"first_name":"Olga","last_name":"Owner"}', now(), now()),
('3c650000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'school-buero@example.test', '', now(), '{}',
 '{"first_name":"Bea","last_name":"Büro"}', now(), now()),
('3c650000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'school-apprentice@example.test', '', now(), '{}',
 '{"first_name":"Mia","last_name":"Azubi"}', now(), now()),
('3c650000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'school-colleague@example.test', '', now(), '{}',
 '{"first_name":"Kai","last_name":"Kollege"}', now(), now()),
('3c650000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'school-foreign@example.test', '', now(), '{}',
 '{"first_name":"Fritz","last_name":"Fremd"}', now(), now());

insert into public.organizations (id, name, admin_id, unique_code) values
('3c650000-0000-0000-0000-000000000010', 'School SQL', '3c650000-0000-0000-0000-000000000001', 'SCHOOLSQ'),
('3c650000-0000-0000-0000-000000000011', 'School Foreign', '3c650000-0000-0000-0000-000000000005', 'SCHOOLFR');

insert into public.organization_members (organization_id, user_id, role) values
('3c650000-0000-0000-0000-000000000010', '3c650000-0000-0000-0000-000000000002', 'buero'),
('3c650000-0000-0000-0000-000000000010', '3c650000-0000-0000-0000-000000000003', 'employee'),
('3c650000-0000-0000-0000-000000000010', '3c650000-0000-0000-0000-000000000004', 'employee');

-- Grants: authenticated reads only, anon nothing, the service role never
-- deletes; the table is published for Realtime.
do $$
begin
  if has_table_privilege('anon', 'public.school_days', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') then
    raise exception 'anon holds a privilege on school_days';
  end if;
  if not has_table_privilege('authenticated', 'public.school_days', 'SELECT')
    or has_table_privilege('authenticated', 'public.school_days', 'INSERT,UPDATE,DELETE') then
    raise exception 'authenticated must only read school_days';
  end if;
  if has_table_privilege('service_role', 'public.school_days', 'DELETE') then
    raise exception 'service_role may delete school_days';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.school_days'::regclass) then
    raise exception 'school_days has no row level security';
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'school_days'
  ) then
    raise exception 'school_days is missing from the Realtime publication';
  end if;
end;
$$;

-- Seed: a weekly Monday rule for the apprentice, a block for the colleague,
-- and a rule in the foreign organization. October 2026 is closed.
do $$
declare
  v_org constant uuid := '3c650000-0000-0000-0000-000000000010';
  v_foreign constant uuid := '3c650000-0000-0000-0000-000000000011';
  v_apprentice uuid;
  v_colleague uuid;
  v_foreign_record uuid;
begin
  select id into v_apprentice from public.employee_records
    where organization_id = v_org and user_id = '3c650000-0000-0000-0000-000000000003';
  select id into v_colleague from public.employee_records
    where organization_id = v_org and user_id = '3c650000-0000-0000-0000-000000000004';
  select id into v_foreign_record from public.employee_records
    where organization_id = v_foreign and user_id = '3c650000-0000-0000-0000-000000000005';
  if v_apprentice is null or v_colleague is null or v_foreign_record is null then
    raise exception 'employee record prerequisite missing';
  end if;

  insert into public.school_days (id, organization_id, employee_record_id, kind, weekday, start_date, created_by)
  values
    ('3c650000-0000-0000-0000-000000000020', v_org, v_apprentice, 'weekday', 0, '2037-09-07',
      '3c650000-0000-0000-0000-000000000002'),
    ('3c650000-0000-0000-0000-000000000022', v_foreign, v_foreign_record, 'weekday', 1, '2037-09-08',
      '3c650000-0000-0000-0000-000000000005');
  insert into public.school_days (id, organization_id, employee_record_id, kind, start_date, end_date, created_by)
  values
    ('3c650000-0000-0000-0000-000000000021', v_org, v_colleague, 'block', '2037-12-07', '2037-12-18',
      '3c650000-0000-0000-0000-000000000002');

  insert into public.time_periods (organization_id, period_start_date, period_end_date, prepared_by, state)
  values (v_org, '2037-10-01', '2037-10-31', '3c650000-0000-0000-0000-000000000001', 'closed');
end;
$$;

-- Row visibility, as the Data API roles meet it.
set local role anon;
do $$
begin
  begin
    perform 1 from public.school_days;
    raise exception 'anon read school_days';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '3c650000-0000-0000-0000-000000000003', true);
do $$
begin
  if (select array_agg(id order by id) from public.school_days)
    is distinct from array['3c650000-0000-0000-0000-000000000020'::uuid] then
    raise exception 'the apprentice does not read exactly their own school days';
  end if;
  begin
    update public.school_days set cancelled_at = now(), cancelled_by = '3c650000-0000-0000-0000-000000000003';
    raise exception 'the apprentice wrote a school day directly';
  exception when insufficient_privilege then null;
  end;
end;
$$;

select set_config('request.jwt.claim.sub', '3c650000-0000-0000-0000-000000000004', true);
do $$
begin
  if exists (select 1 from public.school_days where id = '3c650000-0000-0000-0000-000000000020') then
    raise exception 'an employee of the same organization reads another apprentice''s school days';
  end if;
end;
$$;

select set_config('request.jwt.claim.sub', '3c650000-0000-0000-0000-000000000002', true);
do $$
begin
  if (select count(*) from public.school_days) <> 2
    or exists (select 1 from public.school_days where organization_id <> '3c650000-0000-0000-0000-000000000010') then
    raise exception 'Büro does not read exactly the school days of its organization';
  end if;
end;
$$;

select set_config('request.jwt.claim.sub', '3c650000-0000-0000-0000-000000000005', true);
do $$
begin
  if exists (select 1 from public.school_days where organization_id = '3c650000-0000-0000-0000-000000000010') then
    raise exception 'another organization reads the school days of this one';
  end if;
end;
$$;
reset role;

-- The write rules, for the service role as the actions meet them.
set local role service_role;
do $$
declare
  v_org constant uuid := '3c650000-0000-0000-0000-000000000010';
  v_buero constant uuid := '3c650000-0000-0000-0000-000000000002';
  v_rule constant uuid := '3c650000-0000-0000-0000-000000000020';
  v_apprentice uuid;
  v_foreign_record uuid;
begin
  select employee_record_id into v_apprentice from public.school_days where id = v_rule;
  select employee_record_id into v_foreign_record from public.school_days
    where id = '3c650000-0000-0000-0000-000000000022';

  -- A new row in a closed month is refused.
  begin
    insert into public.school_days (organization_id, employee_record_id, kind, start_date, end_date, created_by)
    values (v_org, v_apprentice, 'block', '2037-10-12', '2037-10-16', v_buero);
    raise exception 'a new school day in a closed month was accepted';
  exception when sqlstate 'WFP01' then null;
  end;

  -- A new open-ended rule that starts before a closed month is refused.
  begin
    insert into public.school_days (organization_id, employee_record_id, kind, weekday, start_date, created_by)
    values (v_org, v_apprentice, 'weekday', 3, '2037-09-03', v_buero);
    raise exception 'a weekly rule reaching into a closed month was accepted';
  exception when sqlstate 'WFP01' then null;
  end;

  -- A record of another organization is refused.
  begin
    insert into public.school_days (organization_id, employee_record_id, kind, start_date, end_date, created_by)
    values (v_org, v_foreign_record, 'block', '2038-01-11', '2038-01-15', v_buero);
    raise exception 'a school day for another organization''s record was accepted';
  exception when raise_exception then
    if sqlerrm <> 'school_day_record_organization_mismatch' then raise; end if;
  end;

  -- A second active rule on the same weekday is refused.
  begin
    insert into public.school_days (organization_id, employee_record_id, kind, weekday, start_date, created_by)
    values (v_org, v_apprentice, 'weekday', 0, '2038-01-04', v_buero);
    raise exception 'an overlapping weekly rule was accepted';
  exception when exclusion_violation then null;
  end;

  -- A cancellation of a rule that covers a closed month is refused.
  begin
    update public.school_days set cancelled_at = now(), cancelled_by = v_buero where id = v_rule;
    raise exception 'a cancellation reaching into a closed month was accepted';
  exception when sqlstate 'WFP01' then null;
  end;

  -- An end date inside the closed month removes closed days and is refused.
  begin
    update public.school_days set end_date = '2037-10-19', ended_at = now(), ended_by = v_buero where id = v_rule;
    raise exception 'an end date reaching into a closed month was accepted';
  exception when sqlstate 'WFP01' then null;
  end;

  -- An end date after the closed month removes only open days and passes,
  -- although the rule itself covers the closed month.
  update public.school_days set end_date = '2037-11-30', ended_at = now(), ended_by = v_buero where id = v_rule;
  if (select end_date from public.school_days where id = v_rule) <> '2037-11-30' then
    raise exception 'ending a weekly rule after the closed month was refused';
  end if;

  -- A later end date is refused: that is a new rule.
  begin
    update public.school_days set end_date = '2037-12-31', ended_at = now(), ended_by = v_buero where id = v_rule;
    raise exception 'a later end date was accepted';
  exception when raise_exception then
    if sqlerrm <> 'school_day_end_not_earlier' then raise; end if;
  end;

  -- Every other column stays.
  begin
    update public.school_days set start_date = '2037-11-02' where id = v_rule;
    raise exception 'a start date was changed';
  exception when raise_exception then
    if sqlerrm <> 'school_day_immutable' then raise; end if;
  end;

  -- A block outside closed months is cancelled, and stays cancelled.
  update public.school_days set cancelled_at = now(), cancelled_by = v_buero
    where id = '3c650000-0000-0000-0000-000000000021';
  begin
    update public.school_days set cancelled_at = null, cancelled_by = null
      where id = '3c650000-0000-0000-0000-000000000021';
    raise exception 'a cancelled school day was restored';
  exception when raise_exception then
    if sqlerrm <> 'school_day_cancelled' then raise; end if;
  end;

  -- The service role cannot delete.
  begin
    delete from public.school_days where id = '3c650000-0000-0000-0000-000000000021';
    raise exception 'the service role deleted a school day';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

-- Not even the owner deletes a row: the history stays.
do $$
begin
  begin
    delete from public.school_days where id = '3c650000-0000-0000-0000-000000000021';
    raise exception 'a school day was deleted';
  exception when raise_exception then
    if sqlerrm <> 'school_day_history_kept' then raise; end if;
  end;
end;
$$;

-- The period fingerprint follows the school days inside the period only.
do $$
declare
  v_org constant uuid := '3c650000-0000-0000-0000-000000000010';
  v_before text;
  v_after_outside text;
  v_after_inside text;
  v_apprentice uuid;
begin
  select employee_record_id into v_apprentice from public.school_days
    where id = '3c650000-0000-0000-0000-000000000020';
  v_before := app_private.compute_p1_23_source_fingerprint(v_org, '2038-02-01', '2038-02-28');
  insert into public.school_days (organization_id, employee_record_id, kind, start_date, end_date, created_by)
  values (v_org, v_apprentice, 'block', '2038-03-08', '2038-03-12', '3c650000-0000-0000-0000-000000000002');
  v_after_outside := app_private.compute_p1_23_source_fingerprint(v_org, '2038-02-01', '2038-02-28');
  if v_after_outside <> v_before then
    raise exception 'a school day outside the period changed its fingerprint';
  end if;
  insert into public.school_days (organization_id, employee_record_id, kind, start_date, end_date, created_by)
  values (v_org, v_apprentice, 'block', '2038-02-08', '2038-02-12', '3c650000-0000-0000-0000-000000000002');
  v_after_inside := app_private.compute_p1_23_source_fingerprint(v_org, '2038-02-01', '2038-02-28');
  if v_after_inside = v_before then
    raise exception 'a school day inside the period left its fingerprint unchanged';
  end if;
end;
$$;

rollback;
