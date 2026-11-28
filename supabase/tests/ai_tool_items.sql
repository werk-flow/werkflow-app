-- WerkFlow KI's tool rows (migration 20270415100001, werk-flow/werkflow-planning#533):
-- a tool call's thread row and its ledger row land in one call or not at all;
-- a row lands only in the thread of the caller's own run; a known key keeps
-- its place and changes only to a higher revision; client roles reach no
-- function, and the author alone reads a row's detail. Runs in one
-- transaction and rolls back.
begin;

do $$
declare
  signature text := 'public.record_ai_tool_item(uuid, uuid, uuid, public.ai_thread_item_kind, '
    'public.ai_thread_item_status, text, jsonb, jsonb, text, text, text, text)';
begin
  if has_function_privilege('anon', signature, 'execute')
    or has_function_privilege('authenticated', signature, 'execute') then
    raise exception 'A client role may write a WerkFlow KI tool row';
  end if;
  if not has_function_privilege('service_role', signature, 'execute') then
    raise exception 'service_role lost execute on the tool row write';
  end if;
end;
$$;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
('ae100000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'ai-rows-admin@example.test', '', now(), '{}',
 '{"first_name":"Admin","last_name":"Zeilen"}', now(), now()),
('ae100000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'ai-rows-monteur@example.test', '', now(), '{}',
 '{"first_name":"Monteur","last_name":"Zeilen"}', now(), now());

insert into public.organizations (id, name, admin_id, unique_code) values
('ae100000-0000-4000-8000-000000000010', 'KI Zeilen', 'ae100000-0000-4000-8000-000000000001', 'AIROW1');
insert into public.organization_members (organization_id, user_id, role) values
('ae100000-0000-4000-8000-000000000010', 'ae100000-0000-4000-8000-000000000002', 'employee');

set local role service_role;

select public.set_ai_organization_enabled('ae100000-0000-4000-8000-000000000010',
  'ae100000-0000-4000-8000-000000000001', true);
select * from public.start_ai_turn('ae100000-0000-4000-8000-000000000010',
  'ae100000-0000-4000-8000-000000000002', 'ae100000-0000-4000-8000-000000000020', 'Heizung',
  'turn-1', 'Was steht bei der Heizung an?', 1000000);

do $$
declare
  v_org constant uuid := 'ae100000-0000-4000-8000-000000000010';
  v_author constant uuid := 'ae100000-0000-4000-8000-000000000002';
  v_admin constant uuid := 'ae100000-0000-4000-8000-000000000001';
  v_run uuid := (select id from public.ai_runs where idempotency_key = 'turn-1');
  v_first bigint;
  v_again bigint;
  v_plan bigint;
  v_item public.ai_thread_items;
