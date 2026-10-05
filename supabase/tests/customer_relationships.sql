-- P1-01, P1-02 and P1-10: customer records, requests and relationship data are
-- readable by admin and Büro of the owning organization only. Employees and
-- other organizations read none of them.
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
('10100000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'customer-sql-admin@example.test', '', now(), '{}',
 '{"first_name":"Admin","last_name":"Kunden"}', now(), now()),
('10100000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'customer-sql-buero@example.test', '', now(), '{}',
 '{"first_name":"Büro","last_name":"Kunden"}', now(), now()),
('10100000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'customer-sql-employee@example.test', '', now(), '{}',
 '{"first_name":"Employee","last_name":"Kunden"}', now(), now()),
('10100000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'customer-sql-outsider@example.test', '', now(), '{}',
 '{"first_name":"Outsider","last_name":"Kunden"}', now(), now());

insert into public.organizations (id, name, admin_id, unique_code) values
('10100000-0000-0000-0000-000000000010', 'Customer SQL',
 '10100000-0000-0000-0000-000000000001', 'CUSTSQL'),
('10100000-0000-0000-0000-000000000011', 'Customer SQL Other',
 '10100000-0000-0000-0000-000000000004', 'CUSTSQLOTHER');

insert into public.organization_members (organization_id, user_id, role) values
('10100000-0000-0000-0000-000000000010', '10100000-0000-0000-0000-000000000002', 'buero'),
('10100000-0000-0000-0000-000000000010', '10100000-0000-0000-0000-000000000003', 'employee');

insert into public.clients (id, organization_id, name) values
('10100000-0000-0000-0000-000000000020', '10100000-0000-0000-0000-000000000010', 'SQL Kunde');
insert into public.client_contacts (id, organization_id, client_id, name, phone) values
('10100000-0000-0000-0000-000000000021', '10100000-0000-0000-0000-000000000010',
 '10100000-0000-0000-0000-000000000020', 'SQL Ansprechpartnerin', '+49 30 101');
insert into public.client_sites (id, organization_id, client_id, name, city) values
('10100000-0000-0000-0000-000000000022', '10100000-0000-0000-0000-000000000010',
 '10100000-0000-0000-0000-000000000020', 'SQL Heizraum', 'Berlin');
insert into public.client_requests (id, organization_id, client_id, summary) values
('10100000-0000-0000-0000-000000000023', '10100000-0000-0000-0000-000000000010',
 '10100000-0000-0000-0000-000000000020', 'SQL Anfrage');
insert into public.client_follow_ups (
  id, organization_id, client_id, title, owner_user_id, due_at, created_by, updated_by
) values (
  '10100000-0000-0000-0000-000000000024', '10100000-0000-0000-0000-000000000010',
  '10100000-0000-0000-0000-000000000020', 'SQL Rückruf',
  '10100000-0000-0000-0000-000000000002', '2026-09-01T08:00:00Z',
  '10100000-0000-0000-0000-000000000001', '10100000-0000-0000-0000-000000000001'
);
insert into public.client_follow_up_events (
  organization_id, client_id, follow_up_id, event_type, actor_id
) values (
  '10100000-0000-0000-0000-000000000010', '10100000-0000-0000-0000-000000000020',
  '10100000-0000-0000-0000-000000000024', 'created', '10100000-0000-0000-0000-000000000001'
);
insert into public.client_communication_settings (
  organization_id, client_id, preferred_contact_id, preferred_channel, created_by, updated_by
) values (
  '10100000-0000-0000-0000-000000000010', '10100000-0000-0000-0000-000000000020',
  '10100000-0000-0000-0000-000000000021', 'phone',
  '10100000-0000-0000-0000-000000000001', '10100000-0000-0000-0000-000000000001'
);
insert into public.client_communication_preferences (
  id, organization_id, client_id, contact_id, channel, purpose, state, created_by, updated_by
) values (
  '10100000-0000-0000-0000-000000000025', '10100000-0000-0000-0000-000000000010',
  '10100000-0000-0000-0000-000000000020', '10100000-0000-0000-0000-000000000021',
  'email', 'appointment_service', 'disallowed',
  '10100000-0000-0000-0000-000000000001', '10100000-0000-0000-0000-000000000001'
);
insert into public.client_communication_preference_events (
  organization_id, client_id, preference_id, event_type, actor_id
) values (
  '10100000-0000-0000-0000-000000000010', '10100000-0000-0000-0000-000000000020',
  '10100000-0000-0000-0000-000000000025', 'preference_created',
  '10100000-0000-0000-0000-000000000001'
);

create function pg_temp.visible_customer_counts() returns jsonb language plpgsql as $$
declare
  table_name text;
  visible_count bigint;
  result jsonb := '{}'::jsonb;
begin
  foreach table_name in array array[
    'clients',
    'client_contacts',
    'client_sites',
    'client_requests',
    'client_follow_ups',
    'client_follow_up_events',
    'client_communication_settings',
    'client_communication_preferences',
    'client_communication_preference_events'
  ] loop
    execute format('select count(*) from public.%I where organization_id = $1', table_name)
      into visible_count using '10100000-0000-0000-0000-000000000010'::uuid;
    result := result || jsonb_build_object(table_name, visible_count);
  end loop;
  return result;
end;
$$;
grant execute on function pg_temp.visible_customer_counts() to authenticated;

create temporary table customer_visibility (viewer text primary key, counts jsonb not null);
grant select, insert on customer_visibility to authenticated;

set local role authenticated;

select set_config('request.jwt.claim.sub', '10100000-0000-0000-0000-000000000001', true);
insert into customer_visibility values ('admin', pg_temp.visible_customer_counts());
select set_config('request.jwt.claim.sub', '10100000-0000-0000-0000-000000000002', true);
insert into customer_visibility values ('buero', pg_temp.visible_customer_counts());
select set_config('request.jwt.claim.sub', '10100000-0000-0000-0000-000000000003', true);
insert into customer_visibility values ('employee', pg_temp.visible_customer_counts());
select set_config('request.jwt.claim.sub', '10100000-0000-0000-0000-000000000004', true);
insert into customer_visibility values ('outsider', pg_temp.visible_customer_counts());

reset role;

do $$
declare
  admin_counts jsonb := (select counts from customer_visibility where viewer = 'admin');
  entry record;
begin
  for entry in select key, value from jsonb_each(admin_counts) loop
    if entry.value::bigint < 1 then
      raise exception 'admin cannot read own-organization % rows', entry.key;
    end if;
  end loop;
  if (select counts from customer_visibility where viewer = 'buero') <> admin_counts then
    raise exception 'Büro does not read the same customer relationship rows as admin: %',
      (select counts from customer_visibility where viewer = 'buero');
  end if;
  for entry in
    select viewer, key, value from customer_visibility, jsonb_each(counts)
    where viewer in ('employee', 'outsider')
  loop
    if entry.value::bigint <> 0 then
      raise exception '% can read % customer relationship rows of %', entry.viewer, entry.value, entry.key;
    end if;
  end loop;
end;
$$;

rollback;
