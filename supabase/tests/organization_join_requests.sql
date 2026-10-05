-- Join requests by organization code (migration
-- 20261002140000_create_organization_join_requests.sql): client roles only
-- read, the requester sees their own requests and Admin and Büro those of
-- their organization, the state machine allows one open request per person
-- and closes each request once, and the approval creates the employee
-- membership with its personnel record in one step.
-- Runs inside one transaction against the local stack and rolls back.
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
('3a000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'join-owner@example.test', '', now(), '{}',
 '{"first_name":"Olga","last_name":"Owner"}', now(), now()),
('3a000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'join-buero@example.test', '', now(), '{}',
 '{"first_name":"Bea","last_name":"Büro"}', now(), now()),
('3a000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'join-employee@example.test', '', now(), '{}',
 '{"first_name":"Emil","last_name":"Employee"}', now(), now()),
('3a000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'join-requester@example.test', '', now(), '{}',
 '{"first_name":"Rita","last_name":"Requester"}', now(), now()),
('3a000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'join-foreign-owner@example.test', '', now(), '{}',
 '{"first_name":"Fritz","last_name":"Fremd"}', now(), now()),
('3a000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'join-second@example.test', '', now(), '{}',
 '{"first_name":"Sven","last_name":"Second"}', now(), now());

insert into public.organizations (id, name, admin_id, unique_code) values
('3a000000-0000-0000-0000-000000000010', 'Join SQL', '3a000000-0000-0000-0000-000000000001', 'JOINSQ'),
('3a000000-0000-0000-0000-000000000011', 'Join Foreign', '3a000000-0000-0000-0000-000000000005', 'JOINFR');

insert into public.organization_members (organization_id, user_id, role) values
('3a000000-0000-0000-0000-000000000010', '3a000000-0000-0000-0000-000000000002', 'buero'),
('3a000000-0000-0000-0000-000000000010', '3a000000-0000-0000-0000-000000000003', 'employee'),
('3a000000-0000-0000-0000-000000000011', '3a000000-0000-0000-0000-000000000006', 'employee');

-- Grants: authenticated reads only, anon nothing, the service role writes but
-- never deletes, and only the service role runs the approval.
do $$
declare approve constant regprocedure := 'public.approve_organization_join_request(uuid, uuid, uuid)';
begin
  if has_table_privilege('anon', 'public.organization_join_requests',
      'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') then
    raise exception 'anon holds a privilege on organization_join_requests';
  end if;
  if not has_table_privilege('authenticated', 'public.organization_join_requests', 'SELECT')
    or has_table_privilege('authenticated', 'public.organization_join_requests', 'INSERT,UPDATE,DELETE') then
    raise exception 'authenticated must only read organization_join_requests';
  end if;
  if has_table_privilege('service_role', 'public.organization_join_requests', 'DELETE') then
    raise exception 'service_role may delete organization_join_requests';
  end if;
  if has_function_privilege('anon', approve, 'execute')
    or has_function_privilege('authenticated', approve, 'execute')
    or not has_function_privilege('service_role', approve, 'execute') then
    raise exception 'approve_organization_join_request must be executable by service_role only';
  end if;
  if not (select prosecdef and proconfig @> array['search_path=""'] from pg_proc where oid = approve) then
    raise exception 'approve_organization_join_request must be SECURITY DEFINER with an empty search_path';
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'organization_join_requests'
  ) then
    raise exception 'organization_join_requests is missing from the Realtime publication';
  end if;
end;
$$;

set local role service_role;

-- One open request per person: a second pending request is refused, also for
-- another organization.
insert into public.organization_join_requests (id, organization_id, user_id) values
('3a000000-0000-0000-0000-000000000020', '3a000000-0000-0000-0000-000000000010', '3a000000-0000-0000-0000-000000000004');
do $$
begin
  begin
    insert into public.organization_join_requests (organization_id, user_id)
    values ('3a000000-0000-0000-0000-000000000011', '3a000000-0000-0000-0000-000000000004');
    raise exception 'second pending request was accepted';
  exception when unique_violation then null;
  end;
end;
$$;

reset role;

-- Row visibility, as the Data API roles meet it.
set local role anon;
do $$
begin
  begin
    perform 1 from public.organization_join_requests;
    raise exception 'anon read organization_join_requests';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '3a000000-0000-0000-0000-000000000004', true);
do $$
begin
  if (select count(*) from public.organization_join_requests) <> 1 then
    raise exception 'the requester does not see exactly their own request';
  end if;
  begin
    update public.organization_join_requests set status = 'withdrawn', decided_at = now();
    raise exception 'the requester wrote a request directly';
  exception when insufficient_privilege then null;
  end;
end;
$$;
select set_config('request.jwt.claim.sub', '3a000000-0000-0000-0000-000000000002', true);
do $$
begin
  if (select count(*) from public.organization_join_requests) <> 1 then
    raise exception 'Büro does not see the request of its organization';
  end if;
end;
$$;
select set_config('request.jwt.claim.sub', '3a000000-0000-0000-0000-000000000001', true);
do $$
begin
  if (select count(*) from public.organization_join_requests) <> 1 then
    raise exception 'the owner does not see the request of the organization';
  end if;