begin
  -- A running call takes the next sequence and writes no ledger row.
  v_first := public.record_ai_tool_item(v_org, v_author, v_run, 'tool_call', 'streaming', 'turn-1:tool:1',
    '{"revision":1,"tool":"auftraege_finden"}', null, null, null, null, null);
  if v_first is distinct from 3::bigint then
    raise exception 'A tool row took sequence %, expected 3 after the message and its answer', v_first;
  end if;
  if exists (select 1 from public.ai_run_attempts where organization_id = v_org and idempotency_key = 'turn-1:tool:1') then
    raise exception 'A running tool call wrote a ledger row';
  end if;

  -- Its end keeps the place and writes the row, its detail and the ledger row in one call.
  v_again := public.record_ai_tool_item(v_org, v_author, v_run, 'tool_call', 'complete', 'turn-1:tool:1',
    '{"revision":2,"tool":"auftraege_finden","outcome":"ok"}', '{"input":{"suche":"Heizung"}}',
    'turn-1:tool:1', 'claude-haiku-5-5', 'v1', 'tool_call_auftraege_finden_ok');
  select * into v_item from public.ai_thread_items where idempotency_key = 'turn-1:tool:1';
  if v_again is distinct from v_first or v_item.status is distinct from 'complete' or v_item.detail is null then
    raise exception 'A finished tool call did not keep its place or did not save its detail';
  end if;
  if (select outcome from public.ai_run_attempts where idempotency_key = 'turn-1:tool:1')
      is distinct from 'tool_call_auftraege_finden_ok' then
    raise exception 'A finished tool call wrote no ledger row with its outcome';
  end if;

  -- A late repeat of the running write changes nothing.
  perform public.record_ai_tool_item(v_org, v_author, v_run, 'tool_call', 'streaming', 'turn-1:tool:1',
    '{"revision":1,"tool":"auftraege_finden"}', null, null, null, null, null);
  if (select status from public.ai_thread_items where organization_id = v_org and idempotency_key = 'turn-1:tool:1')
      is distinct from 'complete' then
    raise exception 'An older revision overwrote a finished tool row';
  end if;

  -- A to-do list keeps one row that each later call replaces.
  v_plan := public.record_ai_tool_item(v_org, v_author, v_run, 'todo_list', 'complete', 'turn-1:plan',
    '{"revision":2,"steps":[{"text":"Suchen","done":false}]}', null, 'turn-1:tool:2',
    'claude-haiku-5-5', 'v1', 'tool_call_plan_zeigen_ok');
  -- The write and the reread are separate statements: one statement's snapshot predates its own call.
  v_again := public.record_ai_tool_item(v_org, v_author, v_run, 'todo_list', 'complete', 'turn-1:plan',
    '{"revision":3,"steps":[{"text":"Suchen","done":true}]}', null, 'turn-1:tool:3',
    'claude-haiku-5-5', 'v1', 'tool_call_plan_zeigen_ok');
  if v_again is distinct from v_plan
    or (select body -> 'steps' -> 0 ->> 'done' from public.ai_thread_items
        where organization_id = v_org and idempotency_key = 'turn-1:plan') is distinct from 'true' then
    raise exception 'A later to-do call did not replace its list in place';
  end if;

  -- A call's outcome is claimed once: a later write under its ledger key, such as the failed row for a
  -- call still running when its turn ended, writes no row.
  v_again := public.record_ai_tool_item(v_org, v_author, v_run, 'tool_call', 'failed', 'turn-1:tool:3',
    '{"revision":2,"label":"Plan zeigen","control":"read","outcome":"failed"}', null, 'turn-1:tool:3',
    'claude-haiku-5-5', 'v1', 'tool_call_plan_zeigen_failed');
  if v_again is not null or exists (select 1 from public.ai_thread_items
      where organization_id = v_org and idempotency_key = 'turn-1:tool:3') then
    raise exception 'A second outcome of one tool call wrote a row';
  end if;

  -- A retry of a write that landed, its first answer lost, returns the saved row's place again.
  if public.record_ai_tool_item(v_org, v_author, v_run, 'tool_call', 'complete', 'turn-1:tool:1',
      '{"revision":2,"tool":"auftraege_finden","outcome":"ok"}', '{"input":{"suche":"Heizung"}}',
      'turn-1:tool:1', 'claude-haiku-5-5', 'v1', 'tool_call_auftraege_finden_ok') is distinct from v_first then
    raise exception 'A retried tool call write did not return its saved row';
  end if;

  -- A key of another kind is a conflict.
  begin
    perform public.record_ai_tool_item(v_org, v_author, v_run, 'question', 'complete', 'turn-1:plan',
      '{"revision":9}', null, null, null, null, null);
    raise exception 'A question took the key of a to-do list';
  exception when others then
    if sqlerrm is distinct from 'ai_thread_item_key_conflict' then raise; end if;
  end;

  -- A message kind or a body without a revision is refused.
  begin
    perform public.record_ai_tool_item(v_org, v_author, v_run, 'assistant_message', 'complete', 'turn-1:x',
      '{"revision":1}', null, null, null, null, null);
    raise exception 'A tool row wrote an answer';
  exception when others then
    if sqlerrm is distinct from 'ai_tool_item_kind_invalid' then raise; end if;
  end;
  begin
    perform public.record_ai_tool_item(v_org, v_author, v_run, 'tool_call', 'complete', 'turn-1:x',
      '{"tool":"auftraege_finden"}', null, null, null, null, null);
    raise exception 'A tool row without a revision was written';
  exception when others then
    if sqlerrm is distinct from 'ai_tool_item_revision_invalid' then raise; end if;
  end;

  -- Another person, the admin included, writes nothing into the author's run.
  begin
    perform public.record_ai_tool_item(v_org, v_admin, v_run, 'tool_call', 'complete', 'turn-1:tool:9',
      '{"revision":1}', null, null, null, null, null);
    raise exception 'The admin wrote a row into another person''s run';
  exception when others then
    if sqlerrm is distinct from 'ai_run_not_found' then raise; end if;
  end;

  -- A run that does not exist names no thread.
  begin
    perform public.record_ai_tool_item(v_org, v_author, gen_random_uuid(), 'tool_call', 'complete',
      'turn-1:tool:5', '{"revision":2}', null, 'other-run:tool:1', 'claude-haiku-5-5', 'v1', 'tool_call_x_ok');
    raise exception 'A row was written for a run that does not exist';
  exception when others then
    if sqlerrm is distinct from 'ai_run_not_found' then raise; end if;
  end;
