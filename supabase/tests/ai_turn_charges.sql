-- WerkFlow KI keeps every charge (migration 20270311090001,
-- werk-flow/werkflow-planning#559): a turn starts in one call that writes
-- once per command; an open run counts at its reserved amount until it
-- settles; the job settles a stale run at its reserved amount and finishes
-- the answer it left streaming. Runs in one transaction and rolls back.
begin;

do $$
declare
  api_role text;
  signature text;
begin
  foreach api_role in array array['anon', 'authenticated'] loop
    if has_function_privilege(api_role, 'public.start_ai_turn(uuid, uuid, uuid, text, uuid, text, bigint)',
        'execute') then
      raise exception 'A client role may start a WerkFlow KI turn: %', api_role;
    end if;
  end loop;
  if not has_function_privilege('service_role', 'public.start_ai_turn(uuid, uuid, uuid, text, uuid, text, bigint)',
      'execute') then
    raise exception 'service_role lost execute on start_ai_turn';
  end if;
  foreach signature in array array['app_private.settle_stale_ai_runs()',
      'app_private.abandon_ai_answer(uuid, uuid)'] loop
    foreach api_role in array array['anon', 'authenticated', 'service_role'] loop
      if has_function_privilege(api_role, signature, 'execute') then
        raise exception 'A role may run the WerkFlow KI maintenance step %: %', signature, api_role;
      end if;
    end loop;
  end loop;
  if not exists (select 1 from cron.job where jobname = 'werkflow-ai-stale-runs') then
    raise exception 'The job that settles stale WerkFlow KI runs is not scheduled';
  end if;
end;
$$;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
('af000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'ai-charge-admin@example.test', '', now(), '{}',
 '{"first_name":"Admin","last_name":"Kosten"}', now(), now()),
('af000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'ai-charge-monteur@example.test', '', now(), '{}',
 '{"first_name":"Monteur","last_name":"Kosten"}', now(), now()),
('af000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'ai-charge-other@example.test', '', now(), '{}',
 '{"first_name":"Andere","last_name":"Kosten"}', now(), now());

insert into public.organizations (id, name, admin_id, unique_code) values
('af000000-0000-4000-8000-000000000010', 'KI Kosten A', 'af000000-0000-4000-8000-000000000001', 'AICHA1'),
('af000000-0000-4000-8000-000000000011', 'KI Kosten B', 'af000000-0000-4000-8000-000000000003', 'AICHA2');
-- The Monteur works in both organizations.
insert into public.organization_members (organization_id, user_id, role) values
('af000000-0000-4000-8000-000000000010', 'af000000-0000-4000-8000-000000000002', 'employee'),
('af000000-0000-4000-8000-000000000011', 'af000000-0000-4000-8000-000000000002', 'employee');

set local role service_role;
select public.set_ai_organization_enabled('af000000-0000-4000-8000-000000000010',
  'af000000-0000-4000-8000-000000000001', true);

-- A turn start writes once per command and keeps the message on every refusal.
do $$
declare
  first_start record;
  repeated record;
  -- Each start runs in its own statement: a read in the same statement would not see what it wrote.
  verdict text;
begin
  -- Organization B has not switched WerkFlow KI on: the message stays, nothing else is written.
  verdict := (select started.verdict from public.start_ai_turn('af000000-0000-4000-8000-000000000011',
    'af000000-0000-4000-8000-000000000002', 'af000000-0000-4000-8000-000000000021', 'Aus',
    'af000000-0000-4000-8000-000000000030', 'Hallo B', 1000000) started);
  if verdict is distinct from 'disabled' then
    raise exception 'A turn started in an organization that is off: %', verdict;
  end if;
  if (select string_agg(item.kind::text, ',') from public.ai_thread_items item
      where item.thread_id = 'af000000-0000-4000-8000-000000000021') is distinct from 'user_message'
    or exists (select 1 from public.ai_runs where organization_id = 'af000000-0000-4000-8000-000000000011') then
    raise exception 'A refused turn start lost the message or wrote more than it';
  end if;

  select * into first_start from public.start_ai_turn('af000000-0000-4000-8000-000000000010',
    'af000000-0000-4000-8000-000000000002', 'af000000-0000-4000-8000-000000000020', 'Lieferschein',
    'af000000-0000-4000-8000-000000000031', 'Lies den Lieferschein.', 1000000);
  if first_start.verdict is distinct from 'started' or first_start.run_id is null
    or first_start.user_item_sequence is distinct from 1::bigint
    or first_start.answer_item_sequence is distinct from 2::bigint then
    raise exception 'A turn did not start with its message and an empty answer: %', first_start.verdict;
  end if;
  if (select item.status::text || item.body::text from public.ai_thread_items item
      where item.id = first_start.answer_item_id) is distinct from 'streaming{"text": ""}' then
    raise exception 'The started answer is not an empty streaming answer';
  end if;
  if (select idempotency_key from public.ai_runs where id = first_start.run_id)
      is distinct from 'af000000-0000-4000-8000-000000000031' then
    raise exception 'The run is not keyed by the bare command id';
  end if;

  -- The same command again, while its run is open, writes nothing.
  select * into repeated from public.start_ai_turn('af000000-0000-4000-8000-000000000010',
    'af000000-0000-4000-8000-000000000002', 'af000000-0000-4000-8000-000000000020', 'Lieferschein',
    'af000000-0000-4000-8000-000000000031', 'Lies den Lieferschein.', 1000000);
  if repeated.verdict is distinct from 'run_active'
    or (select count(*) from public.ai_thread_items where thread_id = 'af000000-0000-4000-8000-000000000020')
      is distinct from 2::bigint
    or (select count(*) from public.ai_runs where organization_id = 'af000000-0000-4000-8000-000000000010')
      is distinct from 1::bigint then
    raise exception 'A replayed turn start wrote again: %', repeated.verdict;
  end if;
  -- The command id names one message: other text is refused and changes nothing.
  verdict := (select started.verdict from public.start_ai_turn('af000000-0000-4000-8000-000000000010',
    'af000000-0000-4000-8000-000000000002', 'af000000-0000-4000-8000-000000000020', 'Lieferschein',
    'af000000-0000-4000-8000-000000000031', 'Etwas anderes', 1000000) started);
  if verdict is distinct from 'command_conflict'
    or (select body ->> 'text' from public.ai_thread_items where id = first_start.user_item_id)
      is distinct from 'Lies den Lieferschein.' then
    raise exception 'A reused command id with other text was not refused, or changed the saved message';
  end if;

  -- One open run per person, also across organizations: the new message stays, no run starts.
  perform public.set_ai_organization_enabled('af000000-0000-4000-8000-000000000011',
    'af000000-0000-4000-8000-000000000003', true);
  verdict := (select started.verdict from public.start_ai_turn('af000000-0000-4000-8000-000000000011',
    'af000000-0000-4000-8000-000000000002', 'af000000-0000-4000-8000-000000000021', 'Aus',
    'af000000-0000-4000-8000-000000000032', 'Zweite Frage', 1000000) started);
  if verdict is distinct from 'run_active'
    or exists (select 1 from public.ai_runs where organization_id = 'af000000-0000-4000-8000-000000000011') then
    raise exception 'A person''s open run in another organization did not block a second run';
  end if;

  -- Another person's thread is not found, and the failed start writes nothing.
  begin
    perform public.start_ai_turn('af000000-0000-4000-8000-000000000011', 'af000000-0000-4000-8000-000000000003',
      'af000000-0000-4000-8000-000000000021', 'Fremd', 'af000000-0000-4000-8000-000000000033', 'Fremd', 1000000);
    raise exception 'A turn started in another person''s thread';
  exception when others then
    if sqlerrm is distinct from 'ai_thread_not_found' then raise; end if;
  end;
  if exists (select 1 from public.ai_thread_items where idempotency_key like 'af000000-0000-4000-8000-000000000033%') then
    raise exception 'A refused turn start left an item';
  end if;
  -- A person without access to the organization starts nothing.
  begin
    perform public.start_ai_turn('af000000-0000-4000-8000-000000000010', 'af000000-0000-4000-8000-000000000003',
      'af000000-0000-4000-8000-000000000022', 'Fremd', 'af000000-0000-4000-8000-000000000034', 'Fremd', 1000000);
    raise exception 'A foreign person started a turn';
  exception when others then
    if sqlerrm is distinct from 'ai_actor_without_access' then raise; end if;
  end;

  -- Once the run ended, the command has its answer: one left streaming is finished as interrupted with its text.
  perform public.update_ai_thread_item('af000000-0000-4000-8000-000000000010', 'af000000-0000-4000-8000-000000000002',
    first_start.answer_item_id, 'streaming', '{"text":"Ich lese"}');
  perform public.settle_ai_run('af000000-0000-4000-8000-000000000010', first_start.run_id, 'failed');
  verdict := (select started.verdict from public.start_ai_turn('af000000-0000-4000-8000-000000000010',
    'af000000-0000-4000-8000-000000000002', 'af000000-0000-4000-8000-000000000020', 'Lieferschein',
    'af000000-0000-4000-8000-000000000031', 'Lies den Lieferschein.', 1000000) started);
  if verdict is distinct from 'answered'
    or (select status::text || body::text from public.ai_thread_items where id = first_start.answer_item_id)
      is distinct from 'failed{"text": "Ich lese", "failure": "interrupted"}' then
    raise exception 'An answer its run left streaming was not finished as interrupted with its text';
  end if;
  -- A finished answer stays as it was.
  perform public.start_ai_turn('af000000-0000-4000-8000-000000000010', 'af000000-0000-4000-8000-000000000002',
    'af000000-0000-4000-8000-000000000020', 'Lieferschein', 'af000000-0000-4000-8000-000000000031',
    'Lies den Lieferschein.', 1000000);
  if (select body::text from public.ai_thread_items where id = first_start.answer_item_id)
      is distinct from '{"text": "Ich lese", "failure": "interrupted"}' then
    raise exception 'A finished answer changed';
  end if;
end;
$$;

-- An open run counts at its reserved amount until it settles, however old:
-- its provisional charge. Settling corrects it to its recorded cost.
reset role;
insert into public.ai_runs (id, organization_id, thread_id, user_id, idempotency_key, reserved_micro_usd, created_at)
values ('af000000-0000-4000-8000-000000000040', 'af000000-0000-4000-8000-000000000010',
  'af000000-0000-4000-8000-000000000020', 'af000000-0000-4000-8000-000000000002', 'unledgered-run', 40000000,
  now() - interval '20 minutes');
insert into public.ai_run_attempts (organization_id, run_id, idempotency_key, model_id, prompt_version,
  input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_micro_usd, outcome, created_at) values
('af000000-0000-4000-8000-000000000010', 'af000000-0000-4000-8000-000000000040', 'unledgered-run:1:0',
 'claude-haiku-5-5', 'prompt-v1', 10, 10, 0, 0, 1000000, 'completed', now() - interval '19 minutes');
set local role service_role;
do $$
begin
  -- EUR 40 held by the 20-minute-old run (EUR 1 of it recorded): EUR 15 more is over EUR 50.
  if (select verdict from public.start_ai_turn('af000000-0000-4000-8000-000000000010',
      'af000000-0000-4000-8000-000000000002', 'af000000-0000-4000-8000-000000000020', 'Lieferschein',
      'af000000-0000-4000-8000-000000000035', 'Dritte Frage', 15000000)) is distinct from 'budget_exhausted' then
    raise exception 'An open run older than 15 minutes stopped counting against the budget';
  end if;
  perform public.settle_ai_run('af000000-0000-4000-8000-000000000010', 'af000000-0000-4000-8000-000000000040',
    'succeeded');
  -- Settled at its recorded EUR 1, it frees the rest of its reservation.
  if (select verdict from public.start_ai_turn('af000000-0000-4000-8000-000000000010',
      'af000000-0000-4000-8000-000000000002', 'af000000-0000-4000-8000-000000000020', 'Lieferschein',
      'af000000-0000-4000-8000-000000000035', 'Dritte Frage', 15000000)) is distinct from 'started' then
    raise exception 'A settled run still held its reservation';
  end if;
end;
$$;

-- The job settles each run left open past 15 minutes at its reserved amount
-- and finishes the answers left streaming; live runs and answers stay.
reset role;
insert into public.ai_runs (id, organization_id, thread_id, user_id, idempotency_key, reserved_micro_usd, created_at)
values
('af000000-0000-4000-8000-000000000041', 'af000000-0000-4000-8000-000000000011',
 'af000000-0000-4000-8000-000000000021', 'af000000-0000-4000-8000-000000000002', 'stale-run', 30000000,
 now() - interval '15 minutes'),
('af000000-0000-4000-8000-000000000042', 'af000000-0000-4000-8000-000000000011',
 'af000000-0000-4000-8000-000000000021', 'af000000-0000-4000-8000-000000000002', 'stale-recorded-run', 2000000,
 now() - interval '16 minutes'),
('af000000-0000-4000-8000-000000000043', 'af000000-0000-4000-8000-000000000011',
 'af000000-0000-4000-8000-000000000021', 'af000000-0000-4000-8000-000000000002', 'live-run', 30000000,
 now() - interval '14 minutes 59 seconds');
insert into public.ai_run_attempts (organization_id, run_id, idempotency_key, model_id, prompt_version,
  input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_micro_usd, outcome) values
('af000000-0000-4000-8000-000000000011', 'af000000-0000-4000-8000-000000000041', 'stale-run:1:0',
 'claude-haiku-5-5', 'prompt-v1', 10, 10, 0, 0, 2000000, 'completed'),
('af000000-0000-4000-8000-000000000011', 'af000000-0000-4000-8000-000000000042', 'stale-recorded-run:1:0',
 'claude-haiku-5-5', 'prompt-v1', 10, 10, 0, 0, 2000000, 'completed');
insert into public.ai_threads (id, organization_id, user_id, title, last_sequence) values
('af000000-0000-4000-8000-000000000023', 'af000000-0000-4000-8000-000000000011',
 'af000000-0000-4000-8000-000000000002', 'Liegen geblieben', 3);
insert into public.ai_thread_items (id, organization_id, thread_id, sequence, kind, status, idempotency_key, body,
  created_at) values
('af000000-0000-4000-8000-000000000050', 'af000000-0000-4000-8000-000000000011',
 'af000000-0000-4000-8000-000000000023', 1, 'assistant_message', 'streaming', 'stale:assistant',
 '{"text":"Halb fertig"}', now() - interval '15 minutes'),
('af000000-0000-4000-8000-000000000051', 'af000000-0000-4000-8000-000000000011',
 'af000000-0000-4000-8000-000000000023', 2, 'assistant_message', 'complete', 'done:assistant',
 '{"text":"Fertig"}', now() - interval '20 minutes'),
('af000000-0000-4000-8000-000000000052', 'af000000-0000-4000-8000-000000000011',
 'af000000-0000-4000-8000-000000000023', 3, 'assistant_message', 'streaming', 'live:assistant',
 '{"text":"Läuft"}', now() - interval '14 minutes 59 seconds');

select app_private.settle_stale_ai_runs();
-- A second run of the job books nothing more.
select app_private.settle_stale_ai_runs();

do $$
begin
  if (select string_agg(attempt.outcome || '=' || attempt.cost_micro_usd, ',' order by attempt.idempotency_key)
      from public.ai_run_attempts attempt where attempt.run_id = 'af000000-0000-4000-8000-000000000041')
      is distinct from 'completed=2000000,provisional_charge=28000000' then
    raise exception 'A stale run was not settled at its reserved amount, exactly once';
  end if;
  if (select status from public.ai_runs where id = 'af000000-0000-4000-8000-000000000041') is distinct from 'failed'
    or (select settled_at from public.ai_runs where id = 'af000000-0000-4000-8000-000000000041') is null then
    raise exception 'A stale run stayed open';
  end if;
  -- A stale run whose ledger already holds its reservation gets no further charge.
  if (select count(*) from public.ai_run_attempts where run_id = 'af000000-0000-4000-8000-000000000042')
      is distinct from 1::bigint
    or (select status from public.ai_runs where id = 'af000000-0000-4000-8000-000000000042') is distinct from 'failed' then
    raise exception 'A stale run already covered by its ledger was charged again or stayed open';
  end if;
  if (select status from public.ai_runs where id = 'af000000-0000-4000-8000-000000000043') is distinct from 'reserved'
    or exists (select 1 from public.ai_run_attempts where run_id = 'af000000-0000-4000-8000-000000000043') then
    raise exception 'The job settled a run that may still be running';
  end if;
  if (select status::text || body::text from public.ai_thread_items where id = 'af000000-0000-4000-8000-000000000050')
      is distinct from 'failed{"text": "Halb fertig", "failure": "interrupted"}' then
    raise exception 'An answer left streaming was not finished as interrupted with its saved text';
  end if;
  if (select status::text || body::text from public.ai_thread_items where id = 'af000000-0000-4000-8000-000000000051')
      is distinct from 'complete{"text": "Fertig"}'
    or (select status from public.ai_thread_items where id = 'af000000-0000-4000-8000-000000000052')
      is distinct from 'streaming' then
    raise exception 'The job changed a finished answer or one still being written';
  end if;
end;
$$;

rollback;
