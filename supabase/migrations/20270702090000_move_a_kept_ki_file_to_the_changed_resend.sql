-- WerkFlow KI: a changed resend keeps the files it still shows (werk-flow/werkflow-planning#623).
--
-- A refused message ('run_active', 'disabled', 'budget_exhausted') is saved
-- with its files, and the composer puts text and files back into the draft.
-- Sent again unchanged, it is the same command. Sent with a file removed or
-- added, it is a new command, and until now the server refused every file
-- the first command had attached ('ai_file_not_found'). Now a file still on
-- the author's refused, unanswered message in the same thread moves to the
-- new message: its item there goes, the new message gets one, and the file
-- row follows. A file keeps one item, and its bytes stay. A file of an
-- answered message, of another thread, of another person or organization
-- still refuses.
--
-- Prevention: Tier 1 (this function is the only path that attaches a file),
-- Tier 2 supabase/tests/ai_thread_files.sql.

-- Attaches the author's files to their thread before the message of command
-- p_command_id, one complete `file` item each, in the order given, and
-- creates the thread when it is new. A file is the author's unsent upload, or
-- one still on a message of this thread whose command was saved and never
-- answered; that file's item goes, so the file keeps one item. Refusals:
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
    select * into v_item from public.append_ai_thread_item(
      p_organization_id, p_user_id, p_thread_id, 'file', 'complete',
      jsonb_build_object(
        'fileId', v_file.id, 'name', v_file.file_name, 'mimeType', v_file.mime_type,
        'sizeBytes', v_file.size_bytes, 'pages', v_file.page_count, 'origin', 'upload'
      ),
      p_command_id || ':file:' || v_file.id::text
    );
    -- The row follows first: removing the earlier item would take the file row with it.
    update public.ai_thread_files file set item_id = v_item.item_id
    where file.id = v_file.id and file.organization_id = p_organization_id;
    if v_file.item_id is not null then
      delete from public.ai_thread_items item
      where item.id = v_file.item_id and item.organization_id = p_organization_id;
    end if;
  end loop;
end;
$$;
revoke all on function app_private.attach_ai_thread_files(uuid, uuid, uuid, text, uuid[], integer, bigint)
  from public, anon, authenticated, service_role;
