-- The member list read get_org_members_for_user (migration
-- 20260502180735_add_security_invoker_rpc_compatibility_wrappers.sql) answers
-- a member of the organization with that organization's members only, and
-- refuses a caller who is not a member of the organization it names, so one
-- organization never lists another's people. list_profile_references (migration
-- 20261108050000_list_profile_references_with_membership.sql) returns the named
-- people's profiles and says for each whether they are a member of the
-- organization it names, so a reader can tell a person who left. Only the
-- service role executes either.
-- Runs inside one transaction against the local stack and rolls back.
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
('3b000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'members-owner-a@example.test', '', now(), '{}',
 '{"first_name":"Anna","last_name":"Eins"}', now(), now()),
('3b000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'members-employee-a@example.test', '', now(), '{}',
 '{"first_name":"Emil","last_name":"Eins"}', now(), now()),
('3b000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'members-owner-b@example.test', '', now(), '{}',
 '{"first_name":"Berta","last_name":"Zwei"}', now(), now()),
('3b000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'members-employee-b@example.test', '', now(), '{}',
 '{"first_name":"Fritz","last_name":"Zwei"}', now(), now());

insert into public.organizations (id, name, admin_id, unique_code) values
('3b000000-0000-0000-0000-000000000010', 'Mitglieder Eins', '3b000000-0000-0000-0000-000000000001', 'MEMA10'),
('3b000000-0000-0000-0000-000000000011', 'Mitglieder Zwei', '3b000000-0000-0000-0000-000000000003', 'MEMB11');
insert into public.organization_members (organization_id, user_id, role) values
('3b000000-0000-0000-0000-000000000010', '3b000000-0000-0000-0000-000000000001', 'admin'),
('3b000000-0000-0000-0000-000000000010', '3b000000-0000-0000-0000-000000000002', 'employee'),
('3b000000-0000-0000-0000-000000000011', '3b000000-0000-0000-0000-000000000003', 'admin'),
('3b000000-0000-0000-0000-000000000011', '3b000000-0000-0000-0000-000000000004', 'employee')
on conflict do nothing;

create function pg_temp.expect_member_read_refusal(p_label text, p_org_id uuid, p_user_id uuid)
returns void
language plpgsql as $$
begin
  begin
    perform public.get_org_members_for_user(p_org_id, p_user_id);
  exception when others then
    if sqlerrm <> 'not_authorized' then
      raise exception '% refused with % instead of not_authorized', p_label, sqlerrm;
    end if;
    return;
  end;
  raise exception '% read the member list', p_label;
end;
$$;
grant execute on function pg_temp.expect_member_read_refusal(text, uuid, uuid) to service_role;

do $$
begin
  if has_function_privilege('anon', 'public.get_org_members_for_user(uuid, uuid)', 'execute')
    or has_function_privilege('authenticated', 'public.get_org_members_for_user(uuid, uuid)', 'execute')
  then
    raise exception 'a client role executes get_org_members_for_user';
  end if;
  if has_function_privilege('anon', 'public.list_profile_references(uuid, uuid[])', 'execute')
    or has_function_privilege('authenticated', 'public.list_profile_references(uuid, uuid[])', 'execute')
  then
    raise exception 'a client role executes list_profile_references';
  end if;
end;
$$;

set local role service_role;

do $$
declare
  v_listed uuid[];
begin
  -- Each organization's member lists exactly its own members, for its owner and its field worker.
  select array_agg(user_id order by user_id) into v_listed
  from public.get_org_members_for_user('3b000000-0000-0000-0000-000000000010', '3b000000-0000-0000-0000-000000000001');
  if v_listed is distinct from array['3b000000-0000-0000-0000-000000000001', '3b000000-0000-0000-0000-000000000002']::uuid[] then
    raise exception 'the owner of A lists %, not the members of A', v_listed;
  end if;
  select array_agg(user_id order by user_id) into v_listed
  from public.get_org_members_for_user('3b000000-0000-0000-0000-000000000010', '3b000000-0000-0000-0000-000000000002');
  if v_listed is distinct from array['3b000000-0000-0000-0000-000000000001', '3b000000-0000-0000-0000-000000000002']::uuid[] then
    raise exception 'the field worker of A lists %, not the members of A', v_listed;
  end if;
  select array_agg(user_id order by user_id) into v_listed
  from public.get_org_members_for_user('3b000000-0000-0000-0000-000000000011', '3b000000-0000-0000-0000-000000000003');
  if v_listed is distinct from array['3b000000-0000-0000-0000-000000000003', '3b000000-0000-0000-0000-000000000004']::uuid[] then
    raise exception 'the owner of B lists %, not the members of B', v_listed;
  end if;
end;
$$;

do $$
declare
  v_references text[];
begin
  -- Each named person comes back once with their profile; only the members of the
  -- named organization count as members, and an unknown id returns nothing.
  select array_agg(format('%s:%s', reference.first_name, reference.is_member) order by reference.id)
  into v_references
  from public.list_profile_references(
    '3b000000-0000-0000-0000-000000000010',
    array[
      '3b000000-0000-0000-0000-000000000001', '3b000000-0000-0000-0000-000000000003',
      '3b000000-0000-0000-0000-000000000004', '3b000000-0000-0000-0000-0000000000ff'
    ]::uuid[]
  ) reference;
  if v_references is distinct from array['Anna:t', 'Berta:f', 'Fritz:f'] then
    raise exception 'the references for A are %, not Anna as member and Berta and Fritz as non-members', v_references;
  end if;
  select array_agg(format('%s:%s', reference.first_name, reference.is_member) order by reference.id)
  into v_references
  from public.list_profile_references(
    '3b000000-0000-0000-0000-000000000011',
    array['3b000000-0000-0000-0000-000000000002', '3b000000-0000-0000-0000-000000000004']::uuid[]
  ) reference;
  if v_references is distinct from array['Emil:f', 'Fritz:t'] then
    raise exception 'the references for B are %, not Emil as non-member and Fritz as member', v_references;
  end if;
  -- A person who has left keeps the profile row, and the reader decides what to show of it.
  if not exists (
    select 1
    from public.list_profile_references(
      '3b000000-0000-0000-0000-000000000010', array['3b000000-0000-0000-0000-000000000004']::uuid[]
    ) reference
    where reference.email = 'members-employee-b@example.test'
  ) then
    raise exception 'list_profile_references dropped the profile columns of a non-member';
  end if;
end;
$$;

-- A caller who is not a member of the named organization reads none of its people.
select pg_temp.expect_member_read_refusal('the owner of A on B',
  '3b000000-0000-0000-0000-000000000011', '3b000000-0000-0000-0000-000000000001');
select pg_temp.expect_member_read_refusal('the field worker of B on A',
  '3b000000-0000-0000-0000-000000000010', '3b000000-0000-0000-0000-000000000004');
select pg_temp.expect_member_read_refusal('no caller on A',
  '3b000000-0000-0000-0000-000000000010', null);

reset role;
rollback;
