-- WerkFlow KI: a changed resend keeps the files it still shows (werk-flow/werkflow-planning#623).
--
-- A refused message ('run_active', 'disabled', 'budget_exhausted') is saved
-- with its files, and the composer puts text and files back into the draft.
-- Sent again unchanged, it is the same command. Sent with a file removed or
-- added, it is a new command, and until now the server refused every file
-- the first command had attached ('ai_file_not_found'). Now a file still on
-- the author's refused, unanswered message in the same thread moves to the
-- new message: the new message gets a file item, and the file row points at
-- it, so the file belongs to one message and its bytes stay. The earlier item
-- stays as the record of what was sent, so the thread's sequence keeps no gap
-- (a live cursor reads a gap as unread); the page shows a file once, with its
-- latest message. The new item names the commands the file came from, and
-- such a command never starts: its message lost files it was sent with. A
-- file of an answered message, of another thread, of another person or
-- organization still refuses.
--
-- Prevention: Tier 1 (this function is the only path that attaches a file),
-- Tier 2 supabase/tests/ai_thread_files.sql.

-- Attaches the author's files to their thread before the message of command
-- p_command_id, one complete `file` item each, in the order given, and
-- creates the thread when it is new. A file is the author's unsent upload, or
-- one still on a message of this thread whose command was saved and never
-- answered; the file row moves to the new item, which lists that command
-- under `movedFrom`. Refusals:
-- 'ai_files_over_turn_cap' (too many files or bytes for one message) and
-- 'ai_file_not_found' (no such file of the author: another person's, another
-- organization's, gone, or on an answered message or another thread). Only
-- start_ai_turn_with_files calls it, inside its transaction.
create or replace function app_private.attach_ai_thread_files(
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
  v_moved_from jsonb;
begin
  if cardinality(p_file_ids) > p_max_files
    or (select count(distinct id) from unnest(p_file_ids) as id) <> cardinality(p_file_ids) then
    raise exception 'ai_files_over_turn_cap';
  end if;
  select count(*), sum(file.size_bytes) into v_found, v_bytes
  from (
    select * from public.ai_thread_files file
    where file.id = any(p_file_ids) and file.organization_id = p_organization_id
      and file.user_id = p_user_id
      and (file.item_id is null or file.item_id in (
        select held.id from public.ai_thread_items held
        cross join lateral (select split_part(held.idempotency_key, ':file:', 1) as command) owner
        where held.thread_id = p_thread_id and held.organization_id = p_organization_id
          and held.kind = 'file' and held.idempotency_key = owner.command || ':file:' || file.id::text
          and exists (
            select 1 from public.ai_thread_items message
            where message.thread_id = p_thread_id and message.idempotency_key = owner.command || ':user'
          )
          and not exists (
            select 1 from public.ai_thread_items answer
            where answer.thread_id = p_thread_id and answer.idempotency_key = owner.command || ':assistant'
          )
      ))
    for update
  ) file;
  if v_found <> cardinality(p_file_ids) then raise exception 'ai_file_not_found'; end if;
  if v_bytes > p_max_bytes then raise exception 'ai_files_over_turn_cap'; end if;

  for v_file in
    select * from public.ai_thread_files file
    where file.id = any(p_file_ids) and file.organization_id = p_organization_id
    order by array_position(p_file_ids, file.id)
  loop
    -- Every command the file left, its earlier moves included, stays spent.
    select coalesce(held.body -> 'movedFrom', '[]'::jsonb)
        || jsonb_build_array(split_part(held.idempotency_key, ':file:', 1))
      into v_moved_from
    from public.ai_thread_items held
    where held.id = v_file.item_id and held.organization_id = p_organization_id;
    select * into v_item from public.append_ai_thread_item(
      p_organization_id, p_user_id, p_thread_id, 'file', 'complete',
      jsonb_build_object(
        'fileId', v_file.id, 'name', v_file.file_name, 'mimeType', v_file.mime_type,
        'sizeBytes', v_file.size_bytes, 'pages', v_file.page_count, 'origin', 'upload'
      ) || case when v_moved_from is null then '{}'::jsonb else jsonb_build_object('movedFrom', v_moved_from) end,
      p_command_id || ':file:' || v_file.id::text
    );
    update public.ai_thread_files file set item_id = v_item.item_id
    where file.id = v_file.id and file.organization_id = p_organization_id;
  end loop;
end;
$$;
revoke all on function app_private.attach_ai_thread_files(uuid, uuid, uuid, text, uuid[], integer, bigint)
  from public, anon, authenticated, service_role;

-- start_ai_turn_with_files as before, except that a command a changed resend
-- took files from reads as 'command_conflict' and writes nothing: its message
-- no longer holds the files it was sent with, so it must never start.
create or replace function public.start_ai_turn_with_files(
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
    if v_saved is distinct from p_file_ids or exists (
      select 1 from public.ai_thread_items moved
      where moved.thread_id = p_thread_id and moved.kind = 'file'
        and moved.body -> 'movedFrom' ? p_command_id
    ) then
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
revoke all on function public.start_ai_turn_with_files(uuid, uuid, uuid, text, text, text, bigint, uuid[], integer,
  bigint) from public, anon, authenticated;
grant execute on function public.start_ai_turn_with_files(uuid, uuid, uuid, text, text, text, bigint, uuid[],
  integer, bigint) to service_role;
