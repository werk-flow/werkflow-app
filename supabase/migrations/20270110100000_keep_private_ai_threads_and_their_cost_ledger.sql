-- WerkFlow KI, its storage (werk-flow/werkflow-planning#527, docs/features/ai-automations.md).
--
-- Threads and their typed items are private to their author: only the author
-- reads them, while their membership has effective access; no admin reads
-- another person's thread. Clients write nothing. The server writes through
-- the service-role functions below, each of which rechecks the actor.
--
-- Runs reserve budget before the first model step and settle after the last.
-- Their attempts are the cost ledger: one append-only row per provider attempt
-- with tokens and real cost in micro-USD, never text. The ledger keeps its ids
-- and cost when the thread goes; the run loses its thread reference.
--
-- An organization's admin switches WerkFlow KI on or off. It is off until
-- then. The monthly budget defaults to EUR 50 and is compared with the ledger's
-- USD at 1 USD = 1 EUR, which overstates cost, so the stop comes early.
--
-- A daily job deletes each item 12 months after it was written, and a thread
-- with no item left.

create type public.ai_thread_item_kind as enum (
  'user_message', 'assistant_message', 'tool_call', 'question', 'todo_list', 'file'
);
create type public.ai_thread_item_status as enum ('streaming', 'complete', 'failed', 'cancelled');
create type public.ai_run_status as enum ('reserved', 'succeeded', 'failed', 'cancelled');

create table public.ai_organization_settings (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  -- The row id a save returns, so the saving tab knows the Realtime echo as its own.
  id uuid not null unique default gen_random_uuid(),
  enabled boolean not null default false,
  -- The one constant of the default budget: EUR 50 a month (owner, O3).
  monthly_budget_micro_eur bigint not null default 50000000 check (monthly_budget_micro_eur > 0),
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);

create table public.ai_threads (
  id uuid primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null,
  title text check (title is null or char_length(title) between 1 and 200),
  last_sequence bigint not null default 0 check (last_sequence >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- The author's membership: a removed member's threads go with it.
  foreign key (user_id, organization_id)
    references public.organization_members (user_id, organization_id) on delete cascade,
  unique (id, organization_id)
);

create index ai_threads_author_idx on public.ai_threads (organization_id, user_id, updated_at desc);
create index ai_threads_created_at_idx on public.ai_threads (created_at);

create table public.ai_thread_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  thread_id uuid not null,
  sequence bigint not null check (sequence > 0),
  kind public.ai_thread_item_kind not null,
  status public.ai_thread_item_status not null,
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 200),
  body jsonb not null check (jsonb_typeof(body) = 'object' and octet_length(body::text) <= 65536),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (thread_id, organization_id)
    references public.ai_threads (id, organization_id) on delete cascade,
  unique (thread_id, sequence),
  unique (thread_id, idempotency_key)
);

create index ai_thread_items_created_at_idx on public.ai_thread_items (created_at);

create table public.ai_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  thread_id uuid,
  user_id uuid references public.profiles (id) on delete set null,
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 200),
  status public.ai_run_status not null default 'reserved',
  reserved_micro_usd bigint not null check (reserved_micro_usd > 0),
  created_at timestamptz not null default now(),
  settled_at timestamptz,
  check ((status = 'reserved') = (settled_at is null)),
  foreign key (thread_id, organization_id)
    references public.ai_threads (id, organization_id) on delete set null (thread_id),
  unique (organization_id, idempotency_key),
  unique (id, organization_id)
);

create index ai_runs_open_idx on public.ai_runs (organization_id) where status = 'reserved';
create index ai_runs_thread_idx on public.ai_runs (thread_id);
create index ai_runs_user_idx on public.ai_runs (user_id);

create table public.ai_run_attempts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  run_id uuid not null,
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 200),
  model_id text not null check (char_length(model_id) between 1 and 100),
  prompt_version text not null check (char_length(prompt_version) between 1 and 100),
  input_tokens integer not null check (input_tokens >= 0),
  output_tokens integer not null check (output_tokens >= 0),
  cache_read_tokens integer not null check (cache_read_tokens >= 0),
  cache_write_tokens integer not null check (cache_write_tokens >= 0),
  cost_micro_usd bigint not null check (cost_micro_usd >= 0),
  -- A stable code, never provider text.
  outcome text not null check (outcome ~ '^[a-z][a-z0-9_]{0,62}$'),
  created_at timestamptz not null default now(),
  foreign key (run_id, organization_id)
    references public.ai_runs (id, organization_id) on delete cascade,
  unique (organization_id, idempotency_key)
);

create index ai_run_attempts_month_idx on public.ai_run_attempts (organization_id, created_at);
create index ai_run_attempts_run_idx on public.ai_run_attempts (run_id);

