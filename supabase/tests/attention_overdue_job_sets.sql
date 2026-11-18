-- The overdue job set of the office's attention read (migration
-- 20261217090001): read_manager_attention_sets returns as overdue_jobs exactly
-- the open jobs of the organization whose every scheduled visit has ended, with
-- the end of the last timed and the last all-day visit. Parked, finished,
-- cancelled, never-visited and another organization's jobs never appear, and
-- the set stops at its limit plus one. lib/attention/job-tasks.test.ts proves
-- the Berlin-day rule the TypeScript applies to overdue_jobs.
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
('a7f00000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'job-sets-admin@example.test', '', now(),
 '{}'::jsonb, '{"first_name":"Erika","last_name":"Musterfrau"}'::jsonb, now(), now()),
('a7f00000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'job-sets-employee@example.test', '', now(),
 '{}'::jsonb, '{"first_name":"Max","last_name":"Mustermann"}'::jsonb, now(), now()),
('a7f00000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'job-sets-outsider@example.test', '', now(),
 '{}'::jsonb, '{"first_name":"Fremd","last_name":"Firma"}'::jsonb, now(), now());

insert into public.organizations (id, name, admin_id, unique_code) values
('a7f00000-0000-4000-8000-000000000010', 'Haustechnik Sonnenberg GmbH',
 'a7f00000-0000-4000-8000-000000000001', 'JOBSETSA'),
('a7f00000-0000-4000-8000-000000000011', 'Hausverwaltung Lindenhof GmbH',
 'a7f00000-0000-4000-8000-000000000003', 'JOBSETSB');
insert into public.organization_members (organization_id, user_id, role) values
('a7f00000-0000-4000-8000-000000000010', 'a7f00000-0000-4000-8000-000000000002', 'employee');

insert into public.projects (id, organization_id, name, project_number, created_by) values
('a7f00000-0000-4000-8000-000000000040', 'a7f00000-0000-4000-8000-000000000010', 'Neubau Lindenstraße',
 'JS-P-1', 'a7f00000-0000-4000-8000-000000000001');

-- Created in number order, so the oldest-first order is the number order.
insert into public.jobs (id, organization_id, title, job_number, status, project_id, created_by, created_at)
select id::uuid, organization_id::uuid, title, job_number, status::public.job_status, project_id::uuid,
  'a7f00000-0000-4000-8000-000000000001', '2026-10-01T08:00:00Z'::timestamptz + n * interval '1 hour'
from (values
  (1, 'a7f00000-0000-4000-8000-000000000021', 'a7f00000-0000-4000-8000-000000000010', 'Ohne alles', 'JS-01', 'nicht_bearbeitet', null),
  (2, 'a7f00000-0000-4000-8000-000000000022', 'a7f00000-0000-4000-8000-000000000010', 'Zugewiesen', 'JS-02', 'nicht_bearbeitet', null),
  (3, 'a7f00000-0000-4000-8000-000000000023', 'a7f00000-0000-4000-8000-000000000010', 'Nur abgesagt', 'JS-03', 'nicht_bearbeitet', null),
  (4, 'a7f00000-0000-4000-8000-000000000024', 'a7f00000-0000-4000-8000-000000000010', 'Geparkt', 'JS-04', 'geparkt', null),
  (5, 'a7f00000-0000-4000-8000-000000000025', 'a7f00000-0000-4000-8000-000000000010', 'Fertig', 'JS-05', 'fertig', null),
  (6, 'a7f00000-0000-4000-8000-000000000026', 'a7f00000-0000-4000-8000-000000000010', 'Gestern besucht', 'JS-06', 'nicht_bearbeitet', null),
  (7, 'a7f00000-0000-4000-8000-000000000027', 'a7f00000-0000-4000-8000-000000000010', 'Nächster Termin folgt', 'JS-07', 'in_bearbeitung', null),
  (8, 'a7f00000-0000-4000-8000-000000000028', 'a7f00000-0000-4000-8000-000000000010', 'Ganztägig vorbei', 'JS-08', 'in_bearbeitung', null),
  (9, 'a7f00000-0000-4000-8000-000000000029', 'a7f00000-0000-4000-8000-000000000010', 'Ganztägig heute', 'JS-09', 'nicht_bearbeitet', null),
  (10, 'a7f00000-0000-4000-8000-000000000030', 'a7f00000-0000-4000-8000-000000000010', 'Im Projekt', 'JS-10', 'nicht_bearbeitet', 'a7f00000-0000-4000-8000-000000000040'),
  (11, 'a7f00000-0000-4000-8000-000000000031', 'a7f00000-0000-4000-8000-000000000010', 'Fertig nach Besuch', 'JS-11', 'fertig', null),
  (12, 'a7f00000-0000-4000-8000-000000000032', 'a7f00000-0000-4000-8000-000000000011', 'Fremd', 'JS-12', 'nicht_bearbeitet', null),
  (13, 'a7f00000-0000-4000-8000-000000000033', 'a7f00000-0000-4000-8000-000000000011', 'Fremd besucht', 'JS-13', 'nicht_bearbeitet', null),
  (14, 'a7f00000-0000-4000-8000-000000000034', 'a7f00000-0000-4000-8000-000000000010', 'Storniert ohne alles', 'JS-14', 'nicht_bearbeitet', null),
  (15, 'a7f00000-0000-4000-8000-000000000035', 'a7f00000-0000-4000-8000-000000000010', 'Storniert nach Besuch', 'JS-15', 'in_bearbeitung', null)
) as job(n, id, organization_id, title, job_number, status, project_id);

