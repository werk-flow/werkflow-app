-- WerkFlow KI storage (migration 20270111100006, werk-flow/werkflow-planning#527):
-- client roles reach no function and write no table; items take the thread's
-- next sequence once per idempotency key; a reservation refuses when the
-- organization is off, over its budget or undecidable; the daily job deletes
-- only items older than 12 months and the threads they leave empty, and the ledger keeps its cost. Author-only
-- reads are in client_read_boundaries.sql. Runs in one transaction and rolls back.
begin;

-- Client roles execute no function; service_role writes only through them.
do $$
declare
  api_role text;
  signature text;
  ai_table text;
begin
  foreach signature in array array[
    'public.create_ai_thread(uuid, uuid, uuid, text)',
    'public.append_ai_thread_item(uuid, uuid, uuid, public.ai_thread_item_kind, public.ai_thread_item_status, jsonb, text)',
    'public.update_ai_thread_item(uuid, uuid, uuid, public.ai_thread_item_status, jsonb)',
    'public.reserve_ai_run(uuid, uuid, uuid, text, bigint)',
    'public.record_ai_run_attempt(uuid, uuid, text, text, text, integer, integer, integer, integer, bigint, text)',
    'public.settle_ai_run(uuid, uuid, public.ai_run_status)',
    'public.set_ai_organization_enabled(uuid, uuid, boolean)'
  ] loop
    foreach api_role in array array['anon', 'authenticated'] loop
      if has_function_privilege(api_role, signature, 'execute') then
        raise exception 'A client role may execute an AI write: % by %', signature, api_role;
      end if;
    end loop;
    if not has_function_privilege('service_role', signature, 'execute') then
      raise exception 'service_role lost execute on %', signature;
    end if;
  end loop;
  foreach ai_table in array array['ai_organization_settings', 'ai_threads', 'ai_thread_items', 'ai_runs',
      'ai_run_attempts'] loop
    foreach api_role in array array['anon', 'authenticated', 'service_role'] loop
      if has_table_privilege(api_role, 'public.' || ai_table, 'INSERT,UPDATE,DELETE,TRUNCATE') then
        raise exception 'A role may write an AI table directly: % by %', ai_table, api_role;
      end if;
    end loop;
    if has_table_privilege('anon', 'public.' || ai_table, 'SELECT') then
      raise exception 'anon may read %', ai_table;
    end if;
  end loop;
  foreach ai_table in array array['ai_runs', 'ai_run_attempts'] loop
    if has_table_privilege('authenticated', 'public.' || ai_table, 'SELECT') then
      raise exception 'A client reads the server-only table %', ai_table;
    end if;
  end loop;
  -- Admins read the switch for their live card, never the budget or its writer.
  if has_column_privilege('authenticated', 'public.ai_organization_settings', 'monthly_budget_micro_eur', 'SELECT')
    or has_column_privilege('authenticated', 'public.ai_organization_settings', 'updated_by', 'SELECT')
    or not has_column_privilege('authenticated', 'public.ai_organization_settings', 'enabled', 'SELECT') then
    raise exception 'A client reads the budget or the writer of the WerkFlow KI switch, or not the switch';
  end if;
  if not exists (select 1 from cron.job where jobname = 'werkflow-ai-thread-retention') then
    raise exception 'The daily AI thread retention job is not scheduled';
  end if;
end;
$$;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
('ae000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'ai-admin@example.test', '', now(), '{}',
 '{"first_name":"Admin","last_name":"KI"}', now(), now()),
('ae000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'ai-buero@example.test', '', now(), '{}',
 '{"first_name":"Buero","last_name":"KI"}', now(), now()),
('ae000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'ai-foreign@example.test', '', now(), '{}',
 '{"first_name":"Fremd","last_name":"KI"}', now(), now());

insert into public.organizations (id, name, admin_id, unique_code) values
('ae000000-0000-4000-8000-000000000010', 'KI SQL', 'ae000000-0000-4000-8000-000000000001', 'AISQL1'),
('ae000000-0000-4000-8000-000000000011', 'KI Fremd', 'ae000000-0000-4000-8000-000000000003', 'AISQL2');
insert into public.organization_members (organization_id, user_id, role) values
('ae000000-0000-4000-8000-000000000010', 'ae000000-0000-4000-8000-000000000002', 'buero');

set local role service_role;

-- The admin switch: Büro and a foreign admin are refused; the admin sets it.
do $$
begin
  begin
    perform public.set_ai_organization_enabled('ae000000-0000-4000-8000-000000000010',
      'ae000000-0000-4000-8000-000000000002', true);
    raise exception 'Büro switched WerkFlow KI on';
  exception when others then
    if sqlerrm is distinct from 'ai_setting_not_admin' then raise; end if;
  end;
  begin
    perform public.set_ai_organization_enabled('ae000000-0000-4000-8000-000000000010',
      'ae000000-0000-4000-8000-000000000003', true);
    raise exception 'A foreign admin switched WerkFlow KI on';
  exception when others then
    if sqlerrm is distinct from 'ai_setting_not_admin' then raise; end if;
  end;
end;
$$;

-- Items take the next sequence; a repeated key returns its item and takes none.
do $$
declare
  first_item record;
  repeated_item record;
  second_item record;
begin
  perform public.create_ai_thread('ae000000-0000-4000-8000-000000000010', 'ae000000-0000-4000-8000-000000000002',
    'ae000000-0000-4000-8000-000000000020', 'Lieferschein lesen');
  -- A repeated create keeps the one thread.
  perform public.create_ai_thread('ae000000-0000-4000-8000-000000000010', 'ae000000-0000-4000-8000-000000000002',
    'ae000000-0000-4000-8000-000000000020', 'Lieferschein lesen');
  select * into first_item from public.append_ai_thread_item('ae000000-0000-4000-8000-000000000010',
    'ae000000-0000-4000-8000-000000000002', 'ae000000-0000-4000-8000-000000000020', 'user_message', 'complete',
    '{"text":"Hallo"}', 'turn-1');
  select * into repeated_item from public.append_ai_thread_item('ae000000-0000-4000-8000-000000000010',
    'ae000000-0000-4000-8000-000000000002', 'ae000000-0000-4000-8000-000000000020', 'user_message', 'complete',
    '{"text":"Hallo"}', 'turn-1');
  select * into second_item from public.append_ai_thread_item('ae000000-0000-4000-8000-000000000010',
    'ae000000-0000-4000-8000-000000000002', 'ae000000-0000-4000-8000-000000000020', 'assistant_message',
    'streaming', '{"text":""}', 'turn-1-answer');
  if first_item.item_sequence is distinct from 1::bigint or second_item.item_sequence is distinct from 2::bigint then
    raise exception 'Items took sequences % and %, expected 1 and 2', first_item.item_sequence,
      second_item.item_sequence;
  end if;
  if repeated_item.item_id is distinct from first_item.item_id
    or (select last_sequence from public.ai_threads where id = 'ae000000-0000-4000-8000-000000000020')
      is distinct from 2::bigint then
    raise exception 'A repeated idempotency key wrote a second item or took a sequence';
  end if;

  perform public.update_ai_thread_item('ae000000-0000-4000-8000-000000000010',
    'ae000000-0000-4000-8000-000000000002', second_item.item_id, 'complete', '{"text":"Gern."}');
  begin
    perform public.update_ai_thread_item('ae000000-0000-4000-8000-000000000010',
      'ae000000-0000-4000-8000-000000000002', second_item.item_id, 'streaming', '{"text":"anders"}');
    raise exception 'A finished item changed';
  exception when others then
    if sqlerrm is distinct from 'ai_thread_item_finished' then raise; end if;
  end;

  -- Another person, the admin included, appends nothing to the thread.
  begin
    perform public.append_ai_thread_item('ae000000-0000-4000-8000-000000000010',
      'ae000000-0000-4000-8000-000000000001', 'ae000000-0000-4000-8000-000000000020', 'user_message', 'complete',
      '{"text":"Fremd"}', 'admin-turn');
    raise exception 'The admin appended to another person''s thread';
  exception when others then
    if sqlerrm is distinct from 'ai_thread_not_found' then raise; end if;
  end;
  -- A thread id from the foreign organization is not found there.
  begin
    perform public.append_ai_thread_item('ae000000-0000-4000-8000-000000000011',
      'ae000000-0000-4000-8000-000000000003', 'ae000000-0000-4000-8000-000000000020', 'user_message', 'complete',
      '{"text":"Fremd"}', 'foreign-turn');
    raise exception 'A foreign member appended to another organization''s thread';
  exception when others then
    if sqlerrm is distinct from 'ai_thread_not_found' then raise; end if;
  end;
  -- The body is byte-capped.
  begin
    perform public.append_ai_thread_item('ae000000-0000-4000-8000-000000000010',
      'ae000000-0000-4000-8000-000000000002', 'ae000000-0000-4000-8000-000000000020', 'user_message', 'complete',
      jsonb_build_object('text', repeat('x', 70000)), 'too-long');
    raise exception 'An item over the byte cap was written';
  exception when check_violation then null;
  end;
end;
$$;

-- Reservations: off by default, refused when undecidable, refused over budget.
do $$
declare
  reservation record;
  repeated record;
  cost bigint;
begin
  select * into reservation from public.reserve_ai_run('ae000000-0000-4000-8000-000000000010',
    'ae000000-0000-4000-8000-000000000002', 'ae000000-0000-4000-8000-000000000020', 'run-off', 1000000);
  if reservation.verdict is distinct from 'disabled' or reservation.run_id is not null then
    raise exception 'An organization nobody switched on reserved a run: %', reservation.verdict;
  end if;

  -- Each save takes the next revision, which the admin's card waits for.
  if (select saved.revision from public.set_ai_organization_enabled('ae000000-0000-4000-8000-000000000010',
      'ae000000-0000-4000-8000-000000000001', true) saved) is distinct from 1::bigint then
    raise exception 'The first save did not take revision 1';
  end if;
  if (select saved.revision from public.set_ai_organization_enabled('ae000000-0000-4000-8000-000000000010',
      'ae000000-0000-4000-8000-000000000001', true) saved) is distinct from 2::bigint then
    raise exception 'A second save did not take the next revision';
  end if;
  if (select monthly_budget_micro_eur from public.ai_organization_settings
      where organization_id = 'ae000000-0000-4000-8000-000000000010') is distinct from 50000000::bigint then
    raise exception 'The default budget is not EUR 50 a month';
  end if;

  begin
    perform public.reserve_ai_run('ae000000-0000-4000-8000-000000000010',
      'ae000000-0000-4000-8000-000000000002', 'ae000000-0000-4000-8000-000000000020', 'run-zero', 0);
    raise exception 'A reservation without an amount was decided';
  exception when others then
    if sqlerrm is distinct from 'ai_reservation_invalid' then raise; end if;
  end;
  begin
    perform public.reserve_ai_run('ae000000-0000-4000-8000-000000000010',
      'ae000000-0000-4000-8000-000000000002', 'ae000000-0000-4000-8000-000000000020', 'run-null', null);
    raise exception 'A reservation with an unknown amount was decided';
  exception when others then
    if sqlerrm is distinct from 'ai_reservation_invalid' then raise; end if;
  end;

  -- EUR 40 held by an open run, EUR 15 more is over EUR 50.
  select * into reservation from public.reserve_ai_run('ae000000-0000-4000-8000-000000000010',
    'ae000000-0000-4000-8000-000000000002', 'ae000000-0000-4000-8000-000000000020', 'run-1', 40000000);
  select * into repeated from public.reserve_ai_run('ae000000-0000-4000-8000-000000000010',
    'ae000000-0000-4000-8000-000000000002', 'ae000000-0000-4000-8000-000000000020', 'run-1', 40000000);
  if reservation.verdict is distinct from 'reserved' or repeated.verdict is distinct from 'replayed'
    or repeated.run_id is distinct from reservation.run_id then
    raise exception 'A repeated reservation key did not replay its run: % %', reservation.verdict, repeated.verdict;
  end if;
  -- The key names this author, thread and amount only.
  begin
    perform public.reserve_ai_run('ae000000-0000-4000-8000-000000000010',
      'ae000000-0000-4000-8000-000000000002', 'ae000000-0000-4000-8000-000000000020', 'run-1', 1);
    raise exception 'A reservation key replayed for another amount';
  exception when others then
    if sqlerrm is distinct from 'ai_reservation_key_conflict' then raise; end if;
  end;
  if (select verdict from public.reserve_ai_run('ae000000-0000-4000-8000-000000000010',
      'ae000000-0000-4000-8000-000000000002', 'ae000000-0000-4000-8000-000000000020', 'run-2', 15000000))
      is distinct from 'budget_exhausted' then
    raise exception 'A reservation over the budget was granted';
  end if;

  -- Settled at EUR 3 real cost, recorded once although the attempt repeated.
  perform public.record_ai_run_attempt('ae000000-0000-4000-8000-000000000010', reservation.run_id, 'run-1:1',
    'claude-haiku', 'prompt-v1', 1000, 200, 0, 0, 3000000, 'succeeded');
  perform public.record_ai_run_attempt('ae000000-0000-4000-8000-000000000010', reservation.run_id, 'run-1:1',
    'claude-haiku', 'prompt-v1', 1000, 200, 0, 0, 3000000, 'succeeded');
  cost := public.settle_ai_run('ae000000-0000-4000-8000-000000000010', reservation.run_id, 'succeeded');
  if cost is distinct from 3000000::bigint then
    raise exception 'The run settled at % micro-USD, expected 3000000', cost;
  end if;
  -- A settled run's key authorizes nothing more.
  begin
    perform public.reserve_ai_run('ae000000-0000-4000-8000-000000000010',
      'ae000000-0000-4000-8000-000000000002', 'ae000000-0000-4000-8000-000000000020', 'run-1', 40000000);
    raise exception 'A settled run was replayed';
  exception when others then
    if sqlerrm is distinct from 'ai_run_closed' then raise; end if;
  end;

  -- EUR 3 spent: EUR 47 fits, EUR 47.01 does not.
  if (select verdict from public.reserve_ai_run('ae000000-0000-4000-8000-000000000010',
      'ae000000-0000-4000-8000-000000000002', 'ae000000-0000-4000-8000-000000000020', 'run-3', 47010000))
      is distinct from 'budget_exhausted' then
    raise exception 'A reservation over the remaining budget was granted';
  end if;
  if (select verdict from public.reserve_ai_run('ae000000-0000-4000-8000-000000000010',
      'ae000000-0000-4000-8000-000000000002', 'ae000000-0000-4000-8000-000000000020', 'run-4', 47000000))
      is distinct from 'reserved' then
    raise exception 'The remaining budget was refused';
  end if;

  -- A foreign organization's run is not found in its own.
  begin
    perform public.settle_ai_run('ae000000-0000-4000-8000-000000000011', reservation.run_id, 'failed');
    raise exception 'A run settled through another organization';
  exception when others then
    if sqlerrm is distinct from 'ai_run_not_found' then raise; end if;
  end;
  begin
    perform public.record_ai_run_attempt('ae000000-0000-4000-8000-000000000011', reservation.run_id, 'foreign:1',
      'claude-haiku', 'prompt-v1', 1, 1, 0, 0, 1, 'succeeded');
    raise exception 'An attempt was recorded through another organization';
  exception when others then
    if sqlerrm is distinct from 'ai_run_not_found' then raise; end if;
  end;
end;
$$;

reset role;

-- The ledger's denials are proved in security_boundaries.sql.

-- Boundaries of the budget, each at its exact edge: a hold lapses when its
-- run is 15 minutes old while its recorded cost still counts, an attempt at
-- the first instant of the Berlin month counts, and one a microsecond
-- earlier counts no more.
set local role service_role;
select public.set_ai_organization_enabled('ae000000-0000-4000-8000-000000000011',
  'ae000000-0000-4000-8000-000000000003', true);
select public.create_ai_thread('ae000000-0000-4000-8000-000000000011', 'ae000000-0000-4000-8000-000000000003',
  'ae000000-0000-4000-8000-000000000021', 'Grenzen');
reset role;
insert into public.ai_runs (id, organization_id, thread_id, user_id, idempotency_key, reserved_micro_usd, created_at)
values ('ae000000-0000-4000-8000-000000000041', 'ae000000-0000-4000-8000-000000000011',
  'ae000000-0000-4000-8000-000000000021', 'ae000000-0000-4000-8000-000000000003', 'lapsed-run', 50000000,
  now() - interval '15 minutes');
insert into public.ai_runs (id, organization_id, thread_id, user_id, idempotency_key, status, reserved_micro_usd,
  created_at, settled_at)
values ('ae000000-0000-4000-8000-000000000042', 'ae000000-0000-4000-8000-000000000011',
  'ae000000-0000-4000-8000-000000000021', 'ae000000-0000-4000-8000-000000000003', 'last-month-run', 'succeeded',
  50000000, now() - interval '40 days', now() - interval '40 days');
insert into public.ai_run_attempts (organization_id, run_id, idempotency_key, model_id, prompt_version,
  input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_micro_usd, outcome, created_at) values
('ae000000-0000-4000-8000-000000000011', 'ae000000-0000-4000-8000-000000000041', 'lapsed-run:1', 'claude-haiku',
 'prompt-v1', 10, 10, 0, 0, 10000000, 'succeeded', now()),
('ae000000-0000-4000-8000-000000000011', 'ae000000-0000-4000-8000-000000000042', 'last-month:1', 'claude-haiku',
 'prompt-v1', 10, 10, 0, 0, 50000000, 'succeeded',
 (date_trunc('month', now() at time zone 'Europe/Berlin') at time zone 'Europe/Berlin') - interval '1 microsecond'),
('ae000000-0000-4000-8000-000000000011', 'ae000000-0000-4000-8000-000000000042', 'month-start:1', 'claude-haiku',
 'prompt-v1', 1, 1, 0, 0, 1000000, 'succeeded',
 date_trunc('month', now() at time zone 'Europe/Berlin') at time zone 'Europe/Berlin');
do $$
begin
  -- EUR 11 spent this month (the lapsed run's 10 and the month-start 1), the
  -- lapsed hold free, last month's EUR 50 gone: EUR 39 fits, a micro-euro more does not.
  if (select verdict from public.reserve_ai_run('ae000000-0000-4000-8000-000000000011',
      'ae000000-0000-4000-8000-000000000003', 'ae000000-0000-4000-8000-000000000021', 'over', 39000001))
      is distinct from 'budget_exhausted' then
    raise exception 'The recorded cost of a lapsed run or the attempt at the month start did not count';
  end if;
  if (select verdict from public.reserve_ai_run('ae000000-0000-4000-8000-000000000011',
      'ae000000-0000-4000-8000-000000000003', 'ae000000-0000-4000-8000-000000000021', 'fits', 39000000))
      is distinct from 'reserved' then
    raise exception 'A hold 15 minutes old or last month''s spend still blocked the budget';
  end if;
end;
$$;

-- Retention: an old thread with only old items goes; a thread with a young
-- item keeps it and loses the old one; the run loses its thread but the ledger
-- keeps its cost.
insert into public.ai_threads (id, organization_id, user_id, title, last_sequence, created_at) values
('ae000000-0000-4000-8000-000000000030', 'ae000000-0000-4000-8000-000000000010',
 'ae000000-0000-4000-8000-000000000002', 'Alt', 1, now() - interval '13 months'),
('ae000000-0000-4000-8000-000000000031', 'ae000000-0000-4000-8000-000000000010',
 'ae000000-0000-4000-8000-000000000002', 'Gemischt', 2, now() - interval '13 months');
insert into public.ai_thread_items (organization_id, thread_id, sequence, kind, status, idempotency_key, body, created_at)
values
('ae000000-0000-4000-8000-000000000010', 'ae000000-0000-4000-8000-000000000030', 1, 'user_message', 'complete',
 'old', '{"text":"alt"}', now() - interval '12 months 1 day'),
('ae000000-0000-4000-8000-000000000010', 'ae000000-0000-4000-8000-000000000031', 1, 'user_message', 'complete',
 'old', '{"text":"alt"}', now() - interval '12 months 1 day'),
('ae000000-0000-4000-8000-000000000010', 'ae000000-0000-4000-8000-000000000031', 2, 'user_message', 'complete',
 'young', '{"text":"jung"}', now() - interval '11 months');
insert into public.ai_runs (id, organization_id, thread_id, user_id, idempotency_key, status, reserved_micro_usd,
  created_at, settled_at) values
('ae000000-0000-4000-8000-000000000040', 'ae000000-0000-4000-8000-000000000010',
 'ae000000-0000-4000-8000-000000000030', 'ae000000-0000-4000-8000-000000000002', 'old-run', 'succeeded', 100,
 now() - interval '13 months', now() - interval '13 months');
insert into public.ai_run_attempts (organization_id, run_id, idempotency_key, model_id, prompt_version,
  input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_micro_usd, outcome, created_at) values
('ae000000-0000-4000-8000-000000000010', 'ae000000-0000-4000-8000-000000000040', 'old-run:1', 'claude-haiku',
 'prompt-v1', 10, 10, 0, 0, 77, 'succeeded', now() - interval '13 months');

select app_private.delete_expired_ai_thread_items();

do $$
begin
  if exists (select 1 from public.ai_threads where id = 'ae000000-0000-4000-8000-000000000030') then
    raise exception 'A thread whose items all expired stayed';
  end if;
  if (select string_agg(idempotency_key, ',' order by idempotency_key) from public.ai_thread_items
      where thread_id = 'ae000000-0000-4000-8000-000000000031') is distinct from 'young' then
    raise exception 'Retention did not delete exactly the item older than 12 months';
  end if;
  if (select count(*) from public.ai_thread_items where thread_id = 'ae000000-0000-4000-8000-000000000020')
      is distinct from 2::bigint then
    raise exception 'Retention deleted a young thread''s items';
  end if;
  if (select thread_id from public.ai_runs where id = 'ae000000-0000-4000-8000-000000000040') is not null then
    raise exception 'A run kept the reference to a deleted thread';
  end if;
  if (select cost_micro_usd from public.ai_run_attempts where idempotency_key = 'old-run:1'
      and organization_id = 'ae000000-0000-4000-8000-000000000010') is distinct from 77::bigint then
    raise exception 'Retention changed or removed a ledger row';
  end if;
end;
$$;

-- Deleting the organization cascades through the ledger.
delete from public.organizations where id = 'ae000000-0000-4000-8000-000000000011';
do $$
begin
  begin
    delete from public.organizations where id = 'ae000000-0000-4000-8000-000000000010';
  exception when others then
    -- Another table may refuse the deletion; the ledger must not be the reason.
    if sqlerrm = 'event_ledger_history_immutable' then
      raise exception 'The cost ledger blocked the organization''s deletion';
    end if;
    raise;
  end;
  if exists (select 1 from public.ai_run_attempts where organization_id = 'ae000000-0000-4000-8000-000000000010') then
    raise exception 'The organization''s deletion left ledger rows';
  end if;
end;
$$;

rollback;
