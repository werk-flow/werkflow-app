-- WerkFlow KI shows its tool calls, questions and to-do lists as rows of the
-- thread (werk-flow/werkflow-planning#533, docs/features/ai-automations.md).
--
-- A row's summary is its item body, which the thread window reads. What a
-- row shows only when the person expands it (a tool's input and result) is
-- its detail, read one row at a time, so a thread opens without tool results
-- (brief non-negotiable 5). Only the author reads either: the item policy
-- covers the new column.
--
-- A tool call's row and its ledger row are written in one call, and the first
-- such call claims the tool call's outcome: a later one under the same ledger
-- key, such as the failed row the harness writes for a call still running
-- when its turn ends, writes no row. A row changes only to a higher revision,
-- so a late repeat of an older write never overwrites a newer one.

alter table public.ai_thread_items add column detail jsonb;
-- @destructive: after release 8a73d1d0aa07fd5f17dd05cb04d2a8e06f3b8f7b: the rule binds only the new column, which older code never writes
alter table public.ai_thread_items add constraint ai_thread_items_detail_check
  check (detail is null or (jsonb_typeof(detail) = 'object' and octet_length(detail::text) <= 65536)) not valid;

-- Writes one row of a run's thread under its key: the run names the thread,
-- its author and organization, so a row lands only in the caller's own
-- thread. A new key takes the thread's next sequence; a known key keeps its
-- place and changes only to a higher revision. With a ledger key, the tool
-- call's ledger row (ids and its outcome, nil cost) is written in the same
-- transaction; a ledger key already recorded writes nothing and returns null.
-- Returns the row's sequence.
create function public.record_ai_tool_item(
  p_organization_id uuid,
  p_user_id uuid,
  p_run_id uuid,
  p_kind public.ai_thread_item_kind,
  p_status public.ai_thread_item_status,
  p_item_key text,
  p_body jsonb,
  p_detail jsonb default null,
  p_ledger_key text default null,
  p_model_id text default null,
  p_prompt_version text default null,
  p_outcome text default null
)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  v_thread_id uuid;
  v_sequence bigint;
  v_item public.ai_thread_items;
begin
  if p_kind is null or p_kind not in ('tool_call', 'question', 'todo_list') then
    raise exception 'ai_tool_item_kind_invalid';
  end if;
  if jsonb_typeof(p_body -> 'revision') is distinct from 'number' then
    raise exception 'ai_tool_item_revision_invalid';
  end if;
  select run.thread_id into v_thread_id from public.ai_runs run
  where run.id = p_run_id and run.organization_id = p_organization_id and run.user_id = p_user_id;
  if v_thread_id is null then raise exception 'ai_run_not_found'; end if;
  perform app_private.assert_ai_thread_author(p_organization_id, p_user_id, v_thread_id);

  -- The thread row lock orders this write with every append.
  select thread.last_sequence into v_sequence from public.ai_threads thread
  where thread.id = v_thread_id and thread.organization_id = p_organization_id
  for update;

  -- Under the thread lock, the first call that recorded this tool call's outcome is the only one.
  if p_ledger_key is not null and exists (
    select 1 from public.ai_run_attempts attempt
    where attempt.organization_id = p_organization_id and attempt.idempotency_key = p_ledger_key
  ) then
    perform public.record_ai_run_attempt(p_organization_id, p_run_id, p_ledger_key, p_model_id,
      p_prompt_version, 0, 0, 0, 0, 0, p_outcome);
    return null;
  end if;

  select * into v_item from public.ai_thread_items item
  where item.thread_id = v_thread_id and item.idempotency_key = p_item_key;
  if found then
    if v_item.kind <> p_kind then raise exception 'ai_thread_item_key_conflict'; end if;
    if (p_body ->> 'revision')::numeric > coalesce((v_item.body ->> 'revision')::numeric, 0) then
      update public.ai_thread_items item
      set status = p_status, body = p_body, detail = p_detail, updated_at = now()
      where item.id = v_item.id;
    end if;
    v_sequence := v_item.sequence;
  else
    v_sequence := v_sequence + 1;
    update public.ai_threads thread
    set last_sequence = v_sequence, updated_at = now()
    where thread.id = v_thread_id and thread.organization_id = p_organization_id;
    insert into public.ai_thread_items (
      organization_id, thread_id, sequence, kind, status, idempotency_key, body, detail
    ) values (
      p_organization_id, v_thread_id, v_sequence, p_kind, p_status, p_item_key, p_body, p_detail
    );
  end if;

  if p_ledger_key is not null then
    perform public.record_ai_run_attempt(p_organization_id, p_run_id, p_ledger_key, p_model_id,
      p_prompt_version, 0, 0, 0, 0, 0, p_outcome);
  end if;
  return v_sequence;
end;
$$;

revoke all on function public.record_ai_tool_item(uuid, uuid, uuid, public.ai_thread_item_kind,
  public.ai_thread_item_status, text, jsonb, jsonb, text, text, text, text) from public, anon, authenticated;
grant execute on function public.record_ai_tool_item(uuid, uuid, uuid, public.ai_thread_item_kind,
  public.ai_thread_item_status, text, jsonb, jsonb, text, text, text, text) to service_role;