-- Cancelling keeps the job's status (preserve_job_legacy_status_on_cancellation): only its state says so.
-- The execution guard admits one flagged row per statement, as the owning RPCs write.
select set_config('app.work_execution_write', 'true', true);
update public.jobs set execution_state = 'cancelled' where id = 'a7f00000-0000-4000-8000-000000000034';
select set_config('app.work_execution_write', 'true', true);
update public.jobs set execution_state = 'cancelled' where id = 'a7f00000-0000-4000-8000-000000000035';
do $$
begin
  if exists (
    select 1 from public.jobs
    where id in ('a7f00000-0000-4000-8000-000000000034', 'a7f00000-0000-4000-8000-000000000035')
      and status not in ('nicht_bearbeitet', 'in_bearbeitung')
  ) then raise exception 'the fixture expects a cancelled job to keep its open status'; end if;
end;
$$;

insert into public.job_assignments (organization_id, job_id, user_id, assigned_by) values
('a7f00000-0000-4000-8000-000000000010', 'a7f00000-0000-4000-8000-000000000022',
 'a7f00000-0000-4000-8000-000000000002', 'a7f00000-0000-4000-8000-000000000001');

insert into public.planning_occurrences (organization_id, job_id, entry_kind, time_kind, status, start_at, end_at) values
-- Only a cancelled visit: no scheduled visit, so not overdue.
('a7f00000-0000-4000-8000-000000000010', 'a7f00000-0000-4000-8000-000000000023', 'job_visit', 'timed', 'cancelled',
 now() + interval '1 day', now() + interval '1 day 2 hours'),
-- Every visit over: the last one ended a day ago.
('a7f00000-0000-4000-8000-000000000010', 'a7f00000-0000-4000-8000-000000000026', 'job_visit', 'timed', 'scheduled',
 now() - interval '3 days 2 hours', now() - interval '3 days'),
('a7f00000-0000-4000-8000-000000000010', 'a7f00000-0000-4000-8000-000000000026', 'job_visit', 'timed', 'scheduled',
 now() - interval '1 day 2 hours', now() - interval '1 day'),
-- A past visit and one still ahead: not overdue.
('a7f00000-0000-4000-8000-000000000010', 'a7f00000-0000-4000-8000-000000000027', 'job_visit', 'timed', 'scheduled',
 now() - interval '5 days 2 hours', now() - interval '5 days'),
('a7f00000-0000-4000-8000-000000000010', 'a7f00000-0000-4000-8000-000000000027', 'job_visit', 'timed', 'scheduled',
 now() + interval '2 days', now() + interval '2 days 2 hours'),
-- A job of a project whose visit is over.
('a7f00000-0000-4000-8000-000000000010', 'a7f00000-0000-4000-8000-000000000030', 'job_visit', 'timed', 'scheduled',
 now() - interval '2 days 2 hours', now() - interval '2 days'),
-- A cancelled job's past visit.
('a7f00000-0000-4000-8000-000000000010', 'a7f00000-0000-4000-8000-000000000035', 'job_visit', 'timed', 'scheduled',
 now() - interval '4 days 2 hours', now() - interval '4 days'),