create trigger ai_organization_settings_updated_at before update on public.ai_organization_settings
  for each row execute function public.update_updated_at_column();

-- Realtime (docs/technical/realtime-and-caching.md, "Add Realtime data"): the
-- switch is its own owning root. Its primary key is organization_id, so the
-- default replica identity is already minimal. Chat tables stay unpublished.
create trigger emit_realtime_deletion after delete on public.ai_organization_settings
  for each row execute function app_private.emit_realtime_deletion();
alter publication supabase_realtime add table public.ai_organization_settings;

-- The ledger refuses UPDATE and DELETE; only the organization's deletion
-- cascades through it.
create trigger guard_event_ledger_history before update or delete on public.ai_run_attempts
  for each row execute function app_private.guard_event_ledger_history();

alter table public.ai_organization_settings enable row level security;
alter table public.ai_threads enable row level security;
alter table public.ai_thread_items enable row level security;
alter table public.ai_runs enable row level security;
alter table public.ai_run_attempts enable row level security;

-- The author alone reads, while their membership has effective access.
create policy ai_threads_select_author on public.ai_threads
  for select to authenticated
  using (
    user_id = (select auth.uid())
    and organization_id in (select app_private.get_user_org_ids((select auth.uid())))
  );
create policy ai_thread_items_select_author on public.ai_thread_items
  for select to authenticated
  using (
    organization_id in (select app_private.get_user_org_ids((select auth.uid())))
    and exists (
      select 1 from public.ai_threads thread
      where thread.id = ai_thread_items.thread_id
        and thread.organization_id = ai_thread_items.organization_id
        and thread.user_id = (select auth.uid())
    )
  );

revoke all on table public.ai_organization_settings, public.ai_threads, public.ai_thread_items,
  public.ai_runs, public.ai_run_attempts from public, anon, authenticated, service_role;
grant select on table public.ai_threads, public.ai_thread_items to authenticated;
-- The admin's open card follows a change from another session through
-- Realtime, so admins read the switch; the budget and its writer stay hidden.
create policy ai_organization_settings_select_admin on public.ai_organization_settings
  for select to authenticated
  using (organization_id in (select app_private.get_user_admin_org_ids((select auth.uid()))));
grant select (id, organization_id, enabled, updated_at) on table public.ai_organization_settings to authenticated;
grant select on table public.ai_organization_settings, public.ai_threads, public.ai_thread_items,
  public.ai_runs, public.ai_run_attempts to service_role;

-- Whether the user acts in the organization now, and whether the thread is theirs.
create function app_private.assert_ai_thread_author(
  p_organization_id uuid,
  p_user_id uuid,
  p_thread_id uuid
)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not app_private.p1_24_has_effective_access(p_organization_id, p_user_id) then
    raise exception 'ai_actor_without_access';
  end if;
  if not exists (
    select 1 from public.ai_threads thread
    where thread.id = p_thread_id and thread.organization_id = p_organization_id
      and thread.user_id = p_user_id
  ) then
    raise exception 'ai_thread_not_found';
  end if;
end;
$$;
revoke all on function app_private.assert_ai_thread_author(uuid, uuid, uuid) from public, anon, authenticated;

-- Creates the author's thread under the id the client chose, so the page can
-- navigate to it once it is saved. A repeat with the same id returns it.
create function public.create_ai_thread(
  p_organization_id uuid,
  p_user_id uuid,
  p_thread_id uuid,
  p_title text
)
returns uuid language plpgsql security definer set search_path = '' as $$
begin
  if not app_private.p1_24_has_effective_access(p_organization_id, p_user_id) then
    raise exception 'ai_actor_without_access';
  end if;
  insert into public.ai_threads (id, organization_id, user_id, title)
  values (p_thread_id, p_organization_id, p_user_id, p_title)
  on conflict (id) do nothing;
  perform app_private.assert_ai_thread_author(p_organization_id, p_user_id, p_thread_id);
  return p_thread_id;
end;
$$;

-- Appends a typed item with the thread's next sequence. A repeat with the same
-- idempotency key returns the item it wrote and takes no new sequence.
create function public.append_ai_thread_item(
  p_organization_id uuid,
  p_user_id uuid,
  p_thread_id uuid,
  p_kind public.ai_thread_item_kind,
  p_status public.ai_thread_item_status,
  p_body jsonb,
  p_idempotency_key text
)
returns table (item_id uuid, item_sequence bigint)
language plpgsql security definer set search_path = '' as $$
declare
  v_sequence bigint;
