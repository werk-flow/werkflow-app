-- WerkFlow KI: files and phone photos in a thread (werk-flow/werkflow-planning#534).
--
-- A person uploads a PDF or an image for their next message. The browser
-- moves the bytes through a signed staging URL; the finalize copies them to a
-- key of its own and registers the file here, unattached. Sending the message
-- attaches its files as one `file` item each, in the call that saves the
-- message, under the command's id, so a retry attaches nothing twice. Only the author ever
-- reads the file, through a short-lived signed URL the server signs.
--
-- Bytes go with their row: every removed file row queues its object for the
-- purge in the same transaction, whichever path removed it. An attached file
-- goes with its item (the 12-month retention, the thread, the membership or
-- the organization); an unattached file a day after its upload.
--
-- Prevention: Tier 1 (the purge trigger, the path check, the author check in
-- every function, one transaction for a message and its files), Tier 2 supabase/tests/ai_thread_files.sql.

create table public.ai_thread_files (
  id uuid primary key,
  organization_id uuid not null,
  user_id uuid not null,
  -- The file's item once its message attached it; null until then.
  item_id uuid unique references public.ai_thread_items (id) on delete cascade,
  -- The name ends in `storage_path`, so the purge claim sees the column.
  storage_path text not null unique,
  file_name text not null check (char_length(file_name) between 1 and 200),
  mime_type text not null check (mime_type in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')),
  size_bytes bigint not null check (size_bytes > 0),
  -- A PDF's declared pages, null when the counter cannot follow its page tree; an image has none.
  page_count integer check (page_count is null or (page_count > 0 and mime_type = 'application/pdf')),
  created_at timestamptz not null default now(),
  -- The uploader's membership: a removed member's files go with it.
  foreign key (user_id, organization_id)
    references public.organization_members (user_id, organization_id) on delete cascade,
  constraint ai_thread_files_path_of_uploader check (
    starts_with(storage_path, organization_id::text || '/ki/' || user_id::text || '/' || id::text || '/')
  )
);

create index ai_thread_files_uploader_idx on public.ai_thread_files (user_id, organization_id);
create index ai_thread_files_unattached_idx on public.ai_thread_files (created_at) where item_id is null;

-- RLS without a policy: client roles see no row even if a grant appeared later.
alter table public.ai_thread_files enable row level security;
revoke all on table public.ai_thread_files from public, anon, authenticated, service_role;
grant select on table public.ai_thread_files to service_role;

-- Every removed file row queues its object for the purge in the same
-- transaction. Definer rights, because an account deletion's cascade runs as
-- the Auth role, which holds no grant on the queue.
create function app_private.queue_removed_ai_thread_files()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_organization record;
begin
  for v_organization in
    select removed.organization_id, array_agg(removed.storage_path) as paths
    from removed_files removed group by removed.organization_id
  loop
    perform public.queue_storage_purge(v_organization.organization_id, v_organization.paths);
  end loop;
  return null;
end;
$$;
revoke all on function app_private.queue_removed_ai_thread_files() from public, anon, authenticated;

create trigger ai_thread_files_queue_purge
  after delete on public.ai_thread_files
  referencing old table as removed_files
  for each statement execute function app_private.queue_removed_ai_thread_files();

-- Registers the finalized copy of one upload, unattached. The person keeps at
-- most p_max_unattached unattached files, so uploads nobody sends stay bounded.
create function public.register_ai_thread_file(
  p_organization_id uuid,
  p_user_id uuid,
  p_file_id uuid,
  p_storage_path text,
  p_file_name text,
  p_mime_type text,
  p_size_bytes bigint,
  p_page_count integer,
  p_max_unattached integer
)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not app_private.p1_24_has_effective_access(p_organization_id, p_user_id) then
    raise exception 'ai_actor_without_access';
  end if;
  -- The person's uploads one at a time, so two cannot both take the last place.
  perform pg_advisory_xact_lock(hashtextextended('ai_thread_files:' || p_user_id::text, 0));
  if exists (select 1 from public.ai_thread_files file where file.id = p_file_id) then
    raise exception 'already_finalized';
  end if;
  if (
    select count(*) from public.ai_thread_files file
    where file.organization_id = p_organization_id and file.user_id = p_user_id and file.item_id is null
  ) >= p_max_unattached then
    raise exception 'too_many_unsent_files';
  end if;
  insert into public.ai_thread_files (
    id, organization_id, user_id, storage_path, file_name, mime_type, size_bytes, page_count
  ) values (
    p_file_id, p_organization_id, p_user_id, p_storage_path, p_file_name, p_mime_type, p_size_bytes, p_page_count
  );
end;
$$;

-- Attaches the author's files to their thread before the message of command
-- p_command_id, one complete `file` item each, in the order given, and
-- creates the thread when it is new. Refusals: 'ai_files_over_turn_cap' (too
-- many files or bytes for one message) and 'ai_file_not_found' (no unsent
-- file of the author under the id: another person's, another organization's,
-- gone, or attached to another message). Only start_ai_turn_with_files calls
-- it, inside its transaction.
create function app_private.attach_ai_thread_files(
  p_organization_id uuid,
  p_user_id uuid,
  p_thread_id uuid,
  p_command_id text,
  p_file_ids uuid[],
  p_max_files integer,
  p_max_bytes bigint
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_file public.ai_thread_files;
  v_item record;
  v_found integer;
  v_bytes bigint;
begin
  if cardinality(p_file_ids) > p_max_files
    or (select count(distinct id) from unnest(p_file_ids) as id) <> cardinality(p_file_ids) then
    raise exception 'ai_files_over_turn_cap';
  end if;
  select count(*), sum(file.size_bytes) into v_found, v_bytes
  from (
    select * from public.ai_thread_files file
    where file.id = any(p_file_ids) and file.organization_id = p_organization_id
      and file.user_id = p_user_id and file.item_id is null
    for update
  ) file;
  if v_found <> cardinality(p_file_ids) then raise exception 'ai_file_not_found'; end if;
  if v_bytes > p_max_bytes then raise exception 'ai_files_over_turn_cap'; end if;

  for v_file in
    select * from public.ai_thread_files file
    where file.id = any(p_file_ids) and file.organization_id = p_organization_id
    order by array_position(p_file_ids, file.id)
  loop
    select * into v_item from public.append_ai_thread_item(
      p_organization_id, p_user_id, p_thread_id, 'file', 'complete',
      jsonb_build_object(
        'fileId', v_file.id, 'name', v_file.file_name, 'mimeType', v_file.mime_type,
        'sizeBytes', v_file.size_bytes, 'pages', v_file.page_count, 'origin', 'upload'
      ),
      p_command_id || ':file:' || v_file.id::text
    );
    update public.ai_thread_files file set item_id = v_item.item_id
    where file.id = v_file.id and file.organization_id = p_organization_id;
  end loop;
end;
$$;
revoke all on function app_private.attach_ai_thread_files(uuid, uuid, uuid, text, uuid[], integer, bigint)
  from public, anon, authenticated, service_role;

-- start_ai_turn with the message's files, none or more, in one transaction:
-- the message and its files are saved together or not at all, and every
-- verdict that keeps the message keeps its files. A command is bound to its
-- files: a repeat whose message is saved must name the same files in the same
-- order, none included, or it reads as 'command_conflict' and writes nothing. `files` names each file's
-- item sequence, so the sending page shows the cards in place.
create function public.start_ai_turn_with_files(
  p_organization_id uuid,
  p_user_id uuid,
  p_thread_id uuid,
  p_title text,
  p_command_id text,
  p_text text,
  p_reserve_micro_usd bigint,
  p_file_ids uuid[],
  p_max_files integer,
  p_max_bytes bigint
)
returns table (
  verdict text,
  run_id uuid,
  user_item_id uuid,
  user_item_sequence bigint,
  answer_item_id uuid,
  answer_item_sequence bigint,
  files jsonb
)
language plpgsql security definer set search_path = '' set lock_timeout = '3s' as $$
declare
  v_saved uuid[];
begin
  if p_file_ids is null then raise exception 'ai_files_over_turn_cap'; end if;
  -- The lock order of start_ai_turn: the settings, then the thread.
  perform 1 from public.ai_organization_settings settings
  where settings.organization_id = p_organization_id
  for update;
  perform public.create_ai_thread(p_organization_id, p_user_id, p_thread_id, p_title);
  perform 1 from public.ai_threads thread
  where thread.id = p_thread_id and thread.organization_id = p_organization_id
  for update;

  if exists (
    select 1 from public.ai_thread_items item
    where item.thread_id = p_thread_id and item.idempotency_key = p_command_id || ':user'
  ) then
    select coalesce(array_agg((item.body ->> 'fileId')::uuid order by item.sequence), '{}') into v_saved
    from public.ai_thread_items item
    where item.thread_id = p_thread_id and item.kind = 'file'
      and starts_with(item.idempotency_key, p_command_id || ':file:');
    if v_saved is distinct from p_file_ids then
      return query select 'command_conflict'::text, null::uuid, null::uuid, null::bigint, null::uuid,
        null::bigint, '[]'::jsonb;
      return;
    end if;
  elsif cardinality(p_file_ids) > 0 then
    perform app_private.attach_ai_thread_files(p_organization_id, p_user_id, p_thread_id, p_command_id,
      p_file_ids, p_max_files, p_max_bytes);
  end if;

  return query
    select started.*, (
      select coalesce(jsonb_agg(jsonb_build_object('fileId', item.body ->> 'fileId', 'sequence', item.sequence)
        order by item.sequence), '[]'::jsonb)
      from public.ai_thread_items item
      where item.thread_id = p_thread_id and item.kind = 'file'
        and starts_with(item.idempotency_key, p_command_id || ':file:')
    )
    from public.start_ai_turn(p_organization_id, p_user_id, p_thread_id, p_title, p_command_id, p_text,
      p_reserve_micro_usd) started;
end;
$$;

-- Removes one of the person's unsent uploads, which they took out of their
-- draft; its object is queued. Anything else under the id stays: a repeat, an
-- attached file and another person's file change nothing.
create function public.discard_ai_thread_file(p_organization_id uuid, p_user_id uuid, p_file_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not app_private.p1_24_has_effective_access(p_organization_id, p_user_id) then
    raise exception 'ai_actor_without_access';
  end if;
  delete from public.ai_thread_files file
  where file.id = p_file_id and file.organization_id = p_organization_id and file.user_id = p_user_id
    and file.item_id is null;
end;
$$;

revoke all on function public.discard_ai_thread_file(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.discard_ai_thread_file(uuid, uuid, uuid) to service_role;
revoke all on function public.register_ai_thread_file(uuid, uuid, uuid, text, text, text, bigint, integer, integer)
  from public, anon, authenticated;
revoke all on function public.start_ai_turn_with_files(uuid, uuid, uuid, text, text, text, bigint, uuid[], integer,
  bigint) from public, anon, authenticated;
grant execute on function public.register_ai_thread_file(uuid, uuid, uuid, text, text, text, bigint, integer, integer)
  to service_role;
grant execute on function public.start_ai_turn_with_files(uuid, uuid, uuid, text, text, text, bigint, uuid[],
  integer, bigint) to service_role;

-- An upload nobody sent goes a day after it was finalized; its object is queued.
create function app_private.delete_unattached_ai_thread_files()
returns void language sql security definer set search_path = '' as $$
  delete from public.ai_thread_files file
  where file.item_id is null and file.created_at < now() - interval '1 day';
$$;
revoke all on function app_private.delete_unattached_ai_thread_files() from public, anon, authenticated, service_role;

select cron.schedule('werkflow-ai-unsent-files', '41 3 * * *',
  'select app_private.delete_unattached_ai_thread_files()');
