-- A preference save changes one key of the caller's preference document and
-- keeps every other key, only for a member of the organization, and only
-- through the service role (migration
-- 20261006150000_set_one_user_preference_atomically.sql).
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
('c5000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'preference-admin@example.test', '', now(), '{}',
 '{"first_name":"Admin","last_name":"Vorlieben"}', now(), now()),
('c5000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'preference-employee@example.test', '', now(), '{}',
 '{"first_name":"Employee","last_name":"Vorlieben"}', now(), now()),
('c5000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'preference-colleague@example.test', '', now(), '{}',
 '{"first_name":"Colleague","last_name":"Vorlieben"}', now(), now()),
('c5000000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'preference-outsider@example.test', '', now(), '{}',
 '{"first_name":"Outsider","last_name":"Vorlieben"}', now(), now());

insert into public.organizations (id, name, admin_id, unique_code) values
('c5000000-0000-4000-8000-000000000010', 'Preference SQL',
 'c5000000-0000-4000-8000-000000000001', 'PREFSQL'),
('c5000000-0000-4000-8000-000000000011', 'Preference SQL other',
 'c5000000-0000-4000-8000-000000000004', 'PREFSQLO');
insert into public.organization_members (organization_id, user_id, role) values
('c5000000-0000-4000-8000-000000000010', 'c5000000-0000-4000-8000-000000000002', 'employee'),
('c5000000-0000-4000-8000-000000000010', 'c5000000-0000-4000-8000-000000000003', 'employee');

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

create function pg_temp.preferences_of(p_user_id uuid) returns jsonb language sql as $$
  select stored.preferences from public.organization_user_preferences stored
  where stored.organization_id = 'c5000000-0000-4000-8000-000000000010' and stored.user_id = p_user_id;
$$;

set local role service_role;

-- The first save creates the row; the second save of another key keeps the first.
select public.set_organization_user_preference('c5000000-0000-4000-8000-000000000010',
  'c5000000-0000-4000-8000-000000000002', '{auftraege,visibleColumns}', '["nr","status"]');
select public.set_organization_user_preference('c5000000-0000-4000-8000-000000000010',
  'c5000000-0000-4000-8000-000000000002', '{calendar}', '{"view":"month"}');

reset role;

do $$
begin
  if pg_temp.preferences_of('c5000000-0000-4000-8000-000000000002')
    <> '{"auftraege":{"visibleColumns":["nr","status"]},"calendar":{"view":"month"}}'::jsonb
  then
    raise exception 'a save of another key lost the earlier key: %',
      pg_temp.preferences_of('c5000000-0000-4000-8000-000000000002');
  end if;
end;
$$;

-- A nested save keeps the other keys of its parent object and every other
-- top-level key; a top-level save replaces only its own key.
update public.organization_user_preferences stored
set preferences = stored.preferences || '{"auftraege":{"visibleColumns":["nr"],"density":"compact"},"other":1}'
where stored.organization_id = 'c5000000-0000-4000-8000-000000000010'
  and stored.user_id = 'c5000000-0000-4000-8000-000000000002';

set local role service_role;
select public.set_organization_user_preference('c5000000-0000-4000-8000-000000000010',
  'c5000000-0000-4000-8000-000000000002', '{auftraege,visibleColumns}', '["kunde"]');
select public.set_organization_user_preference('c5000000-0000-4000-8000-000000000010',
  'c5000000-0000-4000-8000-000000000002', '{calendar}', '{"view":"day"}');
reset role;

do $$
begin
  if pg_temp.preferences_of('c5000000-0000-4000-8000-000000000002')
    <> '{"auftraege":{"visibleColumns":["kunde"],"density":"compact"},"calendar":{"view":"day"},"other":1}'::jsonb
  then
    raise exception 'a key save changed a key it does not own: %',
      pg_temp.preferences_of('c5000000-0000-4000-8000-000000000002');
  end if;
  if pg_temp.preferences_of('c5000000-0000-4000-8000-000000000003') is not null then
    raise exception 'a save reached another member''s row';
  end if;
end;
$$;

-- A nested save over a parent that is no object replaces that parent with an object.
update public.organization_user_preferences stored
set preferences = stored.preferences || '{"auftraege":"damaged"}'
where stored.organization_id = 'c5000000-0000-4000-8000-000000000010'
  and stored.user_id = 'c5000000-0000-4000-8000-000000000002';
set local role service_role;
select public.set_organization_user_preference('c5000000-0000-4000-8000-000000000010',
  'c5000000-0000-4000-8000-000000000002', '{auftraege,visibleColumns}', '["nr"]');