begin
  perform app_private.assert_ai_thread_author(p_organization_id, p_user_id, p_thread_id);
  -- The thread row lock orders concurrent appends.
  select thread.last_sequence into v_sequence from public.ai_threads thread
  where thread.id = p_thread_id and thread.organization_id = p_organization_id
  for update;

  return query
    select item.id, item.sequence from public.ai_thread_items item
    where item.thread_id = p_thread_id and item.idempotency_key = p_idempotency_key;
  if found then return; end if;

  update public.ai_threads thread
  set last_sequence = v_sequence + 1, updated_at = now()
  where thread.id = p_thread_id and thread.organization_id = p_organization_id;

  return query
    insert into public.ai_thread_items as item (
      organization_id, thread_id, sequence, kind, status, idempotency_key, body
    ) values (
      p_organization_id, p_thread_id, v_sequence + 1, p_kind, p_status, p_idempotency_key, p_body
    )
    returning item.id, item.sequence;
end;
$$;

-- Saves a streaming item's partial body or finishes it. A finished item no
-- longer changes.
create function public.update_ai_thread_item(
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
begin
  select item.thread_id, item.status into v_thread_id, v_status from public.ai_thread_items item
  where item.id = p_item_id and item.organization_id = p_organization_id
  for update;
  if v_thread_id is null then raise exception 'ai_thread_item_not_found'; end if;
  perform app_private.assert_ai_thread_author(p_organization_id, p_user_id, v_thread_id);
  if v_status <> 'streaming' then raise exception 'ai_thread_item_finished'; end if;

  update public.ai_thread_items item
  set status = p_status, body = p_body, updated_at = now()
  where item.id = p_item_id and item.organization_id = p_organization_id;
end;
$$;

-- Reserves the run's most expensive outcome before its first model step.
-- Verdicts: 'reserved' (a new run), 'replayed' (the same author, thread and
-- amount asked with the same key while that run still holds its budget),
-- 'disabled' (no admin switched WerkFlow KI on) and 'budget_exhausted' (this
-- Berlin month's ledger plus the open holds plus this reservation exceed the
-- budget). A hold lapses 15 minutes after its run began, so a run that died
-- unsettled frees the budget; its recorded attempts still count. A key that
-- names another author, thread or amount, or a closed run, is refused. Any
-- error, a lock wait over its timeout included, is a refusal for the caller.
create function public.reserve_ai_run(
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
  -- month's spend, and as recorded cost against its run's open hold.
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
        and run.created_at > now() - interval '15 minutes'
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

-- Records one provider attempt at its real cost, also after the run settled:
-- money spent is always counted. A repeat with the same idempotency key
-- returns the recorded attempt, so a retry never charges twice.
create function public.record_ai_run_attempt(
  p_organization_id uuid,
  p_run_id uuid,
  p_idempotency_key text,
  p_model_id text,
  p_prompt_version text,
  p_input_tokens integer,
  p_output_tokens integer,
  p_cache_read_tokens integer,
  p_cache_write_tokens integer,
  p_cost_micro_usd bigint,
  p_outcome text
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_attempt_id uuid;
begin
  if not exists (
    select 1 from public.ai_runs run
    where run.id = p_run_id and run.organization_id = p_organization_id
  ) then
    raise exception 'ai_run_not_found';
  end if;

  insert into public.ai_run_attempts (
    organization_id, run_id, idempotency_key, model_id, prompt_version, input_tokens,
    output_tokens, cache_read_tokens, cache_write_tokens, cost_micro_usd, outcome
  ) values (
    p_organization_id, p_run_id, p_idempotency_key, p_model_id, p_prompt_version, p_input_tokens,
    p_output_tokens, p_cache_read_tokens, p_cache_write_tokens, p_cost_micro_usd, p_outcome
  )
  on conflict (organization_id, idempotency_key) do nothing
  returning id into v_attempt_id;
  if v_attempt_id is not null then return v_attempt_id; end if;

  select attempt.id into v_attempt_id from public.ai_run_attempts attempt
  where attempt.organization_id = p_organization_id and attempt.idempotency_key = p_idempotency_key
    and attempt.run_id = p_run_id;
  if v_attempt_id is null then raise exception 'ai_attempt_key_conflict'; end if;
  return v_attempt_id;
end;
$$;

-- Ends the run's hold and returns its real cost from the ledger. A repeat
-- returns the cost again and keeps the first end state. The caller records
-- every attempt before it settles: settling declares the run's accounting
-- complete and frees its hold, and an attempt recorded later still counts
-- in the month but was not held.
create function public.settle_ai_run(
  p_organization_id uuid,
  p_run_id uuid,
  p_status public.ai_run_status
)
returns bigint language plpgsql security definer set search_path = '' as $$
begin
  if p_status is null or p_status = 'reserved' then raise exception 'ai_settlement_invalid'; end if;
  update public.ai_runs run
  set status = p_status, settled_at = now()
  where run.id = p_run_id and run.organization_id = p_organization_id and run.status = 'reserved';
  if not found and not exists (
    select 1 from public.ai_runs run where run.id = p_run_id and run.organization_id = p_organization_id
  ) then
    raise exception 'ai_run_not_found';
  end if;

  return (
    select coalesce(sum(attempt.cost_micro_usd), 0) from public.ai_run_attempts attempt
    where attempt.run_id = p_run_id and attempt.organization_id = p_organization_id
  );
end;
$$;

-- The admin's switch. Only an admin with effective access sets it. Returns
-- the row's id and write stamp, which name the save's Realtime echo.
create function public.set_ai_organization_enabled(
  p_organization_id uuid,
  p_actor_id uuid,
  p_enabled boolean
)
returns table (id uuid, enabled boolean, updated_at timestamptz)
language plpgsql security definer set search_path = '' as $$
begin
  if p_enabled is null then raise exception 'ai_setting_invalid'; end if;
  if not exists (
    select 1 from public.organization_members member
    where member.organization_id = p_organization_id and member.user_id = p_actor_id
      and member.role = 'admin'
  ) or not app_private.p1_24_has_effective_access(p_organization_id, p_actor_id) then
    raise exception 'ai_setting_not_admin';
  end if;

  return query
    insert into public.ai_organization_settings as settings (organization_id, enabled, updated_by, updated_at)
    values (p_organization_id, p_enabled, p_actor_id, now())
    on conflict (organization_id) do update
      set enabled = excluded.enabled, updated_by = excluded.updated_by, updated_at = excluded.updated_at
    returning settings.id, settings.enabled, settings.updated_at;
end;
$$;

revoke all on function public.create_ai_thread(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.append_ai_thread_item(uuid, uuid, uuid, public.ai_thread_item_kind,
  public.ai_thread_item_status, jsonb, text) from public, anon, authenticated;
revoke all on function public.update_ai_thread_item(uuid, uuid, uuid, public.ai_thread_item_status, jsonb)
  from public, anon, authenticated;
revoke all on function public.reserve_ai_run(uuid, uuid, uuid, text, bigint) from public, anon, authenticated;
revoke all on function public.record_ai_run_attempt(uuid, uuid, text, text, text, integer, integer, integer,
  integer, bigint, text) from public, anon, authenticated;
revoke all on function public.settle_ai_run(uuid, uuid, public.ai_run_status) from public, anon, authenticated;
revoke all on function public.set_ai_organization_enabled(uuid, uuid, boolean) from public, anon, authenticated;

grant execute on function public.create_ai_thread(uuid, uuid, uuid, text) to service_role;
grant execute on function public.append_ai_thread_item(uuid, uuid, uuid, public.ai_thread_item_kind,
  public.ai_thread_item_status, jsonb, text) to service_role;
grant execute on function public.update_ai_thread_item(uuid, uuid, uuid, public.ai_thread_item_status, jsonb)
  to service_role;
grant execute on function public.reserve_ai_run(uuid, uuid, uuid, text, bigint) to service_role;
grant execute on function public.record_ai_run_attempt(uuid, uuid, text, text, text, integer, integer, integer,
  integer, bigint, text) to service_role;
grant execute on function public.settle_ai_run(uuid, uuid, public.ai_run_status) to service_role;
grant execute on function public.set_ai_organization_enabled(uuid, uuid, boolean) to service_role;

-- Each item goes 12 months after it was written; a thread goes once it is that
-- old and holds no item. The ledger keeps its rows: runs lose their thread.
create function app_private.delete_expired_ai_thread_items()
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_cutoff timestamptz := now() - interval '12 months';
  v_thread_id uuid;
begin
  -- Thread before items, the order of an append and of a member's or the
  -- organization's deletion, so the job never deadlocks with them. A thread
  -- another transaction holds waits for the next day's run. After the lock,
  -- fresh statements see an append that committed meanwhile.
  for v_thread_id in
    select thread.id from public.ai_threads thread
    where exists (
        select 1 from public.ai_thread_items item
        where item.thread_id = thread.id and item.created_at < v_cutoff
      )
      or (thread.created_at < v_cutoff
        and not exists (select 1 from public.ai_thread_items item where item.thread_id = thread.id))
    for update skip locked
  loop
    delete from public.ai_thread_items item where item.thread_id = v_thread_id and item.created_at < v_cutoff;
    delete from public.ai_threads thread
    where thread.id = v_thread_id and thread.created_at < v_cutoff
      and not exists (select 1 from public.ai_thread_items item where item.thread_id = v_thread_id);
  end loop;
end;
$$;
revoke all on function app_private.delete_expired_ai_thread_items() from public, anon, authenticated, service_role;

select cron.schedule('werkflow-ai-thread-retention', '23 3 * * *',
  'select app_private.delete_expired_ai_thread_items()');
