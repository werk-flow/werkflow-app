-- What a signed-in user can read and write through the Data API with their own
-- JWT (docs/technical/security.md, "Database"). Runs inside one transaction
-- against the local stack and rolls back.
--
-- Work: Admin and Büro read every job, project and assignment of their
-- organization; an employee reads only the jobs they are assigned to, the
-- assignments of those jobs and the projects that contain one of them
-- (docs/features/jobs-and-projects.md, "Assignment and qualifications").
-- Profiles: a user changes their own name and avatar, never the email the
-- Auth account owns.
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
('cb000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'crb-admin@example.test', '', now(), '{}',
 '{"first_name":"Admin","last_name":"CRB"}', now(), now()),
('cb000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'crb-buero@example.test', '', now(), '{}',
 '{"first_name":"Buero","last_name":"CRB"}', now(), now()),
('cb000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'crb-employee@example.test', '', now(), '{}',
 '{"first_name":"Employee","last_name":"CRB"}', now(), now()),
('cb000000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'crb-colleague@example.test', '', now(), '{}',
 '{"first_name":"Colleague","last_name":"CRB"}', now(), now()),
('cb000000-0000-4000-8000-000000000005', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'crb-foreign@example.test', '', now(), '{}',
 '{"first_name":"Foreign","last_name":"CRB"}', now(), now());

set local role service_role;

insert into public.organizations (id, name, admin_id, unique_code) values
('cb000000-0000-4000-8000-000000000010', 'CRB SQL', 'cb000000-0000-4000-8000-000000000001', 'CRBSQL01'),
('cb000000-0000-4000-8000-000000000011', 'CRB Fremd', 'cb000000-0000-4000-8000-000000000005', 'CRBSQL02');

-- Creating an organization makes its admin a member.
insert into public.organization_members (organization_id, user_id, role) values
('cb000000-0000-4000-8000-000000000010', 'cb000000-0000-4000-8000-000000000002', 'buero'),
('cb000000-0000-4000-8000-000000000010', 'cb000000-0000-4000-8000-000000000003', 'employee'),
('cb000000-0000-4000-8000-000000000010', 'cb000000-0000-4000-8000-000000000004', 'employee');

-- Project A holds the employee's job and a sibling job; project B holds only
-- the colleague's job; one standalone job is unassigned.
insert into public.projects (id, organization_id, name, project_number, created_by) values
('cb000000-0000-4000-8000-000000000020', 'cb000000-0000-4000-8000-000000000010', 'Projekt A', 'CRB-P-1',
 'cb000000-0000-4000-8000-000000000001'),
('cb000000-0000-4000-8000-000000000021', 'cb000000-0000-4000-8000-000000000010', 'Projekt B', 'CRB-P-2',
 'cb000000-0000-4000-8000-000000000001');

insert into public.jobs (id, organization_id, project_id, title, job_number, created_by) values
('cb000000-0000-4000-8000-000000000030', 'cb000000-0000-4000-8000-000000000010',
 'cb000000-0000-4000-8000-000000000020', 'Eigener Auftrag', 'CRB-1', 'cb000000-0000-4000-8000-000000000001'),
('cb000000-0000-4000-8000-000000000031', 'cb000000-0000-4000-8000-000000000010',
 'cb000000-0000-4000-8000-000000000020', 'Geschwister-Auftrag', 'CRB-2', 'cb000000-0000-4000-8000-000000000001'),
('cb000000-0000-4000-8000-000000000032', 'cb000000-0000-4000-8000-000000000010',
 'cb000000-0000-4000-8000-000000000021', 'Auftrag der Kollegin', 'CRB-3', 'cb000000-0000-4000-8000-000000000001'),
('cb000000-0000-4000-8000-000000000033', 'cb000000-0000-4000-8000-000000000010',
 null, 'Offener Auftrag', 'CRB-4', 'cb000000-0000-4000-8000-000000000001');

-- The employee and the colleague share the employee's job; the colleague
-- alone works the job in project B.
insert into public.job_assignments (job_id, user_id, assigned_by) values
('cb000000-0000-4000-8000-000000000030', 'cb000000-0000-4000-8000-000000000003', 'cb000000-0000-4000-8000-000000000001'),
('cb000000-0000-4000-8000-000000000030', 'cb000000-0000-4000-8000-000000000004', 'cb000000-0000-4000-8000-000000000001'),
('cb000000-0000-4000-8000-000000000032', 'cb000000-0000-4000-8000-000000000004', 'cb000000-0000-4000-8000-000000000001');

create function pg_temp.visible_work() returns text language sql as $$
  select concat_ws(' | ',
    'jobs=' || coalesce((select string_agg(job_number, ',' order by job_number) from public.jobs
      where organization_id in ('cb000000-0000-4000-8000-000000000010', 'cb000000-0000-4000-8000-000000000011')), ''),
    'projects=' || coalesce((select string_agg(project_number, ',' order by project_number) from public.projects
      where organization_id in ('cb000000-0000-4000-8000-000000000010', 'cb000000-0000-4000-8000-000000000011')), ''),
    'assignments=' || coalesce((select string_agg(j.job_number || ':' || right(a.user_id::text, 1), ','
        order by j.job_number, a.user_id)
      from public.job_assignments a join public.jobs j on j.id = a.job_id
      where a.organization_id in ('cb000000-0000-4000-8000-000000000010', 'cb000000-0000-4000-8000-000000000011')), ''),
    'assignments_raw=' || (select count(*) from public.job_assignments
      where organization_id in ('cb000000-0000-4000-8000-000000000010', 'cb000000-0000-4000-8000-000000000011'))::text
  );
