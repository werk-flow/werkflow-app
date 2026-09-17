-- Security boundary assertions (docs/plans/phase-1/hardening-2026-09/05-step-1-security-infrastructure.md).
-- Runs inside one transaction against the local stack and rolls back.
-- Each block raises on violation; ON_ERROR_STOP turns that into a failed group.
begin;

-- SI-008 / SI-022: no SECURITY DEFINER function in the exposed schema may be
-- executable by anon or authenticated, and the service-role lookups stay closed.
do $$
declare
  offender text;
begin
  select string_agg(p.proname, ', ' order by p.proname) into offender
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prosecdef
    and (
      has_function_privilege('anon', p.oid, 'execute')
      or has_function_privilege('authenticated', p.oid, 'execute')
    );
  if offender is not null then
    raise exception 'security definer functions executable by client roles: %', offender;
  end if;

  foreach offender in array array[
    'public.check_user_exists_by_email(text)',
    'app_private.check_user_exists_by_email(text)',
    'public.get_invite_by_code(text)',
    'app_private.get_invite_by_code(text)',
    'public.set_job_assignment_organization()',
    'public.guard_automatic_time_entry_timestamps()',
    'public.update_updated_at_column()'
  ] loop
    if has_function_privilege('anon', offender, 'execute')
      or has_function_privilege('authenticated', offender, 'execute') then
      raise exception '% is executable by a client role', offender;
    end if;
  end loop;

  -- The RLS helper functions must stay callable by signed-in users, otherwise
  -- every organization policy would fail closed for legitimate members.
  if not has_function_privilege('authenticated', 'app_private.get_user_org_ids(uuid)', 'execute') then
    raise exception 'get_user_org_ids lost its authenticated grant';
  end if;
end;
$$;

-- SI-008: the committed body of fulfill_instruction_evidence carries the
-- requirement-not-found guard twice (requirement lookup and item lookup).
do $$
declare
  guard_count integer;
begin
  select regexp_count(pg_get_functiondef('public.fulfill_instruction_evidence'::regproc), 'instruction_evidence_requirement_not_found')
    into guard_count;
  if guard_count <> 2 then
    raise exception 'fulfill_instruction_evidence body drifted: % guard occurrences', guard_count;
  end if;
end;
$$;

-- SI-011: inventory ledgers are append-only for signed-in managers.
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
('51000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'si-011-admin@example.test', '', now(), '{}',
 '{"first_name":"Admin","last_name":"SI011"}', now(), now()),
('51000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'si-006-employee@example.test', '', now(), '{}',
 '{"first_name":"Employee","last_name":"SI006"}', now(), now());

set local role service_role;

insert into public.organizations (id, name, admin_id, unique_code) values
('51000000-0000-0000-0000-000000000010', 'SI-011 SQL',
 '51000000-0000-0000-0000-000000000001', 'SI011SQL');

insert into public.inventory_items (id, organization_id, name) values
('51000000-0000-0000-0000-000000000020', '51000000-0000-0000-0000-000000000010', 'Rohr');
insert into public.inventory_locations (id, organization_id, name) values
('51000000-0000-0000-0000-000000000030', '51000000-0000-0000-0000-000000000010', 'Lager');
insert into public.inventory_movements (
  id, organization_id, item_id, location_id, movement_type,
  quantity_before, quantity_delta, quantity_after
) values (
  '51000000-0000-0000-0000-000000000040', '51000000-0000-0000-0000-000000000010',
  '51000000-0000-0000-0000-000000000020', '51000000-0000-0000-0000-000000000030',
  'stock_in', 0, 5, 5
);
insert into public.inventory_audit_events (id, organization_id, event_type) values
('51000000-0000-0000-0000-000000000050', '51000000-0000-0000-0000-000000000010', 'stock_adjusted');

-- The organization admin (an inventory manager under the policy) cannot rewrite the ledger.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"51000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

