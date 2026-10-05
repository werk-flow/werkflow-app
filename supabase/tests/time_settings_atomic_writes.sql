-- Saving the break rule writes the settings and ends the open breaks in one
-- transaction (migration 20261004154000_apply_time_tracking_settings_atomically.sql):
-- a refused break end leaves the settings unchanged, a stale snapshot, a
-- foreign organization and a non-admin are refused, and only the service role
-- executes the function.
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
('26104154-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'time-settings-admin@example.test', '', now(), '{}',
 '{"first_name":"Admin","last_name":"Settings"}', now(), now()),
('26104154-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'time-settings-employee@example.test', '', now(), '{}',
 '{"first_name":"Employee","last_name":"Settings"}', now(), now()),
('26104154-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'time-settings-foreign@example.test', '', now(), '{}',
 '{"first_name":"Foreign","last_name":"Settings"}', now(), now());

insert into public.organizations (id, name, admin_id, unique_code) values
('26104154-0000-0000-0000-000000000010', 'Time settings SQL',
  '26104154-0000-0000-0000-000000000001', 'TSETSQL1'),
('26104154-0000-0000-0000-000000000011', 'Foreign time settings SQL',
  '26104154-0000-0000-0000-000000000003', 'TSETSQL2');
insert into public.organization_members (organization_id, user_id, role) values
('26104154-0000-0000-0000-000000000010', '26104154-0000-0000-0000-000000000002', 'employee');
-- A job of the other organization: the work-start trigger refuses a break end on it.
insert into public.jobs (id, organization_id, title, job_number, created_by) values
('26104154-0000-0000-0000-0000000000aa', '26104154-0000-0000-0000-000000000011', 'Foreign job',
  'TSET-FOREIGN', '26104154-0000-0000-0000-000000000003');
insert into public.organization_settings (organization_id, break_policy_history) values
('26104154-0000-0000-0000-000000000010',
  '[{"breakMode":"manual","autoBreakThresholdMinutes":360,"autoBreakDurationMinutes":30,"effectiveFrom":"2026-01-01T00:00:00.000Z"}]');

-- The snapshot the action reads, and the history it writes with the change.
create view pg_temp.settings_call as
select
  '{"break_mode":"manual","auto_break_threshold_minutes":360,"auto_break_duration_minutes":30,"break_policy_history":[{"breakMode":"manual","autoBreakThresholdMinutes":360,"autoBreakDurationMinutes":30,"effectiveFrom":"2026-01-01T00:00:00.000Z"}]}'::jsonb expected,
  '[{"breakMode":"manual","autoBreakThresholdMinutes":360,"autoBreakDurationMinutes":30,"effectiveFrom":"2026-01-01T00:00:00.000Z"},{"breakMode":"automatic","autoBreakThresholdMinutes":360,"autoBreakDurationMinutes":45,"effectiveFrom":"2026-10-04T08:00:00.000Z"}]'::jsonb history;
grant select on pg_temp.settings_call to service_role;

-- Runs one call and requires the named refusal.
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
grant execute on function pg_temp.expect_refusal(text, text, text) to service_role;

set local role service_role;