$$;
grant execute on function pg_temp.visible_work() to authenticated;

create function pg_temp.expect_work(p_user uuid, p_expected text) returns void language plpgsql as $$
declare actual text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  actual := pg_temp.visible_work();
  execute 'reset role';
  if actual is distinct from p_expected then
    raise exception 'Visible work for % is "%", expected "%"', p_user, actual, p_expected;
  end if;
end;
$$;

reset role;

-- Admin and Büro read all work of their organization.
select pg_temp.expect_work('cb000000-0000-4000-8000-000000000001',
  'jobs=CRB-1,CRB-2,CRB-3,CRB-4 | projects=CRB-P-1,CRB-P-2 | assignments=CRB-1:3,CRB-1:4,CRB-3:4 | assignments_raw=3');
select pg_temp.expect_work('cb000000-0000-4000-8000-000000000002',
  'jobs=CRB-1,CRB-2,CRB-3,CRB-4 | projects=CRB-P-1,CRB-P-2 | assignments=CRB-1:3,CRB-1:4,CRB-3:4 | assignments_raw=3');

-- An employee reads their own job, its team, and the project that contains it;
-- no sibling job, no unassigned job, no foreign project.
select pg_temp.expect_work('cb000000-0000-4000-8000-000000000003',
  'jobs=CRB-1 | projects=CRB-P-1 | assignments=CRB-1:3,CRB-1:4 | assignments_raw=2');
select pg_temp.expect_work('cb000000-0000-4000-8000-000000000004',
  'jobs=CRB-1,CRB-3 | projects=CRB-P-1,CRB-P-2 | assignments=CRB-1:3,CRB-1:4,CRB-3:4 | assignments_raw=3');

-- Another organization's admin reads nothing of this organization.
select pg_temp.expect_work('cb000000-0000-4000-8000-000000000005',
  'jobs= | projects= | assignments= | assignments_raw=0');

-- Removing the assignment removes the read at once.
set local role service_role;
delete from public.job_assignments
where job_id = 'cb000000-0000-4000-8000-000000000030' and user_id = 'cb000000-0000-4000-8000-000000000003';
reset role;
select pg_temp.expect_work('cb000000-0000-4000-8000-000000000003',
  'jobs= | projects= | assignments= | assignments_raw=0');

-- A suspended or removed membership reads nothing, even with an assignment row.
set local role service_role;
insert into public.job_assignments (job_id, user_id, assigned_by) values
('cb000000-0000-4000-8000-000000000033', 'cb000000-0000-4000-8000-000000000003', 'cb000000-0000-4000-8000-000000000001');
reset role;
select pg_temp.expect_work('cb000000-0000-4000-8000-000000000003',
  'jobs=CRB-4 | projects= | assignments=CRB-4:3 | assignments_raw=1');
delete from public.organization_members
where organization_id = 'cb000000-0000-4000-8000-000000000010' and user_id = 'cb000000-0000-4000-8000-000000000003';
select pg_temp.expect_work('cb000000-0000-4000-8000-000000000003',
  'jobs= | projects= | assignments= | assignments_raw=0');

-- A user edits their own name and avatar, never their email and never
-- another person's row.
select set_config('request.jwt.claims',
  '{"sub":"cb000000-0000-4000-8000-000000000004","role":"authenticated"}', true);
set local role authenticated;
update public.profiles set first_name = 'Neu', avatar_path = null, updated_at = now()
where id = 'cb000000-0000-4000-8000-000000000004';
do $$
begin
  begin
    update public.profiles set email = 'attacker@example.test'
    where id = 'cb000000-0000-4000-8000-000000000004';
    raise exception 'profile email update was accepted';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.profiles (id, email, first_name, last_name)
    values (gen_random_uuid(), 'new@example.test', 'X', 'Y');
    raise exception 'profile insert was accepted';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.profiles where id = 'cb000000-0000-4000-8000-000000000004';
    raise exception 'profile delete was accepted';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.jobs (organization_id, title) values ('cb000000-0000-4000-8000-000000000010', 'Direkt');
    raise exception 'direct job insert was accepted';
  exception when insufficient_privilege then null;
  end;
end;
$$;
update public.profiles set first_name = 'Fremd'
where id = 'cb000000-0000-4000-8000-000000000001';
reset role;
do $$
begin
  if (select first_name from public.profiles where id = 'cb000000-0000-4000-8000-000000000004') <> 'Neu' then
    raise exception 'own profile name update was lost';
  end if;
  if (select email from public.profiles where id = 'cb000000-0000-4000-8000-000000000004') <> 'crb-colleague@example.test' then
    raise exception 'profile email changed';
  end if;
  if (select first_name from public.profiles where id = 'cb000000-0000-4000-8000-000000000001') <> 'Admin' then
    raise exception 'another person''s profile changed';
  end if;
end;
$$;

rollback;