do $$
begin
  begin
    update public.inventory_movements set quantity_delta = 99
    where id = '51000000-0000-0000-0000-000000000040';
    raise exception 'inventory movement update was accepted';
  exception when insufficient_privilege or raise_exception then
    if sqlerrm = 'inventory movement update was accepted' then raise; end if;
  end;
  begin
    delete from public.inventory_movements where id = '51000000-0000-0000-0000-000000000040';
    raise exception 'inventory movement delete was accepted';
  exception when insufficient_privilege or raise_exception then
    if sqlerrm = 'inventory movement delete was accepted' then raise; end if;
  end;
  begin
    delete from public.inventory_audit_events where id = '51000000-0000-0000-0000-000000000050';
    raise exception 'inventory audit event delete was accepted';
  exception when insufficient_privilege or raise_exception then
    if sqlerrm = 'inventory audit event delete was accepted' then raise; end if;
  end;
end;
$$;

-- The service role is bound by the same trigger outside an organization cascade.
set local role service_role;
do $$
begin
  begin
    update public.inventory_movements set quantity_delta = 99
    where id = '51000000-0000-0000-0000-000000000040';
    raise exception 'service-role ledger update was accepted';
  exception when raise_exception then
    if sqlerrm = 'service-role ledger update was accepted' then raise; end if;
  end;
end;
$$;

-- Fixture rows still exist unchanged.
do $$
declare
  delta numeric;
begin
  select quantity_delta into delta from public.inventory_movements
  where id = '51000000-0000-0000-0000-000000000040';
  if delta <> 5 then raise exception 'ledger row changed despite denial'; end if;
end;
$$;

-- SI-006: a member with recorded time cannot be removed; the membership and the
-- history stay in place (containment until P1-33).
insert into public.organization_members (organization_id, user_id, role) values
('51000000-0000-0000-0000-000000000010', '51000000-0000-0000-0000-000000000002', 'employee');
-- The same member can be removed before recording time. Rejoin before the denial case.
do $$
begin
  if public.remove_member_with_time_capture(
    '51000000-0000-0000-0000-000000000010',
    '51000000-0000-0000-0000-000000000002',
    '51000000-0000-0000-0000-000000000001',
    gen_random_uuid()
  ) is distinct from false then raise exception 'unused member removal reported a clock-out'; end if;
  if exists (select 1 from public.organization_members
    where organization_id = '51000000-0000-0000-0000-000000000010'
      and user_id = '51000000-0000-0000-0000-000000000002'
  ) then raise exception 'unused member was not removed'; end if;
end;
$$;
insert into public.organization_members (organization_id, user_id, role) values
('51000000-0000-0000-0000-000000000010', '51000000-0000-0000-0000-000000000002', 'employee');
insert into public.time_entries (organization_id, user_id, entry_type, timestamp) values
('51000000-0000-0000-0000-000000000010', '51000000-0000-0000-0000-000000000002', 'clock_in', now());

do $$
begin
  begin
    perform public.remove_member_with_time_capture(
      '51000000-0000-0000-0000-000000000010',
      '51000000-0000-0000-0000-000000000002',
      '51000000-0000-0000-0000-000000000001',
      gen_random_uuid()
    );
    raise exception 'member with time history was removed';
  exception when raise_exception then
    if sqlerrm <> 'time_member_removal_has_history' then raise; end if;
  end;
  if not exists (
    select 1 from public.organization_members
    where organization_id = '51000000-0000-0000-0000-000000000010'
      and user_id = '51000000-0000-0000-0000-000000000002'
  ) then raise exception 'membership vanished despite the denial'; end if;
  if not exists (
    select 1 from public.time_entries
    where organization_id = '51000000-0000-0000-0000-000000000010'
      and user_id = '51000000-0000-0000-0000-000000000002'
  ) then raise exception 'time history vanished despite the denial'; end if;
end;
$$;

-- Deleting the organization cascades through the ledger (legitimate teardown).
reset role;
delete from public.organizations where id = '51000000-0000-0000-0000-000000000010';
do $$
begin
  if exists (select 1 from public.inventory_movements where organization_id = '51000000-0000-0000-0000-000000000010') then
    raise exception 'organization cascade left ledger rows';
  end if;
end;
$$;

rollback;
