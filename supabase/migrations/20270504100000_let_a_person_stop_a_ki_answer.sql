-- WerkFlow KI: the real stop (werk-flow/werkflow-planning#609).
--
-- „Antwort anhalten“ sends a cancel command under the turn's own command id.
-- It finishes the answer as stopped, with the text its last partial save
-- held, so every tab and a reload show the same stopped answer at once. The
-- running turn notices at its next save or model step: the save refuses with
-- `ai_thread_item_stopped`, which aborts the provider request; the turn
-- records the attempt at what it may have cost and settles the run. A turn
-- whose invocation is gone is settled by the five-minute job
-- (20270415100000). A repeat of the command changes nothing.

-- Changed only in its refusal: an answer the person stopped says so, so the
-- running turn can tell the stop from an earlier try of its own final save.
create or replace function public.update_ai_thread_item(
  p_organization_id uuid,
  p_user_id uuid,
  p_item_id uuid,
  p_status public.ai_thread_item_status,
  p_body jsonb
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_thread_id uuid;
  v_status public.ai_thread_item_status;
  v_failure text;
begin
  select item.thread_id, item.status, item.body ->> 'failure' into v_thread_id, v_status, v_failure
  from public.ai_thread_items item
  where item.id = p_item_id and item.organization_id = p_organization_id
  for update;
  if v_thread_id is null then raise exception 'ai_thread_item_not_found'; end if;
  perform app_private.assert_ai_thread_author(p_organization_id, p_user_id, v_thread_id);
  -- Only cancel_ai_turn finishes an answer as cancelled with the failure 'stopped'.
  if v_status = 'cancelled' and v_failure = 'stopped' then raise exception 'ai_thread_item_stopped'; end if;
  if v_status <> 'streaming' then raise exception 'ai_thread_item_finished'; end if;

  update public.ai_thread_items item
  set status = p_status, body = p_body, updated_at = now()
  where item.id = p_item_id and item.organization_id = p_organization_id;
end;
$$;

-- Stops the author's answer to one command. Verdicts: 'stopped' (it was being
-- written and is now stopped), 'finished' (it had ended already, or was
-- stopped before) and 'not_found' (the command has no answer in the author's
-- thread). With 'stopped' comes the kept text's length in UTF-16 code units,
-- as the live channel counts it: the stop route tells every tab at once, also
-- when the turn's invocation is gone.
create function public.cancel_ai_turn(
  p_organization_id uuid,
  p_user_id uuid,
  p_thread_id uuid,
  p_command_id text
)
returns table (verdict text, text_length integer)
language plpgsql security definer set search_path = '' set lock_timeout = '3s' as $$
declare
  v_item public.ai_thread_items;
  v_text text;
begin
  perform app_private.assert_ai_thread_author(p_organization_id, p_user_id, p_thread_id);
  select * into v_item from public.ai_thread_items item
  where item.thread_id = p_thread_id and item.organization_id = p_organization_id
    and item.idempotency_key = p_command_id || ':assistant' and item.kind = 'assistant_message'
  for update;
  if not found then
    return query select 'not_found'::text, null::integer;
    return;
  end if;
  if v_item.status <> 'streaming' then
    return query select 'finished'::text, null::integer;
    return;
  end if;
  update public.ai_thread_items item
  set status = 'cancelled', body = item.body || '{"failure":"stopped"}'::jsonb, updated_at = now()
  where item.id = v_item.id and item.organization_id = p_organization_id;
  v_text := coalesce(v_item.body ->> 'text', '');
  -- JavaScript counts a character outside the Basic Multilingual Plane twice.
  return query select 'stopped'::text, char_length(v_text)
    + (select count(*)::integer from regexp_matches(v_text, '[\U00010000-\U0010FFFF]', 'g'));
end;
$$;
revoke all on function public.cancel_ai_turn(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.cancel_ai_turn(uuid, uuid, uuid, text) to service_role;
