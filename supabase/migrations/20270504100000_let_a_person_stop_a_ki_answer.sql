-- WerkFlow KI: the real stop (werk-flow/werkflow-planning#532).
--
-- „Antwort anhalten“ sends a cancel command under the turn's own command id.
-- It finishes the answer as stopped, with the text its last partial save
-- held, so every tab and a reload show the same stopped answer at once. The
-- running turn notices at its next partial save, which the finished answer
-- refuses: it aborts the provider request, records the attempt at what it may
-- have cost, and settles the run. A turn whose invocation is gone is settled
-- by the five-minute job (20270415100000). A repeat of the command changes
-- nothing.

-- Verdicts: 'stopped' (the answer was being written and is now stopped),
-- 'finished' (it had ended already, or was stopped before) and 'not_found'
-- (the command has no answer in the author's thread). Returns the stopped
-- answer's text length in UTF-16 code units, as the live channel counts it.
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
  -- JavaScript counts a character outside the Basic Multilingual Plane twice.
  return query select 'stopped'::text,
    (char_length(coalesce(v_item.body ->> 'text', ''))
      + (select count(*)::integer from regexp_matches(coalesce(v_item.body ->> 'text', ''), '[\U00010000-\U0010FFFF]', 'g')))::integer;
end;
$$;
revoke all on function public.cancel_ai_turn(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.cancel_ai_turn(uuid, uuid, uuid, text) to service_role;
