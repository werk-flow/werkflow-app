begin;

-- A1-30: an applied time correction never rewrites the recorded raw entries;
-- the correction lives in its revision and application.

create function pg_temp.timeline_fence() returns jsonb language sql as $$
  select jsonb_build_object('timelineRevision', coalesce((select revision from public.time_timeline_revisions
    where organization_id = 'a1000000-0000-0000-0000-000000000010'), 0));
$$;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
(
  'a1000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'a1-history-admin@example.test', '', now(),
  '{}'::jsonb, '{"first_name":"Admin","last_name":"A1History"}'::jsonb, now(), now()
),
(
  'a1000000-0000-0000-0000-000000000003',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'a1-history-employee@example.test', '', now(),
  '{}'::jsonb, '{"first_name":"Employee","last_name":"A1History"}'::jsonb, now(), now()
);

insert into public.organizations (id, name, admin_id, unique_code)
values (
  'a1000000-0000-0000-0000-000000000010', 'A1 History SQL',
  'a1000000-0000-0000-0000-000000000001', 'A1HISTSQL'
);
insert into public.organization_members (organization_id, user_id, role)
values ('a1000000-0000-0000-0000-000000000010', 'a1000000-0000-0000-0000-000000000003', 'employee');

insert into public.time_entries (
  id, user_id, organization_id, entry_type, timestamp, is_manual, status
) values (
  'a1000000-0000-0000-0000-000000000020',
  'a1000000-0000-0000-0000-000000000003',
  'a1000000-0000-0000-0000-000000000010',
  'clock_in', '2026-09-01T06:00:00Z', true, 'approved'
);

set local role service_role;

do $$
declare
  v_employee_record_id uuid;
  v_source_version text;
  v_raw_before jsonb;
  v_result jsonb;
begin
  select id into v_employee_record_id from public.employee_records
  where organization_id = 'a1000000-0000-0000-0000-000000000010'
    and user_id = 'a1000000-0000-0000-0000-000000000003';
  perform set_config('TimeZone', 'UTC', true);
  select updated_at::text into v_source_version from public.time_entries
  where id = 'a1000000-0000-0000-0000-000000000020';
  perform set_config('TimeZone', 'Europe/Berlin', true);
  select to_jsonb(entry) into v_raw_before from public.time_entries entry
  where id = 'a1000000-0000-0000-0000-000000000020';

  v_result := public.create_time_correction_request(
    p_organization_id => 'a1000000-0000-0000-0000-000000000010',
    p_subject_employee_record_id => v_employee_record_id,
    p_actor_id => 'a1000000-0000-0000-0000-000000000001',
    p_operation_id => 'a1000000-0000-0000-0000-000000000030',
    p_kind => 'delete', p_reason => 'A1 Korrektur durch den Admin',
    p_source_scope_key => repeat('a', 64),
    p_source_fingerprint => repeat('b', 64),
    p_before_snapshot => '{"schemaVersion":1,"facts":[{"kind":"legacy_transition","timestamp":"2026-09-01T06:00:00Z"}]}'::jsonb,
    p_proposed_snapshot => '{"schemaVersion":1,"facts":[]}'::jsonb,
    p_sources => jsonb_build_array(jsonb_build_object(
      'kind', 'legacy_entry', 'id', 'a1000000-0000-0000-0000-000000000020',
      'version', v_source_version
    )),
    p_responsibility_snapshot => pg_temp.timeline_fence()
  );
  if not exists (
    select 1 from public.time_correction_applications where request_id = (v_result->>'requestId')::uuid
  ) then raise exception 'manager correction was not applied'; end if;
  if (
    select to_jsonb(entry) from public.time_entries entry
    where id = 'a1000000-0000-0000-0000-000000000020'
  ) is distinct from v_raw_before
  then raise exception 'applied correction rewrote the raw time entry'; end if;
end;
$$;

rollback;