end;
$$;

-- A ledger row the call cannot write takes the thread row back with it.
do $$
declare
  v_run uuid := (select id from public.ai_runs where idempotency_key = 'turn-1');
begin
  -- The same ledger key on another run's attempt makes record_ai_run_attempt refuse.
  perform public.settle_ai_run('ae100000-0000-4000-8000-000000000010', v_run, 'succeeded');
  perform public.start_ai_turn('ae100000-0000-4000-8000-000000000010', 'ae100000-0000-4000-8000-000000000002',
    'ae100000-0000-4000-8000-000000000021', 'Zweiter', 'turn-2', 'Und der Kessel?', 1000000);
  perform public.record_ai_run_attempt('ae100000-0000-4000-8000-000000000010',
    (select id from public.ai_runs where idempotency_key = 'turn-2'), 'taken-key', 'claude-haiku-5-5', 'v1',
    0, 0, 0, 0, 0, 'tool_call_x_ok');
  begin
    perform public.record_ai_tool_item('ae100000-0000-4000-8000-000000000010',
      'ae100000-0000-4000-8000-000000000002', v_run, 'tool_call', 'complete', 'turn-1:tool:6',
      '{"revision":2,"tool":"kunden_finden"}', null, 'taken-key', 'claude-haiku-5-5', 'v1',
      'tool_call_kunden_finden_ok');
    raise exception 'A tool row was written while its ledger row was refused';
  exception when others then
    if sqlerrm is distinct from 'ai_attempt_key_conflict' then raise; end if;
  end;
  if exists (select 1 from public.ai_thread_items
      where organization_id = 'ae100000-0000-4000-8000-000000000010' and idempotency_key = 'turn-1:tool:6') then
    raise exception 'A tool row stayed although its ledger row was refused';
  end if;
end;
$$;

-- The author reads a row's detail; the admin of the organization reads neither row nor detail.
reset role;
select set_config('request.jwt.claims', '{"sub":"ae100000-0000-4000-8000-000000000002","role":"authenticated"}', true);
set local role authenticated;
do $$
begin
  if (select detail -> 'input' ->> 'suche' from public.ai_thread_items where idempotency_key = 'turn-1:tool:1')
      is distinct from 'Heizung' then
    raise exception 'The author cannot read their tool row''s detail';
  end if;
end;
$$;
reset role;
select set_config('request.jwt.claims', '{"sub":"ae100000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
do $$
begin
  if exists (select 1 from public.ai_thread_items where idempotency_key like 'turn-1:%') then
    raise exception 'An admin reads another person''s tool rows';
  end if;
end;
$$;

rollback;
