-- Deleting an organization through delete_organization (migration
-- 20261029205025_refuse_organization_delete_with_time_records.sql) refuses
-- while the organization holds a time entry, a time session or a closed
-- period, or a document whose retention end is today or later
-- (werk-flow/werkflow-planning#283), filed or not, also in the trash. It
-- refuses everyone but the owner and a wrong confirmation name, and
-- removes the organization with its rows otherwise, also when a selected
-- responsibility group has one holder left. Only the service role executes
-- the function and the scope read.
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
('27900000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'org-delete-owner@example.test', '', now(), '{}',
 '{"first_name":"Owner","last_name":"Delete"}', now(), now()),
('27900000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'org-delete-employee@example.test', '', now(), '{}',
 '{"first_name":"Employee","last_name":"Delete"}', now(), now());

-- 10 has no time, 11 a time entry, 12 a time session, 13 only a closed period,
-- 14 a selected responsibility group with one holder, 16 an unfiled invoice in
-- the trash inside its period, 17 a filed invoice whose period ended.
insert into public.organizations (id, name, admin_id, unique_code) values
('27900000-0000-0000-0000-000000000014', 'Mit Zuständigkeit', '27900000-0000-0000-0000-000000000001', 'ODEL14'),
('27900000-0000-0000-0000-000000000010', 'Ohne Zeiten', '27900000-0000-0000-0000-000000000001', 'ODEL10'),
('27900000-0000-0000-0000-000000000011', 'Mit Zeiteintrag', '27900000-0000-0000-0000-000000000001', 'ODEL11'),
('27900000-0000-0000-0000-000000000012', 'Mit Sitzung', '27900000-0000-0000-0000-000000000001', 'ODEL12'),
('27900000-0000-0000-0000-000000000013', 'Mit Periode', '27900000-0000-0000-0000-000000000001', 'ODEL13'),
('27900000-0000-0000-0000-000000000016', 'Mit Rechnung', '27900000-0000-0000-0000-000000000001', 'ODEL16'),
('27900000-0000-0000-0000-000000000017', 'Mit alter Rechnung', '27900000-0000-0000-0000-000000000001', 'ODEL17');
insert into public.documents (
  id, organization_id, storage_path, original_file_name, display_name, category, size_bytes, uploaded_by,
  document_date, retention_class, filed_at, filed_by, deleted_at, deleted_by
) values
('27900000-0000-0000-0000-000000000040', '27900000-0000-0000-0000-000000000016',
 '27900000-0000-0000-0000-000000000016/d40/rechnung.pdf', 'rechnung.pdf', 'rechnung.pdf', 'invoice', 10,
 '27900000-0000-0000-0000-000000000001', (now() at time zone 'Europe/Berlin')::date, 'ten_years', null, null,
 now(), '27900000-0000-0000-0000-000000000001'),
('27900000-0000-0000-0000-000000000041', '27900000-0000-0000-0000-000000000017',
 '27900000-0000-0000-0000-000000000017/d41/rechnung.pdf', 'rechnung.pdf', 'rechnung.pdf', 'invoice', 10,
 '27900000-0000-0000-0000-000000000001', '2010-03-01', 'ten_years', now(),
 '27900000-0000-0000-0000-000000000001', null, null);
insert into public.organization_members (organization_id, user_id, role) values
('27900000-0000-0000-0000-000000000010', '27900000-0000-0000-0000-000000000002', 'employee'),
('27900000-0000-0000-0000-000000000012', '27900000-0000-0000-0000-000000000002', 'employee'),
('27900000-0000-0000-0000-000000000014', '27900000-0000-0000-0000-000000000002', 'employee');
insert into public.clients (organization_id, name) values
('27900000-0000-0000-0000-000000000010', 'Kundin Löschtest');

insert into public.time_entries (user_id, organization_id, entry_type, timestamp, is_manual, status) values
('27900000-0000-0000-0000-000000000001', '27900000-0000-0000-0000-000000000011',
 'clock_in', '2026-06-15 08:00+02', true, 'rejected');

do $$
declare
  v_previous_capture_write text := coalesce(current_setting('app.time_capture_write', true), '');
begin
  perform set_config('app.time_capture_write', 'true', true);
  insert into public.time_sessions (
    organization_id, employee_record_id, user_id, status, started_at, ended_at, created_by, ended_by
  ) select organization_id, id, user_id, 'closed', '2026-06-16 08:00+02', '2026-06-16 12:00+02', user_id, user_id
  from public.employee_records
  where organization_id = '27900000-0000-0000-0000-000000000012'
    and user_id = '27900000-0000-0000-0000-000000000002';
  if not found then raise exception 'employee record prerequisite missing'; end if;
  perform set_config('app.time_capture_write', v_previous_capture_write, true);
end;
$$;

do $$
declare
  v_holder_record_id uuid;
  v_current_configuration_id uuid;
begin
  select employee.id into v_holder_record_id from public.employee_records employee
  where employee.organization_id = '27900000-0000-0000-0000-000000000014'
    and employee.user_id = '27900000-0000-0000-0000-000000000002';
  select configuration.id into v_current_configuration_id
  from public.organization_responsibility_configurations configuration
  where configuration.organization_id = '27900000-0000-0000-0000-000000000014'
    and configuration.responsibility = 'time_approval'
  order by configuration.effective_from desc, configuration.created_at desc, configuration.id desc
  limit 1;
  perform public.apply_responsibility_configuration(
    '27900000-0000-0000-0000-000000000014', 'time_approval', 'selected', array[v_holder_record_id],
    '27900000-0000-0000-0000-000000000001', v_current_configuration_id);
end;
$$;

-- A reopened period keeps its close version; the seed writes only that
-- version and its period, so it bypasses the period workflow's triggers.
set local session_replication_role = replica;
insert into public.time_periods (id, organization_id, period_start_date, period_end_date, prepared_by, state)
values ('27900000-0000-0000-0000-000000000030', '27900000-0000-0000-0000-000000000013',
  '2026-06-01', '2026-06-30', '27900000-0000-0000-0000-000000000001', 'reopened');
insert into public.time_period_close_versions (
  organization_id, period_id, calculation_id, closed_by, version, source_fingerprint,
  opening_balance_total_minutes, period_delta_total_minutes, closing_balance_total_minutes
) values ('27900000-0000-0000-0000-000000000013', '27900000-0000-0000-0000-000000000030',
  '27900000-0000-0000-0000-000000000031', '27900000-0000-0000-0000-000000000001', 1, repeat('a', 64), 0, 0, 0);
set local session_replication_role = origin;

create function pg_temp.expect_delete_refusal(
  p_label text, p_organization_id uuid, p_actor_id uuid, p_name text, p_refusal text
) returns void
language plpgsql as $$
begin
  begin
    perform public.delete_organization(p_organization_id, p_actor_id, p_name);
  exception when others then
    if sqlerrm is distinct from p_refusal then
      raise exception '% refused with % instead of %', p_label, sqlerrm, p_refusal;
    end if;
    if p_refusal is distinct from 'org_not_found'
      and not exists (select 1 from public.organizations where id = p_organization_id)
    then raise exception '% removed the organization', p_label; end if;
    return;
  end;
  raise exception '% deleted the organization', p_label;
end;
$$;
grant execute on function pg_temp.expect_delete_refusal(text, uuid, uuid, text, text) to service_role;

do $$
begin
  if has_function_privilege('anon', 'public.delete_organization(uuid, uuid, text)', 'execute')
    or has_function_privilege('authenticated', 'public.delete_organization(uuid, uuid, text)', 'execute')
    or has_function_privilege('anon', 'public.get_organization_deletion_scope(uuid)', 'execute')
    or has_function_privilege('authenticated', 'public.get_organization_deletion_scope(uuid)', 'execute')
    or not has_function_privilege('service_role', 'public.delete_organization(uuid, uuid, text)', 'execute')
    or not has_function_privilege('service_role', 'public.get_organization_deletion_scope(uuid)', 'execute')
  then raise exception 'organization deletion functions are executable beyond the service role'; end if;
end;
$$;

set local role service_role;

do $$
declare
  v_scope jsonb;
begin
  v_scope := public.get_organization_deletion_scope('27900000-0000-0000-0000-000000000010');
  if v_scope->>'members' is distinct from '2' or v_scope->>'clients' is distinct from '1' or v_scope->>'employee_records' is distinct from '2'
    or v_scope->>'time_tracked_people' is distinct from '0' or v_scope->>'closed_periods' is distinct from '0'
  then raise exception 'deletion scope miscounts an organization without time: %', v_scope; end if;
  v_scope := public.get_organization_deletion_scope('27900000-0000-0000-0000-000000000011');
  if v_scope->>'time_tracked_people' is distinct from '1' then
    raise exception 'deletion scope misses a rejected time entry: %', v_scope;
  end if;
  v_scope := public.get_organization_deletion_scope('27900000-0000-0000-0000-000000000013');
  if v_scope->>'closed_periods' is distinct from '1' then
    raise exception 'deletion scope misses a reopened closed period: %', v_scope;
  end if;
  v_scope := public.get_organization_deletion_scope('27900000-0000-0000-0000-000000000016');
  if v_scope->>'retained_documents' is distinct from '1' then
    raise exception 'deletion scope misses a trashed document inside its period: %', v_scope;
  end if;
  v_scope := public.get_organization_deletion_scope('27900000-0000-0000-0000-000000000017');
  if v_scope->>'retained_documents' is distinct from '0' or v_scope->>'documents' is distinct from '1' then
    raise exception 'deletion scope retains a document whose period ended: %', v_scope;
  end if;
end;
$$;

select pg_temp.expect_delete_refusal('a time entry', '27900000-0000-0000-0000-000000000011',
  '27900000-0000-0000-0000-000000000001', 'Mit Zeiteintrag', 'has_time_records');
select pg_temp.expect_delete_refusal('a time session', '27900000-0000-0000-0000-000000000012',
  '27900000-0000-0000-0000-000000000001', 'Mit Sitzung', 'has_time_records');
select pg_temp.expect_delete_refusal('a closed period', '27900000-0000-0000-0000-000000000013',
  '27900000-0000-0000-0000-000000000001', 'Mit Periode', 'has_time_records');
select pg_temp.expect_delete_refusal('a document inside its period', '27900000-0000-0000-0000-000000000016',
  '27900000-0000-0000-0000-000000000001', 'Mit Rechnung', 'has_retained_documents');
select pg_temp.expect_delete_refusal('a member who is not the owner', '27900000-0000-0000-0000-000000000010',
  '27900000-0000-0000-0000-000000000002', 'Ohne Zeiten', 'not_authorized');
select pg_temp.expect_delete_refusal('a wrong confirmation name', '27900000-0000-0000-0000-000000000010',
  '27900000-0000-0000-0000-000000000001', 'Ohne Zeit', 'name_mismatch');
select pg_temp.expect_delete_refusal('a missing organization', '27900000-0000-0000-0000-0000000000ff',
  '27900000-0000-0000-0000-000000000001', 'Ohne Zeiten', 'org_not_found');

do $$
begin
  if not exists (select 1 from public.time_entries where organization_id = '27900000-0000-0000-0000-000000000011')
    or not exists (select 1 from public.time_sessions where organization_id = '27900000-0000-0000-0000-000000000012')
    or not exists (
      select 1 from public.time_period_close_versions where organization_id = '27900000-0000-0000-0000-000000000013'
    )
    or not exists (select 1 from public.documents where id = '27900000-0000-0000-0000-000000000040')
  then raise exception 'a refused organization deletion removed time records or a retained document'; end if;

  -- A filed document whose period ended goes with its organization.
  perform public.delete_organization(
    '27900000-0000-0000-0000-000000000017', '27900000-0000-0000-0000-000000000001', 'Mit alter Rechnung');
  if exists (select 1 from public.documents where organization_id = '27900000-0000-0000-0000-000000000017')
  then raise exception 'the deletion of an organization left its filed document whose period ended'; end if;

  perform public.delete_organization(
    '27900000-0000-0000-0000-000000000010', '27900000-0000-0000-0000-000000000001', '  Ohne Zeiten ');
  if exists (select 1 from public.organizations where id = '27900000-0000-0000-0000-000000000010')
    or exists (select 1 from public.organization_members where organization_id = '27900000-0000-0000-0000-000000000010')
    or exists (select 1 from public.clients where organization_id = '27900000-0000-0000-0000-000000000010')
  then raise exception 'the owner''s deletion of an organization without time left rows'; end if;

  -- Its members go with the organization, so the last holder of a selected
  -- group goes too; a live organization still refuses that removal
  -- (people_boundaries.sql).
  perform public.delete_organization(
    '27900000-0000-0000-0000-000000000014', '27900000-0000-0000-0000-000000000001', 'Mit Zuständigkeit');
  if exists (select 1 from public.organizations where id = '27900000-0000-0000-0000-000000000014')
    or exists (select 1 from public.organization_members where organization_id = '27900000-0000-0000-0000-000000000014')
    or exists (
      select 1 from public.organization_responsibility_configurations
      where organization_id = '27900000-0000-0000-0000-000000000014'
    )
  then raise exception 'the owner''s deletion of an organization with a selected responsibility group left rows'; end if;
end;
$$;

reset role;
rollback;