-- A finished job's past visit, and another organization's.
('a7f00000-0000-4000-8000-000000000010', 'a7f00000-0000-4000-8000-000000000031', 'job_visit', 'timed', 'scheduled',
 now() - interval '4 days 2 hours', now() - interval '4 days'),
('a7f00000-0000-4000-8000-000000000011', 'a7f00000-0000-4000-8000-000000000033', 'job_visit', 'timed', 'scheduled',
 now() - interval '4 days 2 hours', now() - interval '4 days');
insert into public.planning_occurrences (organization_id, job_id, entry_kind, time_kind, status, start_date, end_date_exclusive) values
-- An all-day visit that ended yesterday in Berlin, and one that runs through today.
('a7f00000-0000-4000-8000-000000000010', 'a7f00000-0000-4000-8000-000000000028', 'job_visit', 'all_day', 'scheduled',
 (now() at time zone 'Europe/Berlin')::date - 2, (now() at time zone 'Europe/Berlin')::date),
('a7f00000-0000-4000-8000-000000000010', 'a7f00000-0000-4000-8000-000000000029', 'job_visit', 'all_day', 'scheduled',
 (now() at time zone 'Europe/Berlin')::date - 1, (now() at time zone 'Europe/Berlin')::date + 1);

set local role service_role;

do $$
declare
  sets jsonb := public.read_manager_attention_sets('a7f00000-0000-4000-8000-000000000010', 100);
  overdue text[];
  last_timed timestamptz;
  last_all_day date;
begin
  select array_agg(job.value ->> 'job_number' order by job.ordinality) into overdue
  from jsonb_array_elements(sets -> 'overdue_jobs') with ordinality as job(value, ordinality);
  if overdue is distinct from array['JS-06', 'JS-08', 'JS-10'] then
    raise exception 'overdue jobs: expected JS-06, JS-08, JS-10, got %', overdue;
  end if;
  if (sets -> 'overdue_jobs' -> 2 ->> 'project_number') is distinct from 'JS-P-1'
    or (sets -> 'overdue_jobs' -> 2 ->> 'project_id') is distinct from 'a7f00000-0000-4000-8000-000000000040'
    or (sets -> 'overdue_jobs' -> 0 ->> 'project_id') is not null
  then raise exception 'an overdue job names its project wrongly: %', sets -> 'overdue_jobs'; end if;
  last_timed := (sets -> 'overdue_jobs' -> 0 ->> 'last_timed_end')::timestamptz;
  if last_timed is null or abs(extract(epoch from (now() - interval '1 day') - last_timed)) > 1
    or (sets -> 'overdue_jobs' -> 0 ->> 'last_all_day_end') is not null
  then raise exception 'the overdue timed job carries the wrong last end: %', sets -> 'overdue_jobs' -> 0; end if;
  last_all_day := (sets -> 'overdue_jobs' -> 1 ->> 'last_all_day_end')::date;
  if last_all_day is distinct from (now() at time zone 'Europe/Berlin')::date
    or (sets -> 'overdue_jobs' -> 1 ->> 'last_timed_end') is not null
  then raise exception 'the overdue all-day job carries the wrong last end: %', sets -> 'overdue_jobs' -> 1; end if;
end;
$$;

do $$
declare
  other jsonb := public.read_manager_attention_sets('a7f00000-0000-4000-8000-000000000011', 100);
  capped jsonb := public.read_manager_attention_sets('a7f00000-0000-4000-8000-000000000010', 0);
begin
  if jsonb_array_length(other -> 'overdue_jobs') is distinct from 1
    or (other -> 'overdue_jobs' -> 0 ->> 'job_number') is distinct from 'JS-13'
  then raise exception 'the overdue job set crosses the organization: %', other; end if;
  if jsonb_array_length(capped -> 'overdue_jobs') is distinct from 1
  then raise exception 'the overdue job set cuts below its limit plus one: %', capped; end if;
end;
$$;

reset role;

do $$
begin
  if has_function_privilege('authenticated', 'public.read_manager_attention_sets(uuid,integer)', 'EXECUTE')
    or has_function_privilege('anon', 'public.read_manager_attention_sets(uuid,integer)', 'EXECUTE')
  then raise exception 'a browser role can read the office''s attention sets'; end if;
end;
$$;

rollback;
