-- The company document profile (20261201130000_keep_one_company_document_profile.sql,
-- werk-flow/werkflow-planning#378). Client roles read and write neither table
-- and execute neither write: an employee, and every authenticated caller,
-- reads no profile field through the Data API. A save writes one history row
-- per changed field with actor, old and new value, in the same call, and only
-- for an Admin or Büro member of that organization. Another organization's
-- profile is neither read nor written. A replaced file queues its old object
-- for the purge. A stored file records its size, and the organization
-- export plans it with the documents' originals, so an export that leaves it
-- out is refused. The history refuses UPDATE and DELETE, also for the service
-- role, and leaves only with its organization.
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
('37800000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'profile-admin@example.test', '', now(), '{}',
 '{"first_name":"Erika","last_name":"Musterfrau"}', now(), now()),
('37800000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'profile-office@example.test', '', now(), '{}',
 '{"first_name":"Max","last_name":"Mustermann"}', now(), now()),
('37800000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'profile-worker@example.test', '', now(), '{}',
 '{"first_name":"Jonas","last_name":"Beispiel"}', now(), now()),
('37800000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'profile-other@example.test', '', now(), '{}',
 '{"first_name":"Lena","last_name":"Beispiel"}', now(), now());

insert into public.organizations (id, name, admin_id, unique_code) values
('37800000-0000-4000-8000-000000000010', 'Haustechnik Sonnenberg GmbH', '37800000-0000-4000-8000-000000000001', 'PROF10'),
('37800000-0000-4000-8000-000000000011', 'Fremde Haustechnik GmbH', '37800000-0000-4000-8000-000000000004', 'PROF11');
insert into public.organization_members (organization_id, user_id, role) values
('37800000-0000-4000-8000-000000000010', '37800000-0000-4000-8000-000000000002', 'buero'),
('37800000-0000-4000-8000-000000000010', '37800000-0000-4000-8000-000000000003', 'employee')
on conflict do nothing;

-- Grants: no client role holds a privilege on either table or executes a write.
do $$
declare
  v_table text;
  v_role text;
  v_function text;
begin
  foreach v_table in array array['company_document_profiles', 'company_document_profile_events'] loop
    if not (select relrowsecurity from pg_class where oid = ('public.' || v_table)::regclass) then
      raise exception '% has no row level security', v_table;
    end if;
    foreach v_role in array array['anon', 'authenticated'] loop
      if has_table_privilege(v_role, 'public.' || v_table, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        or has_any_column_privilege(v_role, 'public.' || v_table, 'SELECT,INSERT,UPDATE,REFERENCES')
      then
        raise exception '% holds a privilege on %', v_role, v_table;
      end if;
    end loop;
  end loop;
  foreach v_function in array array[
    'public.save_company_document_profile(uuid, uuid, integer, jsonb)',
    'public.replace_company_document_file(uuid, uuid, text, text, text, bigint)',
    'app_private.lock_company_document_profile(uuid, uuid)'
  ] loop
    foreach v_role in array array['anon', 'authenticated'] loop
      if has_function_privilege(v_role, v_function, 'EXECUTE') then
        raise exception '% may execute %', v_role, v_function;
      end if;
    end loop;
  end loop;
end;
$$;

set local role service_role;

-- A profile with every field filled, for the Büro member of organization 10.
create temporary table profile_values on commit drop as
select jsonb_build_object(
  'company_name', 'Haustechnik Sonnenberg GmbH', 'street', 'Sonnenweg 1', 'postal_code', '01234',
  'city', 'Sonnenstadt', 'phone', '0123 456789', 'email', 'info@sonnenberg.example',
  'website', 'sonnenberg.example', 'register_court', 'Amtsgericht Sonnenstadt',
  'register_number', 'HRB 00000', 'managing_directors', 'Erika Musterfrau', 'tax_number', '000/000/00000',
  'vat_id', 'DE000000000', 'bank_name', 'Musterbank', 'iban', 'DE00 0000 0000 0000 0000 00',
  'bic', 'MUSTDEXXXXX', 'offer_opening_text', 'Gerne bieten wir an:', 'offer_closing_text', 'Mit freundlichen Grüßen',
  'offer_validity_days', 30, 'standard_tax_rate_basis_points', 1900,
  'stationery_first_top_mm', 45, 'stationery_first_right_mm', 20, 'stationery_first_bottom_mm', 25,
  'stationery_first_left_mm', 25, 'stationery_following_top_mm', 30, 'stationery_following_right_mm', 20,
  'stationery_following_bottom_mm', 25, 'stationery_following_left_mm', 25
) as filled;
grant select on profile_values to service_role;

do $$
declare
  v_org constant uuid := '37800000-0000-4000-8000-000000000010';
  v_foreign constant uuid := '37800000-0000-4000-8000-000000000011';
  v_admin constant uuid := '37800000-0000-4000-8000-000000000001';
  v_office constant uuid := '37800000-0000-4000-8000-000000000002';
  v_worker constant uuid := '37800000-0000-4000-8000-000000000003';
  v_filled jsonb := (select filled from profile_values);
  v_version integer;
begin
  -- An employee and a member of another organization are refused, and nothing is written.
  begin
    perform public.save_company_document_profile(v_worker, v_org, 0, v_filled);
    raise exception 'an employee saved the profile';
  exception when raise_exception then
    if sqlerrm <> 'not_authorized' then raise; end if;
  end;
  begin
    perform public.save_company_document_profile(v_office, v_foreign, 0, v_filled);
    raise exception 'a foreign member saved another organization''s profile';
  exception when raise_exception then
    if sqlerrm <> 'not_authorized' then raise; end if;
  end;
  begin
    perform public.replace_company_document_file(v_office, v_foreign, 'logo',
      v_foreign || '/briefpapier/a/logo', 'image/png', 2048);
    raise exception 'a foreign member set another organization''s logo';
  exception when raise_exception then
    if sqlerrm <> 'not_authorized' then raise; end if;
  end;
  if exists (select 1 from public.company_document_profiles where organization_id in (v_org, v_foreign))
    or exists (select 1 from public.company_document_profile_events where organization_id in (v_org, v_foreign))
  then raise exception 'a refused save wrote a row'; end if;

  -- A key set other than the profile's fields is refused.
  begin
    perform public.save_company_document_profile(v_office, v_org, 0, v_filled - 'iban');
    raise exception 'a save without every field passed';
  exception when raise_exception then
    if sqlerrm <> 'invalid_input' then raise; end if;
  end;
  begin
    perform public.save_company_document_profile(v_office, v_org, 0, v_filled || '{"version": 9}');
    raise exception 'a save with another key passed';
  exception when raise_exception then
    if sqlerrm <> 'invalid_input' then raise; end if;
  end;

  -- The first save creates the profile and writes one history row per changed field.
  v_version := public.save_company_document_profile(v_office, v_org, 0, v_filled);
  if v_version <> 1 then raise exception 'the first save answered version %', v_version; end if;
  if (select count(*) from public.company_document_profile_events where organization_id = v_org) <> 15 + 2 then
    raise exception 'the first save wrote % history rows',
      (select count(*) from public.company_document_profile_events where organization_id = v_org);
  end if;
  if not exists (
    select 1 from public.company_document_profile_events
    where organization_id = v_org and field = 'iban' and old_value = ''
      and new_value = 'DE00 0000 0000 0000 0000 00' and actor_id = v_office
  ) then raise exception 'the IBAN change has no history row with actor, old and new value'; end if;

  -- A save from an older version, or one that changes nothing, is refused.
  begin
    perform public.save_company_document_profile(v_admin, v_org, 0, v_filled || '{"city": "Mondstadt"}');
    raise exception 'a save from an older version passed';
  exception when raise_exception then
    if sqlerrm <> 'profile_changed' then raise; end if;
  end;
  begin
    perform public.save_company_document_profile(v_admin, v_org, 1, v_filled);
    raise exception 'a save without a change passed';
  exception when raise_exception then
    if sqlerrm <> 'no_changes' then raise; end if;
  end;

  -- A value out of range is refused by the table and leaves the profile as it was.
  begin
    perform public.save_company_document_profile(v_admin, v_org, 1, v_filled || '{"offer_validity_days": 0}');
    raise exception 'a validity of 0 days passed';
  exception when check_violation then null;
  end;

  -- A change writes exactly its own history row.
  v_version := public.save_company_document_profile(v_admin, v_org, 1, v_filled || '{"offer_validity_days": 14}');
  if v_version <> 2 or (select offer_validity_days from public.company_document_profiles
    where organization_id = v_org) <> 14
  then raise exception 'the second save did not apply'; end if;
  if (select count(*) from public.company_document_profile_events
    where organization_id = v_org and actor_id = v_admin) <> 1
    or not exists (select 1 from public.company_document_profile_events where actor_id = v_admin
      and field = 'offer_validity_days' and old_value = '30' and new_value = '14')
  then raise exception 'the second save wrote the wrong history'; end if;

  -- Files: a path outside the organization's folder is refused; following pages need a first page.
  begin
    perform public.replace_company_document_file(v_office, v_org, 'logo',
      v_foreign || '/briefpapier/a/logo', 'image/png', 2048);
    raise exception 'a logo outside the organization passed';
  exception when check_violation then null;
  end;
  begin
    perform public.replace_company_document_file(v_office, v_org, 'stationery_following',
      v_org || '/briefpapier/b/stationery_following', 'application/pdf', 2048);
    raise exception 'following pages without a first page passed';
  exception when raise_exception then
    if sqlerrm <> 'stationery_first_missing' then raise; end if;
  end;

  -- A stored file names its size.
  begin
    perform public.replace_company_document_file(v_office, v_org, 'logo',
      v_org || '/briefpapier/a/logo', 'image/png', null);
    raise exception 'a logo without its size passed';
  exception when check_violation then null;
  end;

  perform public.replace_company_document_file(v_office, v_org, 'logo', v_org || '/briefpapier/a/logo', 'image/png', 2048);
  perform public.replace_company_document_file(v_office, v_org, 'logo', v_org || '/briefpapier/c/logo', 'image/jpeg', 3072);
  if not exists (
    select 1 from public.storage_purge_queue
    where storage_path = v_org || '/briefpapier/a/logo' and purge_after > now() + interval '7 days'
  ) then raise exception 'the replaced logo was not queued for the purge'; end if;
  if not exists (
    select 1 from public.company_document_profile_events where field = 'logo'
      and old_value = v_org || '/briefpapier/a/logo' and new_value = v_org || '/briefpapier/c/logo'
  ) then raise exception 'the logo change has no history row'; end if;

  -- Removing the first page's stationery removes the following pages' too.
  perform public.replace_company_document_file(v_office, v_org, 'stationery_first',
    v_org || '/briefpapier/d/stationery_first', 'application/pdf', 2048);
  perform public.replace_company_document_file(v_office, v_org, 'stationery_following',
    v_org || '/briefpapier/e/stationery_following', 'image/png', 2048);
  perform public.replace_company_document_file(v_office, v_org, 'stationery_first', null, null, null);
  if exists (select 1 from public.company_document_profiles where organization_id = v_org
    and (stationery_first_storage_path is not null or stationery_following_storage_path is not null))
  then raise exception 'the stationery was not removed'; end if;
  if (select count(*) from public.storage_purge_queue where storage_path in (
    v_org || '/briefpapier/d/stationery_first', v_org || '/briefpapier/e/stationery_following')) <> 2
  then raise exception 'the removed stationery was not queued'; end if;
  -- A file save leaves the details' version alone, so an open form still saves.
  if (select version from public.company_document_profiles where organization_id = v_org) <> 2 then
    raise exception 'a file change moved the profile version';
  end if;

  -- The organization export plans the stored files with their sizes and no
  -- document; a plan without one of them is refused, a plan with both starts.
  perform public.replace_company_document_file(v_office, v_org, 'stationery_first',
    v_org || '/briefpapier/f/stationery_first', 'application/pdf', 4096);
  if (
    select array_agg(format('%s %s %s', source_path, coalesce(document_id::text, '-'), file_bytes) order by source_path)
    from app_private.organization_export_sources(v_org)
  ) is distinct from array[
    format('%s/briefpapier/c/logo - 3072', v_org),
    format('%s/briefpapier/f/stationery_first - 4096', v_org)
  ] then
    raise exception 'the export sources are %',
      (select array_agg(source_path) from app_private.organization_export_sources(v_org));
  end if;
  begin
    perform public.start_organization_export(v_admin, v_org, jsonb_build_array(jsonb_build_array(
      jsonb_build_object('sourcePath', v_org || '/briefpapier/c/logo', 'archiveName', 'Dateien/Briefpapier/Logo.jpg')
    )));
    raise exception 'an export without the stationery started';
  exception when raise_exception then
    if sqlerrm <> 'export_plan_stale' then raise; end if;
  end;
  perform public.start_organization_export(v_admin, v_org, jsonb_build_array(jsonb_build_array(
    jsonb_build_object('sourcePath', v_org || '/briefpapier/c/logo', 'archiveName', 'Dateien/Briefpapier/Logo.jpg'),
    jsonb_build_object('sourcePath', v_org || '/briefpapier/f/stationery_first',
      'archiveName', 'Dateien/Briefpapier/Briefpapier erste Seite.pdf')
  )));
  if (select count(*) from public.organization_export_files
    where organization_id = v_org and document_id is null) <> 2
    or (select file_bytes from public.organization_exports where organization_id = v_org) <> 3072 + 4096
  then raise exception 'the export did not plan the profile files with their sizes'; end if;

  -- Another organization's profile stays untouched by all of the above.
  if exists (select 1 from public.company_document_profiles where organization_id = v_foreign) then
    raise exception 'another organization got a profile';
  end if;
end;
$$;

-- The history refuses UPDATE and DELETE: the service role holds no grant for
-- either, and the guard refuses them even for the table's owner.
do $$
begin
  if has_table_privilege('service_role', 'public.company_document_profile_events', 'UPDATE,DELETE') then
    raise exception 'the service role may rewrite the history';
  end if;
end;
$$;
reset role;
do $$
begin
  begin
    update public.company_document_profile_events set new_value = 'x';
    raise exception 'the history was rewritten';
  exception when raise_exception then
    if sqlerrm <> 'event_ledger_history_immutable' then raise; end if;
  end;
  begin
    delete from public.company_document_profile_events;
    raise exception 'the history was deleted';
  exception when raise_exception then
    if sqlerrm <> 'event_ledger_history_immutable' then raise; end if;
  end;
end;
$$;

-- An employee and an Admin of the organization read no row through the Data API.
reset role;
create function pg_temp.read_as(p_user uuid) returns integer language plpgsql as $$
declare v_count integer;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    select count(*) into v_count from public.company_document_profiles;
    raise exception 'authenticated read % profile rows', v_count;
  exception when insufficient_privilege then null;
  end;
  begin
    select count(*) into v_count from public.company_document_profile_events;
    raise exception 'authenticated read % history rows', v_count;
  exception when insufficient_privilege then null;
  end;
  execute 'reset role';
  return 0;
end;
$$;
select pg_temp.read_as('37800000-0000-4000-8000-000000000003');
select pg_temp.read_as('37800000-0000-4000-8000-000000000001');

-- The profile and its history leave with their organization.
do $$
begin
  delete from public.organizations where id = '37800000-0000-4000-8000-000000000010';
  if exists (select 1 from public.company_document_profiles where organization_id = '37800000-0000-4000-8000-000000000010')
    or exists (select 1 from public.company_document_profile_events where organization_id = '37800000-0000-4000-8000-000000000010')
  then raise exception 'the profile outlived its organization'; end if;
end;
$$;

rollback;