end;
$$;
select set_config('request.jwt.claim.sub', '3a000000-0000-0000-0000-000000000003', true);
do $$
begin
  if exists (select 1 from public.organization_join_requests) then
    raise exception 'an employee sees join requests';
  end if;
end;
$$;
select set_config('request.jwt.claim.sub', '3a000000-0000-0000-0000-000000000005', true);
do $$
begin
  if exists (select 1 from public.organization_join_requests) then
    raise exception 'the owner of another organization sees a foreign join request';
  end if;
end;
$$;
reset role;

set local role service_role;

-- The approval refuses a foreign organization, an employee and a stranger
-- as approver, and changes nothing on refusal.
do $$
declare
  request constant uuid := '3a000000-0000-0000-0000-000000000020';
  org constant uuid := '3a000000-0000-0000-0000-000000000010';
  requester constant uuid := '3a000000-0000-0000-0000-000000000004';
begin
  begin
    perform public.approve_organization_join_request(request, '3a000000-0000-0000-0000-000000000011',
      '3a000000-0000-0000-0000-000000000005');
    raise exception 'approval through a foreign organization was accepted';
  exception when others then
    if sqlerrm <> 'join_request_not_found' then raise; end if;
  end;
  begin
    perform public.approve_organization_join_request(request, org, '3a000000-0000-0000-0000-000000000003');
    raise exception 'an employee approved a join request';
  exception when others then
    if sqlerrm <> 'not_authorized' then raise; end if;
  end;
  begin
    perform public.approve_organization_join_request(request, org, '3a000000-0000-0000-0000-000000000005');
    raise exception 'a stranger approved a join request';
  exception when others then
    if sqlerrm <> 'not_authorized' then raise; end if;
  end;
  if exists (select 1 from public.organization_members where user_id = requester)
    or (select status from public.organization_join_requests where id = request) <> 'pending' then
    raise exception 'a refused approval changed state';
  end if;
end;
$$;

-- Büro approves: the employee membership and its personnel record exist, the
-- request is closed with the decision, and a second approval is refused.
do $$
declare
  request constant uuid := '3a000000-0000-0000-0000-000000000020';
  org constant uuid := '3a000000-0000-0000-0000-000000000010';
  requester constant uuid := '3a000000-0000-0000-0000-000000000004';
  approver constant uuid := '3a000000-0000-0000-0000-000000000002';
  closed record;
begin
  if public.approve_organization_join_request(request, org, approver) <> requester then
    raise exception 'the approval did not return the requester';
  end if;
  if (select role from public.organization_members where organization_id = org and user_id = requester)
    is distinct from 'employee' then
    raise exception 'the approval did not create an employee membership';
  end if;
  if not exists (select 1 from public.employee_records where organization_id = org and user_id = requester) then
    raise exception 'the approval did not create the personnel record';
  end if;
  select status, decided_by, decided_at into closed from public.organization_join_requests where id = request;
  if closed.status <> 'approved' or closed.decided_by <> approver or closed.decided_at is null then
    raise exception 'the approval did not close the request with its decision';
  end if;
  begin
    perform public.approve_organization_join_request(request, org, approver);
    raise exception 'a closed request was approved twice';
  exception when others then
    if sqlerrm <> 'join_request_not_pending' then raise; end if;
  end;
  begin
    update public.organization_join_requests set status = 'declined', decided_by = approver where id = request;
    raise exception 'a closed request was declined';
  exception when others then
    if sqlerrm <> 'join_request_not_pending' then raise; end if;
  end;
end;
$$;

-- An open request may only close: it cannot move to another organization or
-- person, and a decline needs its decider.
insert into public.organization_join_requests (id, organization_id, user_id) values
('3a000000-0000-0000-0000-000000000021', '3a000000-0000-0000-0000-000000000011', '3a000000-0000-0000-0000-000000000004');
do $$
declare request constant uuid := '3a000000-0000-0000-0000-000000000021';
begin
  begin
    update public.organization_join_requests
    set organization_id = '3a000000-0000-0000-0000-000000000010' where id = request;
    raise exception 'an open request moved to another organization';
  exception when others then
    if sqlerrm <> 'join_request_invalid_transition' then raise; end if;
  end;
  begin
    update public.organization_join_requests set status = 'declined', decided_at = now() where id = request;
    raise exception 'a decline without its decider was accepted';
  exception when check_violation then null;
  end;
  begin
    update public.organization_join_requests set status = 'withdrawn' where id = request;
    raise exception 'a withdrawal without its time was accepted';
  exception when check_violation then null;
  end;
end;
$$;

-- A member of the requested owner's organizations cannot join a foreign
-- owner's organization: the approval refuses and the request stays open.
do $$
declare request constant uuid := '3a000000-0000-0000-0000-000000000021';
begin
  begin
    perform public.approve_organization_join_request(request, '3a000000-0000-0000-0000-000000000011',
      '3a000000-0000-0000-0000-000000000005');
    raise exception 'an approval across owners was accepted';
  exception when others then
    if sqlerrm <> 'admin_mismatch' then raise; end if;
  end;
  update public.organization_join_requests set status = 'withdrawn', decided_at = now() where id = request;
  if (select status from public.organization_join_requests where id = request) <> 'withdrawn' then
    raise exception 'the requester could not withdraw an open request';
  end if;
end;
$$;

reset role;
rollback;