reset role;
do $$
begin
  if pg_temp.preferences_of('c5000000-0000-4000-8000-000000000002') -> 'auftraege'
    <> '{"visibleColumns":["nr"]}'::jsonb
  then
    raise exception 'a damaged parent key was not replaced by an object';
  end if;
end;
$$;

-- Every refusal keeps its code and changes nothing.
create temporary table preference_state_before_refusals on commit drop as
  select organization_id, user_id, preferences from public.organization_user_preferences
  where organization_id in ('c5000000-0000-4000-8000-000000000010', 'c5000000-0000-4000-8000-000000000011');

set local role service_role;
select pg_temp.expect_refusal('an empty path', $sql$
  select public.set_organization_user_preference('c5000000-0000-4000-8000-000000000010',
    'c5000000-0000-4000-8000-000000000002', '{}', '1')
$sql$, 'invalid_input');
select pg_temp.expect_refusal('a path of three keys', $sql$
  select public.set_organization_user_preference('c5000000-0000-4000-8000-000000000010',
    'c5000000-0000-4000-8000-000000000002', '{a,b,c}', '1')
$sql$, 'invalid_input');
select pg_temp.expect_refusal('a key that is no identifier', $sql$
  select public.set_organization_user_preference('c5000000-0000-4000-8000-000000000010',
    'c5000000-0000-4000-8000-000000000002', '{"calendar view"}', '1')
$sql$, 'invalid_input');
select pg_temp.expect_refusal('a null value', $sql$
  select public.set_organization_user_preference('c5000000-0000-4000-8000-000000000010',
    'c5000000-0000-4000-8000-000000000002', '{calendar}', null)
$sql$, 'invalid_input');
select pg_temp.expect_refusal('a user of another organization', $sql$
  select public.set_organization_user_preference('c5000000-0000-4000-8000-000000000010',
    'c5000000-0000-4000-8000-000000000004', '{calendar}', '{"view":"week"}')
$sql$, 'not_a_member');
select pg_temp.expect_refusal('a member writing into an organization they do not belong to', $sql$
  select public.set_organization_user_preference('c5000000-0000-4000-8000-000000000011',
    'c5000000-0000-4000-8000-000000000002', '{calendar}', '{"view":"week"}')
$sql$, 'not_a_member');
reset role;

-- A signed-in client cannot call the function, and its own table policies keep
-- it out of a colleague's row.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'c5000000-0000-4000-8000-000000000003', true);
select pg_temp.expect_refusal('a direct client call', $sql$
  select public.set_organization_user_preference('c5000000-0000-4000-8000-000000000010',
    'c5000000-0000-4000-8000-000000000002', '{calendar}', '{"view":"week"}')
$sql$, 'permission denied for function set_organization_user_preference');
update public.organization_user_preferences stored
set preferences = '{"calendar":{"view":"week"}}'
where stored.organization_id = 'c5000000-0000-4000-8000-000000000010'
  and stored.user_id = 'c5000000-0000-4000-8000-000000000002';
reset role;

do $$
begin
  if exists (
    (select organization_id, user_id, preferences from public.organization_user_preferences
     where organization_id in ('c5000000-0000-4000-8000-000000000010', 'c5000000-0000-4000-8000-000000000011')
     except select * from preference_state_before_refusals)
    union all
    (select * from preference_state_before_refusals
     except select organization_id, user_id, preferences from public.organization_user_preferences
     where organization_id in ('c5000000-0000-4000-8000-000000000010', 'c5000000-0000-4000-8000-000000000011'))
  ) then
    raise exception 'a refused preference write changed a stored preference';
  end if;
end;
$$;

do $$
declare
  v_role text;
begin
  if not has_function_privilege('service_role',
    'public.set_organization_user_preference(uuid, uuid, text[], jsonb)', 'execute') then
    raise exception 'set_organization_user_preference lost its service_role grant';
  end if;
  foreach v_role in array array['anon', 'authenticated'] loop
    if has_function_privilege(v_role, 'public.set_organization_user_preference(uuid, uuid, text[], jsonb)', 'execute')
    then
      raise exception '% can execute set_organization_user_preference', v_role;
    end if;
  end loop;
  if (select prosecdef from pg_proc
      where oid = 'public.set_organization_user_preference(uuid, uuid, text[], jsonb)'::regprocedure) then
    raise exception 'set_organization_user_preference must run as security invoker';
  end if;
end;
$$;

rollback;