select pg_temp.expect_refusal('a member who is not the admin', $sql$
  select public.update_time_tracking_settings('26104154-0000-0000-0000-000000000002',
    '26104154-0000-0000-0000-000000000010', (select expected from pg_temp.settings_call),
    'automatic', 360, 45, (select history from pg_temp.settings_call), '[]')
$sql$, 'not_authorized');
select pg_temp.expect_refusal('the admin of another organization', $sql$
  select public.update_time_tracking_settings('26104154-0000-0000-0000-000000000003',
    '26104154-0000-0000-0000-000000000010', (select expected from pg_temp.settings_call),
    'automatic', 360, 45, (select history from pg_temp.settings_call), '[]')
$sql$, 'not_authorized');
select pg_temp.expect_refusal('an unknown organization', $sql$
  select public.update_time_tracking_settings('26104154-0000-0000-0000-000000000001',
    '26104154-0000-0000-0000-0000000000ff', (select expected from pg_temp.settings_call),
    'automatic', 360, 45, (select history from pg_temp.settings_call), '[]')
$sql$, 'org_not_found');
select pg_temp.expect_refusal('an unknown break mode', $sql$
  select public.update_time_tracking_settings('26104154-0000-0000-0000-000000000001',
    '26104154-0000-0000-0000-000000000010', (select expected from pg_temp.settings_call),
    'sometimes', 360, 45, (select history from pg_temp.settings_call), '[]')
$sql$, 'invalid_input');
select pg_temp.expect_refusal('a repeated break end', $sql$
  select public.update_time_tracking_settings('26104154-0000-0000-0000-000000000001',
    '26104154-0000-0000-0000-000000000010', (select expected from pg_temp.settings_call),
    'automatic', 360, 45, (select history from pg_temp.settings_call),
    '[{"user_id":"26104154-0000-0000-0000-000000000002","job_id":null},
      {"user_id":"26104154-0000-0000-0000-000000000002","job_id":null}]')
$sql$, 'invalid_input');
-- A concurrent save changed the row after the action read it.
select pg_temp.expect_refusal('a stale snapshot', $sql$
  select public.update_time_tracking_settings('26104154-0000-0000-0000-000000000001',
    '26104154-0000-0000-0000-000000000010',
    jsonb_set((select expected from pg_temp.settings_call), '{break_policy_history}', '[]'),
    'automatic', 360, 45, (select history from pg_temp.settings_call), '[]')
$sql$, 'settings_changed');
select pg_temp.expect_refusal('a snapshot without a row for a stored row', $sql$
  select public.update_time_tracking_settings('26104154-0000-0000-0000-000000000001',
    '26104154-0000-0000-0000-000000000010', null,
    'automatic', 360, 45, (select history from pg_temp.settings_call), '[]')
$sql$, 'settings_changed');
-- The later step refuses after the settings were written: a break end for a
-- person of another organization, and one on a job of another organization.
select pg_temp.expect_refusal('a break end for a foreign person last', $sql$
  select public.update_time_tracking_settings('26104154-0000-0000-0000-000000000001',
    '26104154-0000-0000-0000-000000000010', (select expected from pg_temp.settings_call),
    'automatic', 360, 45, (select history from pg_temp.settings_call),
    '[{"user_id":"26104154-0000-0000-0000-000000000002","job_id":null},
      {"user_id":"26104154-0000-0000-0000-000000000003","job_id":null}]')
$sql$, 'target_not_found');
select pg_temp.expect_refusal('a break end the work-start trigger refuses', $sql$
  select public.update_time_tracking_settings('26104154-0000-0000-0000-000000000001',
    '26104154-0000-0000-0000-000000000010', (select expected from pg_temp.settings_call),
    'automatic', 360, 45, (select history from pg_temp.settings_call),
    '[{"user_id":"26104154-0000-0000-0000-000000000002","job_id":"26104154-0000-0000-0000-0000000000aa"}]')
$sql$, 'work_time_start_job_not_found');

do $$
begin
  if (select break_mode::text || auto_break_duration_minutes || jsonb_array_length(break_policy_history)
      from public.organization_settings
      where organization_id = '26104154-0000-0000-0000-000000000010') <> 'manual301'
  then raise exception 'a refused save changed the settings'; end if;
  if exists (
    select 1 from public.time_entries where organization_id = '26104154-0000-0000-0000-000000000010'
  ) then raise exception 'a refused save ended a break'; end if;

  perform public.update_time_tracking_settings('26104154-0000-0000-0000-000000000001',
    '26104154-0000-0000-0000-000000000010', (select expected from pg_temp.settings_call),
    'automatic', 360, 45, (select history from pg_temp.settings_call),
    '[{"user_id":"26104154-0000-0000-0000-000000000002","job_id":null}]');
  if (select break_mode::text || auto_break_duration_minutes || jsonb_array_length(break_policy_history)
      from public.organization_settings
      where organization_id = '26104154-0000-0000-0000-000000000010') <> 'automatic452'
  then raise exception 'a clean save did not write the settings and the history'; end if;
  if (select count(*) from public.time_entries
      where organization_id = '26104154-0000-0000-0000-000000000010'
        and user_id = '26104154-0000-0000-0000-000000000002'
        and entry_type = 'break_end' and status = 'approved' and not is_manual and job_id is null
        and timestamp = now()) <> 1
  then raise exception 'a clean save did not end the open break'; end if;

  -- The first save of an organization without a settings row creates it; a
  -- second save from the same empty snapshot refuses instead of overwriting.
  perform public.update_time_tracking_settings('26104154-0000-0000-0000-000000000003',
    '26104154-0000-0000-0000-000000000011', null,
    'automatic', 480, 30, '[{"breakMode":"automatic","autoBreakThresholdMinutes":480,"autoBreakDurationMinutes":30,"effectiveFrom":"2026-10-04T08:00:00.000Z"}]', '[]');
  if (select auto_break_threshold_minutes from public.organization_settings
      where organization_id = '26104154-0000-0000-0000-000000000011') <> 480
  then raise exception 'a first save did not create the settings row'; end if;
end;
$$;

select pg_temp.expect_refusal('a second first save', $sql$
  select public.update_time_tracking_settings('26104154-0000-0000-0000-000000000003',
    '26104154-0000-0000-0000-000000000011', null,
    'manual', 360, 30, '[]', '[]')
$sql$, 'settings_changed');

reset role;

do $$
declare
  v_function constant text :=
    'public.update_time_tracking_settings(uuid, uuid, jsonb, text, integer, integer, jsonb, jsonb)';
  v_role text;
begin
  if not has_function_privilege('service_role', v_function, 'execute') then
    raise exception '% lost its service_role grant', v_function;
  end if;
  foreach v_role in array array['anon', 'authenticated'] loop
    if has_function_privilege(v_role, v_function, 'execute') then
      raise exception '% is executable by %', v_function, v_role;
    end if;
  end loop;
end;
$$;

rollback;
