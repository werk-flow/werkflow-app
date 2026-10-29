-- A manual entry of an employee names only a job the employee is assigned to,
-- checked at insert time (migration
-- 20261029141443_recheck_manual_entry_job_assignment.sql), so an assignment
-- or a membership removed after the action's own check refuses the entry. An
-- Admin or Büro member's manual entry and an automatic entry keep their job
-- without an assignment.
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
('29410000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'manual-job-admin@example.test', '', now(), '{}',
 '{"first_name":"Admin","last_name":"Manual"}', now(), now()),
('29410000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'manual-job-buero@example.test', '', now(), '{}',
 '{"first_name":"Buero","last_name":"Manual"}', now(), now()),
('29410000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'manual-job-employee@example.test', '', now(), '{}',
 '{"first_name":"Employee","last_name":"Manual"}', now(), now()),
('29410000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'manual-job-former@example.test', '', now(), '{}',
 '{"first_name":"Former","last_name":"Manual"}', now(), now());

insert into public.organizations (id, name, admin_id, unique_code) values
('29410000-0000-0000-0000-000000000010', 'Manual entry jobs SQL',
  '29410000-0000-0000-0000-000000000001', 'MANJOBSQ');
insert into public.organization_members (organization_id, user_id, role) values
('29410000-0000-0000-0000-000000000010', '29410000-0000-0000-0000-000000000002', 'buero'),
('29410000-0000-0000-0000-000000000010', '29410000-0000-0000-0000-000000000003', 'employee'),
('29410000-0000-0000-0000-000000000010', '29410000-0000-0000-0000-000000000004', 'employee');
insert into public.jobs (id, organization_id, title, job_number, created_by) values
('29410000-0000-0000-0000-000000000020', '29410000-0000-0000-0000-000000000010',
  'Manuelle Einträge', 'MANJOB-1', '29410000-0000-0000-0000-000000000001');
insert into public.job_assignments (organization_id, job_id, user_id, assigned_by) values
('29410000-0000-0000-0000-000000000010', '29410000-0000-0000-0000-000000000020',
  '29410000-0000-0000-0000-000000000003', '29410000-0000-0000-0000-000000000001'),
('29410000-0000-0000-0000-000000000010', '29410000-0000-0000-0000-000000000020',
  '29410000-0000-0000-0000-000000000004', '29410000-0000-0000-0000-000000000001');

-- The deployment role of addManualEntry.
set local role service_role;

do $$
declare
  v_org constant uuid := '29410000-0000-0000-0000-000000000010';
  v_job constant uuid := '29410000-0000-0000-0000-000000000020';
  v_employee constant uuid := '29410000-0000-0000-0000-000000000003';
begin
  insert into public.time_entries (user_id, organization_id, entry_type, timestamp, is_manual, status, job_id)
  values (v_employee, v_org, 'clock_in', now() - interval '5 days', true, 'pending', v_job);
  if not exists (
    select 1 from public.time_entries
    where user_id = v_employee and organization_id = v_org and job_id = v_job
  ) then raise exception 'an assigned employee''s manual entry lost its job'; end if;

  -- The action read the assignment; the office removes it before the insert.
  delete from public.job_assignments where job_id = v_job and user_id = v_employee;
  begin
    insert into public.time_entries (user_id, organization_id, entry_type, timestamp, is_manual, status, job_id)
    values (v_employee, v_org, 'clock_in', now() - interval '4 days', true, 'pending', v_job);
    raise exception 'an unassigned employee''s manual entry was accepted on the job';
  exception when others then
    if sqlerrm <> 'manual_entry_job_not_assigned' then raise; end if;
  end;

  -- A member removed before the insert keeps an assignment row; the entry is refused.
  delete from public.organization_members
  where organization_id = v_org and user_id = '29410000-0000-0000-0000-000000000004';
  begin
    insert into public.time_entries (user_id, organization_id, entry_type, timestamp, is_manual, status, job_id)
    values ('29410000-0000-0000-0000-000000000004', v_org, 'clock_in', now() - interval '4 days', true,
      'pending', v_job);
    raise exception 'a removed member''s manual entry was accepted on the job';
  exception when others then
    if sqlerrm <> 'manual_entry_job_not_assigned' then raise; end if;
  end;

  -- An automatic entry, such as the break end of a settings change, keeps its job.
  insert into public.time_entries (user_id, organization_id, entry_type, timestamp, is_manual, status, job_id)
  values (v_employee, v_org, 'break_end', now(), false, 'approved', v_job);
end;
$$;

-- The entry locks the membership it read, so a concurrent
-- remove_member_with_time_capture waits for it and then sees the entry,
-- instead of both committing.
do $$
declare
  v_org constant uuid := '29410000-0000-0000-0000-000000000010';
  v_job constant uuid := '29410000-0000-0000-0000-000000000020';
  v_buero constant uuid := '29410000-0000-0000-0000-000000000002';
begin
  if (
    select xmax from public.organization_members where organization_id = v_org and user_id = v_buero
  ) <> '0'::xid then raise exception 'the membership row is already locked'; end if;
  insert into public.time_entries (user_id, organization_id, entry_type, timestamp, is_manual, status, job_id)
  values (v_buero, v_org, 'clock_in', now() - interval '6 days', true, 'pending', v_job);
  if (
    select xmax from public.organization_members where organization_id = v_org and user_id = v_buero
  ) <> pg_current_xact_id()::xid then
    raise exception 'a manual entry did not lock the membership it read';
  end if;
end;
$$;

do $$
declare
  v_org constant uuid := '29410000-0000-0000-0000-000000000010';
  v_job constant uuid := '29410000-0000-0000-0000-000000000020';
begin
  insert into public.time_entries (user_id, organization_id, entry_type, timestamp, is_manual, status, job_id)
  values
    ('29410000-0000-0000-0000-000000000001', v_org, 'clock_in', now() - interval '5 days', true, 'approved', v_job),
    ('29410000-0000-0000-0000-000000000002', v_org, 'clock_in', now() - interval '5 days', true, 'pending', v_job);
  if (
    select count(distinct user_id) from public.time_entries
    where organization_id = v_org and job_id = v_job
      and user_id in ('29410000-0000-0000-0000-000000000001', '29410000-0000-0000-0000-000000000002')
  ) <> 2 then raise exception 'an Admin or Büro member''s manual entry needed an assignment'; end if;
end;
$$;

reset role;
rollback;
