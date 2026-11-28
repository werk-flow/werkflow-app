-- WerkFlow KI files (migration 20270602110000, werk-flow/werkflow-planning#534):
-- client roles reach neither function nor the table; a file registers once
-- per id under its uploader's key, and the unsent ones are capped; a message
-- attaches only its author's own unattached files, within the per-message
-- caps, once per command; another person's thread and another organization's
-- file are refused; every removed file row queues its object for the purge,
-- whether its item, its membership or the daily job of unsent files removed
-- it. Runs in one transaction and rolls back.
begin;

do $$
declare
  api_role text;
begin
  foreach api_role in array array['anon', 'authenticated'] loop
    if has_function_privilege(api_role,
        'public.register_ai_thread_file(uuid, uuid, uuid, text, text, text, bigint, integer, integer)', 'execute')
      or has_function_privilege(api_role,
        'public.start_ai_turn_with_files(uuid, uuid, uuid, text, text, text, bigint, uuid[], integer, bigint)',
        'execute')
      or has_function_privilege(api_role, 'public.discard_ai_thread_file(uuid, uuid, uuid)', 'execute') then
      raise exception 'A client role may write a KI file: %', api_role;
    end if;
    if has_table_privilege(api_role, 'public.ai_thread_files', 'SELECT,INSERT,UPDATE,DELETE') then
      raise exception 'A client role reaches the KI file table: %', api_role;
    end if;
  end loop;
  if has_table_privilege('service_role', 'public.ai_thread_files', 'INSERT,UPDATE,DELETE') then
    raise exception 'service_role writes KI files past their functions';
  end if;
  if not exists (select 1 from cron.job where jobname = 'werkflow-ai-unsent-files') then
    raise exception 'The daily job of unsent KI files is not scheduled';
  end if;
  if has_function_privilege('service_role',
      'app_private.attach_ai_thread_files(uuid, uuid, uuid, text, uuid[], integer, bigint)', 'execute') then
    raise exception 'service_role attaches files outside the call that saves their message';
  end if;
end;
$$;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
('af000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'ki-files-admin@example.test', '', now(), '{}',
 '{"first_name":"Admin","last_name":"Dateien"}', now(), now()),
('af000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'ki-files-employee@example.test', '', now(), '{}',
 '{"first_name":"Monteur","last_name":"Dateien"}', now(), now()),
('af000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'ki-files-foreign@example.test', '', now(), '{}',
 '{"first_name":"Fremd","last_name":"Dateien"}', now(), now());

insert into public.organizations (id, name, admin_id, unique_code) values
('af000000-0000-4000-8000-000000000010', 'KI Dateien', 'af000000-0000-4000-8000-000000000001', 'AIFIL1'),
('af000000-0000-4000-8000-000000000011', 'KI Dateien Fremd', 'af000000-0000-4000-8000-000000000003', 'AIFIL2');
insert into public.organization_members (organization_id, user_id, role) values
('af000000-0000-4000-8000-000000000010', 'af000000-0000-4000-8000-000000000002', 'employee');

set local role service_role;

-- Registration: one row per id, the key under the uploader's folder, and at most the cap unsent.
do $$
declare
  v_org constant uuid := 'af000000-0000-4000-8000-000000000010';
  v_user constant uuid := 'af000000-0000-4000-8000-000000000002';
  v_file uuid;
begin
  foreach v_file in array array[
    'af000000-0000-4000-8000-000000000101', 'af000000-0000-4000-8000-000000000102'
  ]::uuid[] loop
    -- The second PDF's pages are unknown: its counter could not follow the page tree.
    perform public.register_ai_thread_file(v_org, v_user, v_file,
      v_org || '/ki/' || v_user || '/' || v_file || '/a-datei', 'lieferschein.pdf', 'application/pdf', 1000,
      case when v_file = 'af000000-0000-4000-8000-000000000101' then 2 end, 3);
  end loop;
  if (select file.page_count from public.ai_thread_files file
      where file.id = 'af000000-0000-4000-8000-000000000102') is not null then
    raise exception 'A PDF of unknown pages must register with no page count';
  end if;
  begin
    perform public.register_ai_thread_file(v_org, v_user, 'af000000-0000-4000-8000-000000000101',
      v_org || '/ki/' || v_user || '/af000000-0000-4000-8000-000000000101/b-datei', 'x.pdf', 'application/pdf',
      1000, 1, 3);
    raise exception 'A file id registered twice';
  exception when others then
    if sqlerrm is distinct from 'already_finalized' then raise; end if;
  end;
  begin
    perform public.register_ai_thread_file(v_org, v_user, 'af000000-0000-4000-8000-000000000109',
      v_org || '/ki/af000000-0000-4000-8000-000000000001/af000000-0000-4000-8000-000000000109/a-datei',
      'fremd.jpg', 'image/jpeg', 1000, null, 3);
    raise exception 'A file registered under another person''s folder';
  exception when check_violation then null;
  end;
  begin
    perform public.register_ai_thread_file(v_org, v_user, 'af000000-0000-4000-8000-000000000108',
      v_org || '/ki/' || v_user || '/af000000-0000-4000-8000-000000000108/a-datei', 'foto.jpg', 'image/jpeg',
      1000, 3, 3);
    raise exception 'An image registered with a page count';
  exception when check_violation then null;
  end;
  perform public.register_ai_thread_file(v_org, v_user, 'af000000-0000-4000-8000-000000000103',
    v_org || '/ki/' || v_user || '/af000000-0000-4000-8000-000000000103/a-datei', 'foto.jpg', 'image/jpeg', 2000,
    null, 3);
  begin
    perform public.register_ai_thread_file(v_org, v_user, 'af000000-0000-4000-8000-000000000104',
      v_org || '/ki/' || v_user || '/af000000-0000-4000-8000-000000000104/a-datei', 'foto2.jpg', 'image/jpeg',
      1000, null, 3);
    raise exception 'A fourth unsent file registered over the cap of three';
  exception when others then
    if sqlerrm is distinct from 'too_many_unsent_files' then raise; end if;
  end;
  -- A member of another organization registers nothing here.
  begin
    perform public.register_ai_thread_file(v_org, 'af000000-0000-4000-8000-000000000003',
      'af000000-0000-4000-8000-000000000105',
      v_org || '/ki/af000000-0000-4000-8000-000000000003/af000000-0000-4000-8000-000000000105/a-datei',
      'fremd.pdf', 'application/pdf', 1000, 1, 3);
    raise exception 'A foreign member registered a file in the organization';
  exception when others then
    if sqlerrm is distinct from 'ai_actor_without_access' then raise; end if;
  end;
end;
$$;

reset role;
-- Sending: caps, the author's own unsent files only, saved with the message, and bound to the command.
create function pg_temp.send(p_user uuid, p_thread uuid, p_command text, p_files uuid[],
  p_max_files integer default 5, p_max_bytes bigint default 100000, p_org uuid default 'af000000-0000-4000-8000-000000000010')
returns text language sql as $$
  select started.verdict from public.start_ai_turn_with_files(p_org, p_user, p_thread, 'Lieferschein', p_command,
    'Lies den Lieferschein.', 1000, p_files, p_max_files, p_max_bytes) started;
$$;
create function pg_temp.expect_refusal(p_message text, p_why text, p_user uuid, p_thread uuid, p_command text,
  p_files uuid[], p_max_files integer default 5, p_max_bytes bigint default 100000,
  p_org uuid default 'af000000-0000-4000-8000-000000000010')
returns void language plpgsql as $$
begin
  perform pg_temp.send(p_user, p_thread, p_command, p_files, p_max_files, p_max_bytes, p_org);
  raise exception '%', p_why;
exception when others then
  if sqlerrm is distinct from p_message then raise; end if;
end;
$$;

grant execute on function pg_temp.send(uuid, uuid, text, uuid[], integer, bigint, uuid),
  pg_temp.expect_refusal(text, text, uuid, uuid, text, uuid[], integer, bigint, uuid) to service_role;
set local role service_role;

do $$
declare
  v_org constant uuid := 'af000000-0000-4000-8000-000000000010';
  v_user constant uuid := 'af000000-0000-4000-8000-000000000002';
  v_thread constant uuid := 'af000000-0000-4000-8000-000000000020';
  v_files constant uuid[] := array[
    'af000000-0000-4000-8000-000000000101', 'af000000-0000-4000-8000-000000000102'
  ]::uuid[];
  v_first uuid[];
begin
  perform pg_temp.expect_refusal('ai_files_over_turn_cap', 'Two files attached under a cap of one',
    v_user, v_thread, 'cmd-1', v_files, 1);
  perform pg_temp.expect_refusal('ai_files_over_turn_cap', 'Two files of 2,000 bytes attached under a cap of 1,999',
    v_user, v_thread, 'cmd-1', v_files, 5, 1999);
  perform pg_temp.expect_refusal('ai_files_over_turn_cap', 'One file attached twice to one message', v_user,
    v_thread, 'cmd-1', array['af000000-0000-4000-8000-000000000101', 'af000000-0000-4000-8000-000000000101']::uuid[]);
  perform pg_temp.expect_refusal('ai_file_not_found', 'The admin attached another person''s files',
    'af000000-0000-4000-8000-000000000001', 'af000000-0000-4000-8000-000000000021', 'cmd-admin', v_files);
  if exists (select 1 from public.ai_thread_items item where item.thread_id = v_thread)
    or exists (select 1 from public.ai_threads thread where thread.id = v_thread) then
    raise exception 'A refused send left its thread, message or files behind';
  end if;

  -- The organization is off, so the turn does not start; the message and its files stay together.
  if pg_temp.send(v_user, v_thread, 'cmd-1', v_files) is distinct from 'disabled' then
    raise exception 'A send in an organization that is off did not answer disabled';
  end if;
  select array_agg(item.id order by item.sequence) into v_first from public.ai_thread_items item
  where item.thread_id = v_thread;
  if (select array_agg(item.idempotency_key || '@' || item.sequence order by item.sequence)
      from public.ai_thread_items item where item.thread_id = v_thread) is distinct from array[
        'cmd-1:file:af000000-0000-4000-8000-000000000101@1', 'cmd-1:file:af000000-0000-4000-8000-000000000102@2',
        'cmd-1:user@3'
      ] then
    raise exception 'The files did not precede their message in the order sent';
  end if;
  if (select item.body from public.ai_thread_items item
      where item.idempotency_key = 'cmd-1:file:af000000-0000-4000-8000-000000000101') is distinct from
      '{"fileId":"af000000-0000-4000-8000-000000000101","name":"lieferschein.pdf","mimeType":"application/pdf","sizeBytes":1000,"pages":2,"origin":"upload"}'::jsonb then
    raise exception 'A file item does not carry the file''s registered values';
  end if;
  if (select item.body ->> 'pages' from public.ai_thread_items item
      where item.idempotency_key = 'cmd-1:file:af000000-0000-4000-8000-000000000102') is not null then
    raise exception 'A file item of unknown pages names a page count';
  end if;
  if (select started.files from public.start_ai_turn_with_files(v_org, v_user, v_thread, 'Lieferschein', 'cmd-1',
      'Lies den Lieferschein.', 1000, v_files, 5, 100000) started) is distinct from
      '[{"fileId":"af000000-0000-4000-8000-000000000101","sequence":1},{"fileId":"af000000-0000-4000-8000-000000000102","sequence":2}]'::jsonb then
    raise exception 'A repeat does not name the file items of its command';
  end if;

  -- A repeat with other files, or in another order, is another command and writes nothing.
  if pg_temp.send(v_user, v_thread, 'cmd-1', array['af000000-0000-4000-8000-000000000102',
      'af000000-0000-4000-8000-000000000101']::uuid[]) is distinct from 'command_conflict'
    or pg_temp.send(v_user, v_thread, 'cmd-1', array['af000000-0000-4000-8000-000000000103']::uuid[])
      is distinct from 'command_conflict' then
    raise exception 'A repeat of a saved command took other files';
  end if;
  -- A repeat that names no file is another command too, not a text-only retry of this one.
  if pg_temp.send(v_user, v_thread, 'cmd-1', '{}'::uuid[]) is distinct from 'command_conflict' then
    raise exception 'A repeat of a command saved with files started without them';
  end if;
  if (select array_agg(item.id order by item.sequence) from public.ai_thread_items item
      where item.thread_id = v_thread) is distinct from v_first
    or (select item_id from public.ai_thread_files where id = 'af000000-0000-4000-8000-000000000103') is not null then
    raise exception 'A conflicting repeat wrote an item or attached a file';
  end if;

  -- An attached file joins no other message, of this thread or another.
  perform pg_temp.expect_refusal('ai_file_not_found', 'An attached file joined a second message', v_user, v_thread,
    'cmd-2', array['af000000-0000-4000-8000-000000000101']::uuid[]);
  perform pg_temp.expect_refusal('ai_file_not_found', 'An attached file joined a second thread', v_user,
    'af000000-0000-4000-8000-000000000022', 'cmd-3', array['af000000-0000-4000-8000-000000000101']::uuid[]);
  -- Another person's thread takes no files.
  perform pg_temp.expect_refusal('ai_thread_not_found', 'The admin attached files into another person''s thread',
    'af000000-0000-4000-8000-000000000001', v_thread, 'cmd-4', array['af000000-0000-4000-8000-000000000103']::uuid[]);
  -- A discard removes only the caller's own unsent file: not another person's, not an attached one.
  perform public.discard_ai_thread_file(v_org, 'af000000-0000-4000-8000-000000000001',
    'af000000-0000-4000-8000-000000000103');
  perform public.discard_ai_thread_file(v_org, v_user, 'af000000-0000-4000-8000-000000000101');
  if (select count(*) from public.ai_thread_files where id in (
      'af000000-0000-4000-8000-000000000101', 'af000000-0000-4000-8000-000000000103')) <> 2 then
    raise exception 'A discard removed another person''s or an attached file';
  end if;
  -- Another organization's member names this organization's file and reaches nothing.
  perform pg_temp.expect_refusal('ai_file_not_found', 'A foreign organization attached this organization''s file',
    'af000000-0000-4000-8000-000000000003', 'af000000-0000-4000-8000-000000000023', 'cmd-5',
    array['af000000-0000-4000-8000-000000000103']::uuid[], 5, 100000, 'af000000-0000-4000-8000-000000000011');
end;
$$;

reset role;

-- Bytes go with their rows: the item's deletion, the unsent-files job and a removed membership each queue the object.
do $$
declare
  v_org constant text := 'af000000-0000-4000-8000-000000000010';
  v_user constant text := 'af000000-0000-4000-8000-000000000002';
begin
  if exists (select 1 from public.storage_purge_queue where organization_id = v_org::uuid) then
    raise exception 'A file was queued for the purge before its row went';
  end if;
  delete from public.ai_thread_items item
  where item.idempotency_key = 'cmd-1:file:af000000-0000-4000-8000-000000000101';
  if not exists (select 1 from public.storage_purge_queue
      where storage_path = v_org || '/ki/' || v_user || '/af000000-0000-4000-8000-000000000101/a-datei')
    or exists (select 1 from public.ai_thread_files where id = 'af000000-0000-4000-8000-000000000101') then
    raise exception 'A deleted file item left its file row or did not queue its object';
  end if;

  -- The person's own discard of an unsent upload queues its object.
  insert into public.ai_thread_files (id, organization_id, user_id, storage_path, file_name, mime_type, size_bytes)
  values ('af000000-0000-4000-8000-000000000106', v_org::uuid, v_user::uuid,
    v_org || '/ki/' || v_user || '/af000000-0000-4000-8000-000000000106/a-datei', 'weg.jpg', 'image/jpeg', 10);
  perform public.discard_ai_thread_file(v_org::uuid, v_user::uuid, 'af000000-0000-4000-8000-000000000106');
  if not exists (select 1 from public.storage_purge_queue
      where storage_path = v_org || '/ki/' || v_user || '/af000000-0000-4000-8000-000000000106/a-datei') then
    raise exception 'A discarded upload did not queue its object';
  end if;

  update public.ai_thread_files set created_at = now() - interval '25 hours'
  where id = 'af000000-0000-4000-8000-000000000103';
  perform app_private.delete_unattached_ai_thread_files();
  if not exists (select 1 from public.storage_purge_queue
      where storage_path = v_org || '/ki/' || v_user || '/af000000-0000-4000-8000-000000000103/a-datei') then
    raise exception 'The job left an unsent file of over a day, or did not queue its object';
  end if;
  if not exists (select 1 from public.ai_thread_files where id = 'af000000-0000-4000-8000-000000000102') then
    raise exception 'The unsent-files job deleted an attached file';
  end if;

  -- A suspended member discards nothing, not even their own unsent upload.
  insert into public.ai_thread_files (id, organization_id, user_id, storage_path, file_name, mime_type, size_bytes)
  values ('af000000-0000-4000-8000-000000000107', v_org::uuid, v_user::uuid,
    v_org || '/ki/' || v_user || '/af000000-0000-4000-8000-000000000107/a-datei', 'bleibt.jpg', 'image/jpeg', 10);
  perform public.set_personnel_access_transition(
    'af000000-0000-4000-8000-000000000001', v_org::uuid,
    (select id from public.employee_records where organization_id = v_org::uuid and user_id = v_user::uuid),
    0, 'suspend_now', clock_timestamp(), 'Zugang geändert', 'af000000-0000-4000-8000-000000000150', repeat('b', 64)
  );
  begin
    perform public.discard_ai_thread_file(v_org::uuid, v_user::uuid, 'af000000-0000-4000-8000-000000000107');
    raise exception 'A suspended member discarded an upload';
  exception when others then
    if sqlerrm is distinct from 'ai_actor_without_access' then raise; end if;
  end;

  delete from public.organization_members where organization_id = v_org::uuid and user_id = v_user::uuid;
  if not exists (select 1 from public.storage_purge_queue
      where storage_path = v_org || '/ki/' || v_user || '/af000000-0000-4000-8000-000000000102/a-datei') then
    raise exception 'A removed member''s attached file did not queue its object';
  end if;
end;
$$;

rollback;
