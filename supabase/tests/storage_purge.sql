-- Deleted file bytes outlive the backup window
-- (20261108210001_keep_deleted_file_bytes_past_the_backup_window.sql,
-- werk-flow/werkflow-planning#286). Permanent deletion of a document and
-- organization deletion remove the rows at once and queue every object path
-- eight days ahead. A claim of the purge returns only due paths no row
-- references; a path a restored row references again leaves the queue and
-- survives. A claimed entry waits an hour before a run claims it again, and
-- stays queued until the purge completes it. Only the service role executes
-- the functions.
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
('28600000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'storage-purge-admin@example.test', '', now(), '{}',
 '{"first_name":"Admin","last_name":"Purge"}', now(), now());

-- 10 deletes a document, 11 is deleted as a whole.
insert into public.organizations (id, name, admin_id, unique_code) values
('28600000-0000-0000-0000-000000000010', 'Löschfrist', '28600000-0000-0000-0000-000000000001', 'PURGE10'),
('28600000-0000-0000-0000-000000000011', 'Ganz weg', '28600000-0000-0000-0000-000000000001', 'PURGE11');

insert into public.documents (
  id, organization_id, storage_path, original_file_name, display_name, category, size_bytes, uploaded_by,
  current_version_number, deleted_at, deleted_by
) values
('28600000-0000-0000-0000-000000000020', '28600000-0000-0000-0000-000000000010',
 '28600000-0000-0000-0000-000000000010/d20/foto.jpg', 'foto.jpg', 'foto.jpg', 'photo', 10,
 '28600000-0000-0000-0000-000000000001', 2, now(), '28600000-0000-0000-0000-000000000001'),
('28600000-0000-0000-0000-000000000021', '28600000-0000-0000-0000-000000000011',
 '28600000-0000-0000-0000-000000000011/d21/bericht.pdf', 'bericht.pdf', 'bericht.pdf', 'report', 10,
 '28600000-0000-0000-0000-000000000001', 2, null, null);
insert into public.document_versions (
  organization_id, document_id, version_number, storage_path, original_file_name, size_bytes, uploaded_by
) values
('28600000-0000-0000-0000-000000000010', '28600000-0000-0000-0000-000000000020', 1,
 '28600000-0000-0000-0000-000000000010/d20/versions/1-foto.jpg', 'foto.jpg', 10,
 '28600000-0000-0000-0000-000000000001'),
('28600000-0000-0000-0000-000000000011', '28600000-0000-0000-0000-000000000021', 1,
 '28600000-0000-0000-0000-000000000011/d21/versions/1-bericht.pdf', 'bericht.pdf', 10,
 '28600000-0000-0000-0000-000000000001');

-- Permanent deletion removes the row at once and queues its object and every
-- version eight days ahead; the object stays until the purge.
do $$
declare
  v_org constant uuid := '28600000-0000-0000-0000-000000000010';
  v_paths text[];
begin
  v_paths := public.permanently_delete_document(
    '28600000-0000-0000-0000-000000000001', v_org, '28600000-0000-0000-0000-000000000020'
  );
  if exists (select 1 from public.documents where id = '28600000-0000-0000-0000-000000000020') then
    raise exception 'the permanent deletion kept the document row';
  end if;
  if (select array_agg(storage_path order by storage_path) from public.storage_purge_queue
      where organization_id = v_org and purge_after = now() + interval '8 days')
    is distinct from array[v_org || '/d20/foto.jpg', v_org || '/d20/versions/1-foto.jpg']
  then raise exception 'the permanent deletion did not queue every object eight days ahead'; end if;
  if v_paths <> array[v_org || '/d20/foto.jpg', v_org || '/d20/versions/1-foto.jpg'] then
    raise exception 'the permanent deletion no longer returns its paths to the previous release';
  end if;
end;
$$;

-- Organization deletion queues the listed objects and every document and
-- version path with the rows; a refusal queues nothing, and the entries
-- outlive the organization. A late upload's key is still queued afterwards.
do $$
declare
  v_org constant uuid := '28600000-0000-0000-0000-000000000011';
  v_owner constant uuid := '28600000-0000-0000-0000-000000000001';
begin
  begin
    perform public.delete_organization_with_files(
      v_org, v_owner, 'Falscher Name', array[v_org || '/staging/upload.pdf']
    );
    raise exception 'a wrong confirmation name deleted the organization';
  exception when raise_exception then
    if sqlerrm <> 'name_mismatch' then raise; end if;
  end;
  if exists (select 1 from public.storage_purge_queue where organization_id = v_org) then
    raise exception 'a refused organization deletion queued files';
  end if;

  perform public.delete_organization_with_files(
    v_org, v_owner, 'Ganz weg', array[v_org || '/staging/upload.pdf', v_org || '/d21/bericht.pdf']
  );
  if exists (select 1 from public.organizations where id = v_org) then
    raise exception 'the organization remains';
  end if;
  if (select array_agg(storage_path order by storage_path) from public.storage_purge_queue
      where organization_id = v_org and purge_after = now() + interval '8 days')
    is distinct from array[
      v_org || '/d21/bericht.pdf', v_org || '/d21/versions/1-bericht.pdf', v_org || '/staging/upload.pdf'
    ]
  then raise exception 'the organization deletion did not queue every listed and registered path'; end if;

  -- An upload that landed after the listing is queued once the organization is gone.
  perform public.queue_storage_purge(v_org, array[v_org || '/staging/spaet.jpg']);
  if not exists (
    select 1 from public.storage_purge_queue
    where storage_path = v_org || '/staging/spaet.jpg' and purge_after = now() + interval '8 days'
  ) then raise exception 'a late upload of a deleted organization could not be queued'; end if;
end;
$$;

-- A path outside the named organization is refused; a path queued again keeps
-- the later date.
do $$
declare
  v_org constant uuid := '28600000-0000-0000-0000-000000000010';
begin
  begin
    perform public.queue_storage_purge(v_org, array['28600000-0000-0000-0000-000000000011/fremd.pdf']);
    raise exception 'a foreign path was queued';
  exception when check_violation then null;
  end;
  update public.storage_purge_queue set purge_after = now() + interval '20 days'
  where storage_path = v_org || '/d20/foto.jpg';
  perform public.queue_storage_purge(v_org, array[v_org || '/d20/foto.jpg', v_org || '/staging/upload.jpg']);
  if (select purge_after from public.storage_purge_queue where storage_path = v_org || '/d20/foto.jpg')
    <> now() + interval '20 days'
  then raise exception 'queueing a path again shortened its delay'; end if;
  if not exists (select 1 from public.storage_purge_queue
    where storage_path = v_org || '/staging/upload.jpg' and purge_after = now() + interval '8 days')
  then raise exception 'an object without a row was not queued'; end if;
end;
$$;

-- The purge claims only due paths no row references. A restored document, a
-- version and any other column named *storage_path keep their path: its
-- entry leaves the queue and the object survives.
create table public.purge_test_references (organization_id uuid, document_storage_path text);
do $$
declare
  v_org constant uuid := '28600000-0000-0000-0000-000000000010';
  v_claimed text[];
begin
  perform public.queue_storage_purge(v_org, array[
    v_org || '/due/frei.pdf', v_org || '/due/wiederhergestellt.pdf', v_org || '/due/version.pdf',
    v_org || '/due/anderswo.pdf', v_org || '/due/zukunft.pdf'
  ]);
  update public.storage_purge_queue set purge_after = now() - interval '1 second'
  where storage_path in (
    v_org || '/due/frei.pdf', v_org || '/due/wiederhergestellt.pdf', v_org || '/due/version.pdf',
    v_org || '/due/anderswo.pdf', v_org || '/d20/versions/1-foto.jpg'
  );
  update public.storage_purge_queue set purge_after = now() + interval '1 day'
  where storage_path = v_org || '/due/zukunft.pdf';

  insert into public.documents (
    id, organization_id, storage_path, original_file_name, display_name, category, size_bytes, uploaded_by
  ) values (
    '28600000-0000-0000-0000-000000000030', v_org, v_org || '/due/wiederhergestellt.pdf',
    'wiederhergestellt.pdf', 'wiederhergestellt.pdf', 'other', 10, '28600000-0000-0000-0000-000000000001'
  );
  insert into public.document_versions (
    organization_id, document_id, version_number, storage_path, original_file_name, size_bytes, uploaded_by
  ) values (
    v_org, '28600000-0000-0000-0000-000000000030', 1, v_org || '/due/version.pdf', 'version.pdf', 10,
    '28600000-0000-0000-0000-000000000001'
  );
  insert into public.purge_test_references values (v_org, v_org || '/due/anderswo.pdf');

  select array_agg(claimed.storage_path order by claimed.storage_path) into v_claimed
  from public.claim_storage_purge(100) claimed;
  if v_claimed is distinct from array[
    v_org || '/d20/versions/1-foto.jpg', v_org || '/due/frei.pdf'
  ] then raise exception 'the purge claimed other paths than the due unreferenced ones: %', v_claimed; end if;
  if exists (select 1 from public.storage_purge_queue where storage_path in (
    v_org || '/due/wiederhergestellt.pdf', v_org || '/due/version.pdf', v_org || '/due/anderswo.pdf'
  )) then raise exception 'a path a row references again stayed queued'; end if;
  if (select attempts from public.storage_purge_queue where storage_path = v_org || '/due/zukunft.pdf') <> 0 then
    raise exception 'the purge touched an entry before its date';
  end if;

  -- A claimed entry waits an hour; one the purge did not complete stays queued
  -- and comes back with its attempts once the hour is over.
  if exists (select 1 from public.claim_storage_purge(100)) then
    raise exception 'a claimed entry was claimed again within the hour';
  end if;
  perform public.complete_storage_purge(array(
    select id from public.storage_purge_queue where storage_path = v_org || '/due/frei.pdf'
  ));
  if exists (select 1 from public.storage_purge_queue where storage_path = v_org || '/due/frei.pdf') then
    raise exception 'a completed entry stayed queued';
  end if;
  update public.storage_purge_queue set last_attempt_at = now() - interval '1 hour'
  where storage_path = v_org || '/d20/versions/1-foto.jpg';
  select array_agg(claimed.storage_path) into v_claimed from public.claim_storage_purge(100) claimed;
  if v_claimed is distinct from array[v_org || '/d20/versions/1-foto.jpg']
    or (select attempts from public.storage_purge_queue
      where storage_path = v_org || '/d20/versions/1-foto.jpg') <> 2
  then raise exception 'a failed purge did not stay queued for the next run'; end if;
end;
$$;

-- Only the service role executes the queue functions; no client role reads the queue.
do $$
declare
  v_function text;
begin
  foreach v_function in array array[
    'public.queue_storage_purge(uuid, text[])',
    'public.delete_organization_with_files(uuid, uuid, text, text[])',
    'public.claim_storage_purge(integer)',
    'public.complete_storage_purge(uuid[])'
  ] loop
    if has_function_privilege('anon', v_function, 'EXECUTE')
      or has_function_privilege('authenticated', v_function, 'EXECUTE')
      or not has_function_privilege('service_role', v_function, 'EXECUTE')
    then raise exception 'wrong execute grants on %', v_function; end if;
  end loop;
  if has_table_privilege('authenticated', 'public.storage_purge_queue', 'SELECT')
    or has_table_privilege('anon', 'public.storage_purge_queue', 'SELECT')
  then raise exception 'a client role reads the purge queue'; end if;
end;
$$;

rollback;
