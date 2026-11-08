-- A responsibility delegation ends once (20261114090000): a second end of
-- the same window, removal or end, succeeds without a write: no second
-- revocation and no second end event. One rolled-back transaction.
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select person.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
  person.email, '', now(), '{}', jsonb_build_object('first_name', person.first_name, 'last_name', 'Ende'),
  now(), now()
from (values
  ('4f100000-0000-4000-8000-000000000001'::uuid, 'delegation-end-admin@example.test', 'Admin'),
  ('4f100000-0000-4000-8000-000000000002'::uuid, 'delegation-end-buero@example.test', 'Buero')
) as person(id, email, first_name);

insert into public.organizations (id, name, admin_id, unique_code)
values ('4f100000-0000-4000-8000-000000000010', 'Vertretung Ende',
  '4f100000-0000-4000-8000-000000000001', 'VERTENDE');
insert into public.organization_members (organization_id, user_id, role) values
  ('4f100000-0000-4000-8000-000000000010', '4f100000-0000-4000-8000-000000000002', 'buero');

create function pg_temp.record_of(p_user_id uuid) returns uuid language sql as $$
  select id from public.employee_records
  where organization_id = '4f100000-0000-4000-8000-000000000010' and user_id = p_user_id;
$$;

do $$
declare
  v_admin constant uuid := '4f100000-0000-4000-8000-000000000001';
  v_today constant date := (now() at time zone 'Europe/Berlin')::date;
  v_planned uuid;
  v_running uuid;
begin
  insert into public.organization_responsibility_delegations (
    organization_id, responsibility, delegator_employee_record_id, substitute_employee_record_id,
    valid_from, valid_until
  ) values ('4f100000-0000-4000-8000-000000000010', 'time_approval',
    pg_temp.record_of(v_admin), pg_temp.record_of('4f100000-0000-4000-8000-000000000002'),
    v_today + 3, v_today + 10)
  returning id into v_planned;
  insert into public.organization_responsibility_delegations (
    organization_id, responsibility, delegator_employee_record_id, substitute_employee_record_id,
    valid_from, valid_until
  ) values ('4f100000-0000-4000-8000-000000000010', 'leave_approval',
    pg_temp.record_of(v_admin), pg_temp.record_of('4f100000-0000-4000-8000-000000000002'),
    v_today - 2, v_today + 5)
  returning id into v_running;

  -- „Entfernen“ of a planned window, twice.
  perform public.end_responsibility_delegation(v_planned, v_today + 3, v_admin);
  perform public.end_responsibility_delegation(v_planned, v_today + 3, v_admin);

  -- „Heute beenden“ of a running window, then a removal of the same window.
  perform public.end_responsibility_delegation(v_running, v_today, v_admin);
  perform public.end_responsibility_delegation(v_running, v_today + 1, v_admin);

  if (select revoked_from from public.organization_responsibility_delegations where id = v_planned)
       is distinct from v_today + 3
    or (select revoked_from from public.organization_responsibility_delegations where id = v_running)
       is distinct from v_today
  then raise exception 'a second end changed the revocation'; end if;
  if (select count(*) from public.organization_responsibility_events
      where delegation_id in (v_planned, v_running) and event_type = 'delegation_ended') <> 2
  then raise exception 'a second end wrote an end event'; end if;
end;
$$;

rollback;
