-- WerkFlow KI: no turn loses its cost (werk-flow/werkflow-planning#559).
--
-- A run's reservation is its provisional charge. It counts against the
-- organization's budget until the run settles, however long that takes, and
-- settling corrects it to the attempts the ledger recorded. Before, an open
-- run's hold lapsed after 15 minutes, so a run whose cost write failed lost
-- that cost from the month.
--
-- A job settles every run still open 15 minutes after it began: a turn lives
-- at most a few minutes, so its harness is gone. The job books the part of the
-- reservation the ledger lacks as one ledger row, so the month's ledger holds
-- the run at its reserved amount. It also finishes an answer left streaming as
-- interrupted, with the text its last save held, so no answer waits for a
-- retry from the client.
--
-- A turn starts in one call under the command's idempotency key: the thread,
-- the person's message, the check for another open run of the person, the
-- reservation and the empty answer. A refusal keeps the message and writes
-- nothing else; a repeat writes nothing twice.

-- The job finds the few answers still streaming without scanning the thread items.
create index ai_thread_items_streaming_idx on public.ai_thread_items (created_at)
  where status = 'streaming';

-- Unchanged but for one line: every open hold counts, whatever its age.
create or replace function public.reserve_ai_run(
  p_organization_id uuid,
  p_user_id uuid,
  p_thread_id uuid,
  p_idempotency_key text,
  p_reserve_micro_usd bigint
)
returns table (run_id uuid, verdict text)
language plpgsql security definer set search_path = '' set lock_timeout = '3s' as $$
declare
  v_settings public.ai_organization_settings;
  v_month_start timestamptz :=
    date_trunc('month', now() at time zone 'Europe/Berlin') at time zone 'Europe/Berlin';
  v_committed bigint;
  v_run public.ai_runs;
begin
  if p_reserve_micro_usd is null or p_reserve_micro_usd <= 0 then
    raise exception 'ai_reservation_invalid';
  end if;
  perform app_private.assert_ai_thread_author(p_organization_id, p_user_id, p_thread_id);

  -- The settings row lock orders the organization's reservations.
  select * into v_settings from public.ai_organization_settings settings
  where settings.organization_id = p_organization_id
  for update;
  if not found or not v_settings.enabled then
    return query select null::uuid, 'disabled'::text;
    return;
  end if;

  select * into v_run from public.ai_runs run
  where run.organization_id = p_organization_id and run.idempotency_key = p_idempotency_key;
  if found then
    if v_run.user_id is distinct from p_user_id or v_run.thread_id is distinct from p_thread_id
      or v_run.reserved_micro_usd <> p_reserve_micro_usd then
      raise exception 'ai_reservation_key_conflict';
    end if;
    if v_run.status <> 'reserved' or v_run.created_at <= now() - interval '15 minutes' then
      raise exception 'ai_run_closed';
    end if;
    return query select v_run.id, 'replayed'::text;
    return;
  end if;

  -- One statement, so one snapshot counts each attempt exactly once: in the
  -- month's spend, and as recorded cost against its run's open hold. An open
  -- run is a provisional charge at its reserved amount until it settles.
  select
    coalesce((
      select sum(attempt.cost_micro_usd) from public.ai_run_attempts attempt
      where attempt.organization_id = p_organization_id and attempt.created_at >= v_month_start
    ), 0)
    + coalesce((
      select sum(greatest(run.reserved_micro_usd - coalesce(recorded.cost, 0), 0))
      from public.ai_runs run
      left join lateral (
        select sum(attempt.cost_micro_usd) as cost from public.ai_run_attempts attempt
        where attempt.run_id = run.id and attempt.organization_id = p_organization_id
      ) recorded on true
      where run.organization_id = p_organization_id and run.status = 'reserved'
    ), 0)
  into v_committed;

  -- 1 USD counts as 1 EUR.
  if v_committed + p_reserve_micro_usd > v_settings.monthly_budget_micro_eur then
    return query select null::uuid, 'budget_exhausted'::text;
    return;
  end if;

  insert into public.ai_runs (organization_id, thread_id, user_id, idempotency_key, reserved_micro_usd)
  values (p_organization_id, p_thread_id, p_user_id, p_idempotency_key, p_reserve_micro_usd)
  returning * into v_run;
  return query select v_run.id, 'reserved'::text;
end;
$$;

-- Finishes an answer nobody will finish: as interrupted, with the text its
-- last save held. A finished answer stays as it was.
create function app_private.abandon_ai_answer(p_organization_id uuid, p_item_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.ai_thread_items item
  set status = 'failed', body = item.body || '{"failure":"interrupted"}'::jsonb, updated_at = now()
  where item.id = p_item_id and item.organization_id = p_organization_id
    and item.kind = 'assistant_message' and item.status = 'streaming';
end;
$$;
revoke all on function app_private.abandon_ai_answer(uuid, uuid) from public, anon, authenticated, service_role;

-- Starts one turn of the author's thread. Verdicts: 'started' (the run is
-- reserved and the empty answer saved), 'answered' (the command has its
-- answer; one left streaming by an ended run is finished as interrupted),
-- 'run_active' (this command or another of the person's runs is open, in any
-- of their organizations), 'command_conflict' (the command id names another
-- message), 'disabled' and 'budget_exhausted'. Every verdict keeps the
-- person's message; only 'started' writes more. Any error, a lock wait over
-- its timeout included, writes nothing.
create function public.start_ai_turn(
  p_organization_id uuid,
  p_user_id uuid,
  p_thread_id uuid,
  p_title text,
  p_command_id text,
  p_text text,
  p_reserve_micro_usd bigint
)
returns table (
  verdict text,
  run_id uuid,
  user_item_id uuid,
  user_item_sequence bigint,
  answer_item_id uuid,
  answer_item_sequence bigint
)
language plpgsql security definer set search_path = '' set lock_timeout = '3s' as $$
declare
  -- Verbatim, as the previous build keyed it: the route passes a validated uuid.
  v_command text := p_command_id;
  v_user record;
  v_answer_id uuid;
  v_reservation record;
  v_placeholder record;
begin
  -- Locks in the order every writer of these rows takes them: the
  -- organization's settings (reserve_ai_run, also the previous build's), the
  -- thread (an append, a run's foreign key), then the person.
  perform 1 from public.ai_organization_settings settings
  where settings.organization_id = p_organization_id
  for update;
  perform public.create_ai_thread(p_organization_id, p_user_id, p_thread_id, p_title);
  select * into v_user from public.append_ai_thread_item(p_organization_id, p_user_id, p_thread_id,
    'user_message', 'complete', jsonb_build_object('text', p_text), v_command || ':user');
  if (select item.body ->> 'text' from public.ai_thread_items item
      where item.id = v_user.item_id and item.organization_id = p_organization_id) is distinct from p_text then
    return query select 'command_conflict'::text, null::uuid, null::uuid, null::bigint, null::uuid, null::bigint;
    return;
  end if;

  select item.id into v_answer_id from public.ai_thread_items item
  where item.thread_id = p_thread_id and item.organization_id = p_organization_id
    and item.idempotency_key = v_command || ':assistant';
  if found then
    -- A run of this command is still open, in another request; an earlier build keyed retries `<command>:retry-<n>`.
    if exists (
      select 1 from public.ai_runs run
      where run.organization_id = p_organization_id and run.idempotency_key like v_command || '%'
        and run.status = 'reserved' and run.created_at > now() - interval '15 minutes'
    ) then
      return query select 'run_active'::text, null::uuid, null::uuid, null::bigint, null::uuid, null::bigint;
      return;
    end if;
    perform app_private.abandon_ai_answer(p_organization_id, v_answer_id);
    return query select 'answered'::text, null::uuid, null::uuid, null::bigint, null::uuid, null::bigint;
    return;
  end if;

  -- One open run per person across their organizations (B13). The lock
  -- orders the person's starts, so the second sees the first's run.
  perform pg_advisory_xact_lock(hashtextextended('ai_run_person:' || p_user_id::text, 0));
  if exists (
    select 1 from public.ai_runs run
    where run.user_id = p_user_id and run.status = 'reserved'
      and run.created_at > now() - interval '15 minutes'
  ) then
    return query select 'run_active'::text, null::uuid, null::uuid, null::bigint, null::uuid, null::bigint;
    return;
  end if;

  select * into v_reservation from public.reserve_ai_run(p_organization_id, p_user_id, p_thread_id, v_command,
    p_reserve_micro_usd);
  if v_reservation.verdict <> 'reserved' then
    return query select v_reservation.verdict, null::uuid, null::uuid, null::bigint, null::uuid, null::bigint;
    return;
  end if;

  select * into v_placeholder from public.append_ai_thread_item(p_organization_id, p_user_id, p_thread_id,
    'assistant_message', 'streaming', '{"text":""}'::jsonb, v_command || ':assistant');
  return query select 'started'::text, v_reservation.run_id, v_user.item_id, v_user.item_sequence,
    v_placeholder.item_id, v_placeholder.item_sequence;
end;
$$;
revoke all on function public.start_ai_turn(uuid, uuid, uuid, text, text, text, bigint)
  from public, anon, authenticated;
grant execute on function public.start_ai_turn(uuid, uuid, uuid, text, text, text, bigint) to service_role;

-- Settles every run still open 15 minutes after it began at its reserved
-- amount, and finishes the answers such runs left streaming. The run lock and
-- its settlement in the same transaction book each run's top-up once. An
-- attempt recorded later still counts on top, which only overstates. The
-- top-up is dated when the job books it, so it never lands in a month that
-- may be closed already.
create function app_private.settle_stale_ai_runs()
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_run public.ai_runs;
  v_item record;
  v_recorded bigint;
begin
  -- A run the harness is settling right now is skipped; the next run of the job takes it.
  for v_run in
    select * from public.ai_runs run
    where run.status = 'reserved' and run.created_at <= now() - interval '15 minutes'
    for update skip locked
  loop
    select coalesce(sum(attempt.cost_micro_usd), 0) into v_recorded from public.ai_run_attempts attempt
    where attempt.run_id = v_run.id and attempt.organization_id = v_run.organization_id;
    if v_run.reserved_micro_usd > v_recorded then
      insert into public.ai_run_attempts (
        organization_id, run_id, idempotency_key, model_id, prompt_version, input_tokens,
        output_tokens, cache_read_tokens, cache_write_tokens, cost_micro_usd, outcome
      ) values (
        v_run.organization_id, v_run.id, 'provisional:' || v_run.id::text, 'unrecorded', 'unrecorded',
        0, 0, 0, 0, v_run.reserved_micro_usd - v_recorded, 'provisional_charge'
      );
    end if;
    update public.ai_runs run
    set status = 'failed', settled_at = now()
    where run.id = v_run.id and run.organization_id = v_run.organization_id;
  end loop;

  for v_item in
    select item.id, item.organization_id from public.ai_thread_items item
    where item.status = 'streaming' and item.kind = 'assistant_message'
      and item.created_at <= now() - interval '15 minutes'
    for update skip locked
  loop
    perform app_private.abandon_ai_answer(v_item.organization_id, v_item.id);
  end loop;
end;
$$;
revoke all on function app_private.settle_stale_ai_runs() from public, anon, authenticated, service_role;

select cron.schedule('werkflow-ai-stale-runs', '*/5 * * * *', 'select app_private.settle_stale_ai_runs()');
