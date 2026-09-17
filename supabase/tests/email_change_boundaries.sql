-- SR-04: real RPC/grant checks plus deterministic lock contention. All data,
-- temporary helpers and an optional dblink installation roll back on exit.
-- The local stack trusts its internal connection. Only its superuser may open
-- dblink without password authentication; all assertions still use named roles.
\connect postgres supabase_admin
begin;
set local search_path = public, extensions, pg_temp;
create extension if not exists dblink with schema extensions;
select dblink_connect('email_change_contender', 'dbname=postgres user=postgres');
set local role postgres;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '72000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'email-boundary@example.test', '', now(),
  '{}', '{"first_name":"Email","last_name":"Boundary"}', now(), now()
);

create function pg_temp.change_email(operation text, code_hash text default repeat('a', 64), destination text default null)
returns jsonb language sql as $$
  select public.transition_email_change(
    '72000000-0000-4000-8000-000000000001', operation, 'email-boundary@example.test',
    (select challenge_id from public.email_change_challenges where user_id = '72000000-0000-4000-8000-000000000001'),
    code_hash, destination
  );
$$;
create function pg_temp.expect_error(result jsonb, expected text) returns void language plpgsql as $$
begin
  if result->>'error' is distinct from expected then
    raise exception 'expected %, got %', expected, result;
  end if;
end;
$$;
create function pg_temp.expect_status(result jsonb, expected text) returns void language plpgsql as $$
begin
  if result->>'status' is distinct from expected then
    raise exception 'expected status %, got %', expected, result;
  end if;
end;
$$;

-- Table ownership is not permission to manufacture proof of mailbox ownership.
do $$
declare client_role text;
begin
  foreach client_role in array array['anon', 'authenticated'] loop
    if has_table_privilege(client_role, 'public.email_change_challenges', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
      or has_table_privilege(client_role, 'app_private.email_change_send_windows', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
      or has_function_privilege(client_role,
        'public.transition_email_change(uuid,text,text,uuid,text,text,uuid)', 'EXECUTE') then
      raise exception 'email challenge privilege leaked to %', client_role;
    end if;
  end loop;
end;
$$;
set local role authenticated;
-- Use the fixture's real subject. RLS ownership must not restore table access.
select set_config('request.jwt.claim.sub', '72000000-0000-4000-8000-000000000001', true);
do $$
begin
  begin
    insert into public.email_change_challenges (user_id, current_email, status, current_email_verified_at)
    values ('72000000-0000-4000-8000-000000000001', 'email-boundary@example.test', 'pending_new', now());
    raise exception 'client forged a verified challenge';
  exception when insufficient_privilege then null; end;
  begin
    perform * from public.email_change_challenges;
    raise exception 'client read OTP hashes';
  exception when insufficient_privilege then null; end;
  begin
    update public.email_change_challenges set current_email_attempt_count = 0;
    raise exception 'client reset the attempt cap';
  exception when insufficient_privilege then null; end;
  begin
    delete from app_private.email_change_send_windows;
    raise exception 'client erased the sending cooldown';
  exception when insufficient_privilege then null; end;
  begin
    perform public.transition_email_change('72000000-0000-4000-8000-000000000001', 'request_current', 'email-boundary@example.test');
    raise exception 'client invoked privileged transition';
  exception when insufficient_privilege then null; end;
end;
$$;
set local role postgres;

-- Another connection holds the same user lock. Every mutation must wait before
-- checking or changing state, including request_current when no row exists.
select dblink_exec('email_change_contender', 'begin');
select * from dblink('email_change_contender',
  'select true from (select pg_advisory_xact_lock(hashtextextended(''email-change:72000000-0000-4000-8000-000000000001'', 0))) held') as locked(acquired boolean);
set local lock_timeout = '100ms';
do $$
declare operation text;
begin
  foreach operation in array array['request_current', 'verify_current', 'save_new', 'resend_new', 'verify_new', 'reset', 'complete', 'abandon_rejected_completion'] loop
    begin
      perform pg_temp.change_email(operation);
      raise exception 'operation % skipped serialization', operation;
    exception when lock_not_available then null; end;
  end loop;
end;
$$;
set local lock_timeout = '0';
select dblink_exec('email_change_contender', 'rollback');
select dblink_disconnect('email_change_contender');

set local role service_role;
do $$
begin
  if public.transition_email_change('72000000-0000-4000-8000-000000000001',
    'request_current', 'email-boundary@example.test', null, repeat('a', 64))->>'status' is distinct from 'ok' then
    raise exception 'service-role caller could not start the challenge';
  end if;
end;
$$;
set local role postgres;
select pg_temp.expect_error(pg_temp.change_email('request_current'), 'cooldown');
select pg_temp.expect_error(pg_temp.change_email('resend_new', repeat('b', 64), 'new@example.test'), 'current_email_not_verified');
select pg_temp.expect_error(pg_temp.change_email('verify_new'), 'current_email_not_verified');

-- All contenders use the same observed generation. Attempts are read under the
-- shared lock, saturate at five, and a correct sixth attempt cannot reopen it.
do $$
declare attempt integer; generation uuid; result jsonb;
begin
  select challenge_id into generation from public.email_change_challenges
    where user_id = '72000000-0000-4000-8000-000000000001';
  for attempt in 1..7 loop
    result := public.transition_email_change('72000000-0000-4000-8000-000000000001', 'verify_current',
      'email-boundary@example.test', generation, repeat('b', 64));
    perform pg_temp.expect_error(result, case when attempt < 5 then 'invalid_code' else 'too_many_attempts' end);
  end loop;
  if (select current_email_attempt_count from public.email_change_challenges
    where user_id = '72000000-0000-4000-8000-000000000001') <> 5 then
    raise exception 'current attempt accounting did not saturate at five';
  end if;
  perform pg_temp.expect_error(pg_temp.change_email('verify_current'), 'too_many_attempts');
end;
$$;

-- Expiry and stale generations never delete or overwrite a replacement.
create temporary table old_email_generation as
  select challenge_id from public.email_change_challenges where user_id = '72000000-0000-4000-8000-000000000001';
select pg_temp.expect_status(pg_temp.change_email('reset'), 'ok');
select pg_temp.expect_error(pg_temp.change_email('request_current'), 'cooldown');
-- Advance only this synthetic account's sending window, without sleeping.
update app_private.email_change_send_windows set current_email_last_sent_at = now() - interval '61 seconds'
  where user_id = '72000000-0000-4000-8000-000000000001';
select pg_temp.expect_error(pg_temp.change_email('request_current', 'invalid-hash'), 'invalid_code');
select pg_temp.expect_status(pg_temp.change_email('request_current'), 'ok');
select pg_temp.expect_error(public.transition_email_change('72000000-0000-4000-8000-000000000001',
  'verify_current', 'email-boundary@example.test', (select challenge_id from old_email_generation), repeat('a', 64)), 'challenge_not_found');
select pg_temp.expect_error(public.transition_email_change('72000000-0000-4000-8000-000000000001',
  'reset', 'email-boundary@example.test', (select challenge_id from old_email_generation)), 'challenge_not_found');
select pg_temp.expect_status(pg_temp.change_email('verify_current'), 'ok');
select pg_temp.expect_error(pg_temp.change_email('verify_current'), 'challenge_not_found');
select pg_temp.expect_error(pg_temp.change_email('save_new', repeat('c', 64), 'email-boundary@example.test'), 'invalid_email');
-- The first new-mailbox send succeeds immediately after the current-mailbox
-- send, and an invalid destination did not spend that separate window.
select pg_temp.expect_status(pg_temp.change_email('save_new', repeat('c', 64), 'new@example.test'), 'ok');

-- Reset cannot erase either destination's sending window. After the current
-- window expires, a new wizard still cannot bypass the new-mailbox window.
create temporary table saved_send_window as select * from app_private.email_change_send_windows
  where user_id = '72000000-0000-4000-8000-000000000001';
select pg_temp.expect_status(pg_temp.change_email('reset'), 'ok');
do $$ begin
  if (select to_jsonb(window_row) from app_private.email_change_send_windows window_row
    where user_id = '72000000-0000-4000-8000-000000000001')
    is distinct from (select to_jsonb(saved) from saved_send_window saved) then
    raise exception 'reset changed a sending window';
  end if;
end $$;
select pg_temp.expect_error(pg_temp.change_email('request_current'), 'cooldown');
update app_private.email_change_send_windows set current_email_last_sent_at = now() - interval '61 seconds'
  where user_id = '72000000-0000-4000-8000-000000000001';
select pg_temp.expect_status(pg_temp.change_email('request_current'), 'ok');
select pg_temp.expect_status(pg_temp.change_email('verify_current'), 'ok');
select pg_temp.expect_error(pg_temp.change_email('save_new', repeat('c', 64), 'new@example.test'), 'cooldown');
update app_private.email_change_send_windows set new_email_last_sent_at = now() - interval '61 seconds'
  where user_id = '72000000-0000-4000-8000-000000000001';
select pg_temp.expect_status(pg_temp.change_email('save_new', repeat('c', 64), 'new@example.test'), 'ok');
select pg_temp.expect_error(pg_temp.change_email('resend_new', repeat('d', 64), 'other@example.test'), 'invalid_email');
select pg_temp.expect_error(pg_temp.change_email('resend_new', repeat('d', 64), 'new@example.test'), 'cooldown');

do $$
declare attempt integer;
begin
  for attempt in 1..7 loop
    perform pg_temp.expect_error(pg_temp.change_email('verify_new', repeat('b', 64)),
      case when attempt < 5 then 'new_email_invalid_code' else 'new_email_too_many_attempts' end);
  end loop;
  if (select new_email_attempt_count from public.email_change_challenges
    where user_id = '72000000-0000-4000-8000-000000000001') <> 5 then
    raise exception 'new attempt accounting did not saturate at five';
  end if;
  perform pg_temp.expect_error(pg_temp.change_email('verify_new', repeat('c', 64)), 'new_email_too_many_attempts');
end;
$$;

truncate old_email_generation;
insert into old_email_generation select challenge_id from public.email_change_challenges
  where user_id = '72000000-0000-4000-8000-000000000001';
-- Move only the synthetic send timestamp, so the test crosses no wall-clock wait.
update public.email_change_challenges set new_email_last_sent_at = now() - interval '61 seconds'
  where user_id = '72000000-0000-4000-8000-000000000001';
update app_private.email_change_send_windows set new_email_last_sent_at = now() - interval '61 seconds'
  where user_id = '72000000-0000-4000-8000-000000000001';
select pg_temp.expect_status(pg_temp.change_email('resend_new', repeat('d', 64), 'new@example.test'), 'ok');
select pg_temp.expect_error(public.transition_email_change('72000000-0000-4000-8000-000000000001',
  'verify_new', 'email-boundary@example.test', (select challenge_id from old_email_generation), repeat('c', 64)), 'challenge_not_found');
update public.email_change_challenges set current_email_verified_expires_at = now() - interval '1 second'
  where user_id = '72000000-0000-4000-8000-000000000001';
select pg_temp.expect_error(pg_temp.change_email('verify_new', repeat('d', 64)), 'verification_window_expired');
update public.email_change_challenges set current_email_verified_expires_at = now() + interval '1 minute'
  where user_id = '72000000-0000-4000-8000-000000000001';

create temporary table email_completion as select pg_temp.change_email('verify_new', repeat('d', 64)) as result;
select pg_temp.expect_status(result, 'claimed') from email_completion;
select pg_temp.expect_status(pg_temp.change_email('verify_new', repeat('d', 64)), 'completion_pending');
select pg_temp.expect_error(pg_temp.change_email('reset'), 'completion_pending');
select pg_temp.expect_error(pg_temp.change_email('request_current'), 'completion_pending');
select pg_temp.expect_error(pg_temp.change_email('resend_new', repeat('e', 64), 'new@example.test'), 'completion_pending');
select pg_temp.expect_error(public.transition_email_change('72000000-0000-4000-8000-000000000001',
  'complete', 'email-boundary@example.test', (result->>'challengeId')::uuid, null, null, gen_random_uuid()), 'challenge_not_found')
  from email_completion;
select pg_temp.expect_error(public.transition_email_change('72000000-0000-4000-8000-000000000001',
  'complete', 'email-boundary@example.test', (result->>'challengeId')::uuid, null, null, (result->>'token')::uuid), 'completion_pending')
  from email_completion;

-- Stand in for the successful Auth provider write, only on this rollback fixture.
truncate saved_send_window;
insert into saved_send_window select * from app_private.email_change_send_windows
  where user_id = '72000000-0000-4000-8000-000000000001';
update auth.users set email = 'new@example.test' where id = '72000000-0000-4000-8000-000000000001';
select pg_temp.expect_status(public.transition_email_change('72000000-0000-4000-8000-000000000001',
  'complete', 'email-boundary@example.test', (result->>'challengeId')::uuid, null, null, (result->>'token')::uuid), 'completed')
  from email_completion;
select pg_temp.expect_error(public.transition_email_change('72000000-0000-4000-8000-000000000001',
  'complete', 'email-boundary@example.test', (result->>'challengeId')::uuid, null, null, (result->>'token')::uuid), 'challenge_not_found')
  from email_completion;

do $$ begin
  if (select to_jsonb(window_row) from app_private.email_change_send_windows window_row
    where user_id = '72000000-0000-4000-8000-000000000001')
    is distinct from (select to_jsonb(saved) from saved_send_window saved) then
    raise exception 'completion changed a sending window';
  end if;
end $$;
select pg_temp.expect_error(public.transition_email_change('72000000-0000-4000-8000-000000000001',
  'request_current', 'new@example.test', null, repeat('e', 64)), 'cooldown');

-- A provider's definite rejection can clear its completion claim but cannot
-- authorize another email. Each phase has its own preserved sending window.
update app_private.email_change_send_windows set current_email_last_sent_at = now() - interval '61 seconds'
  where user_id = '72000000-0000-4000-8000-000000000001';
select pg_temp.expect_status(public.transition_email_change('72000000-0000-4000-8000-000000000001',
  'request_current', 'new@example.test', null, repeat('e', 64)), 'ok');
select pg_temp.expect_status(public.transition_email_change('72000000-0000-4000-8000-000000000001',
  'verify_current', 'new@example.test',
  (select challenge_id from public.email_change_challenges where user_id = '72000000-0000-4000-8000-000000000001'), repeat('e', 64)), 'ok');
select pg_temp.expect_error(public.transition_email_change('72000000-0000-4000-8000-000000000001',
  'save_new', 'new@example.test',
  (select challenge_id from public.email_change_challenges where user_id = '72000000-0000-4000-8000-000000000001'), repeat('f', 64), 'third@example.test'), 'cooldown');
update app_private.email_change_send_windows set new_email_last_sent_at = now() - interval '61 seconds'
  where user_id = '72000000-0000-4000-8000-000000000001';
select pg_temp.expect_status(public.transition_email_change('72000000-0000-4000-8000-000000000001',
  'save_new', 'new@example.test',
  (select challenge_id from public.email_change_challenges where user_id = '72000000-0000-4000-8000-000000000001'), repeat('f', 64), 'third@example.test'), 'ok');
truncate email_completion;
insert into email_completion select public.transition_email_change('72000000-0000-4000-8000-000000000001',
  'verify_new', 'new@example.test',
  (select challenge_id from public.email_change_challenges where user_id = '72000000-0000-4000-8000-000000000001'), repeat('f', 64));
select pg_temp.expect_status(result, 'claimed') from email_completion;
truncate saved_send_window;
insert into saved_send_window select * from app_private.email_change_send_windows
  where user_id = '72000000-0000-4000-8000-000000000001';
select pg_temp.expect_status(public.transition_email_change('72000000-0000-4000-8000-000000000001',
  'abandon_rejected_completion', 'new@example.test', (result->>'challengeId')::uuid, null, null, (result->>'token')::uuid), 'ok')
  from email_completion;
do $$ begin
  if (select to_jsonb(window_row) from app_private.email_change_send_windows window_row
    where user_id = '72000000-0000-4000-8000-000000000001')
    is distinct from (select to_jsonb(saved) from saved_send_window saved) then
    raise exception 'abandoned completion changed a sending window';
  end if;
end $$;
select pg_temp.expect_error(public.transition_email_change('72000000-0000-4000-8000-000000000001',
  'request_current', 'new@example.test', null, repeat('a', 64)), 'cooldown');

delete from auth.users where id = '72000000-0000-4000-8000-000000000001';
do $$ begin
  if exists (select 1 from app_private.email_change_send_windows
    where user_id = '72000000-0000-4000-8000-000000000001') then
    raise exception 'deleted account retained its sending windows';
  end if;
end $$;

rollback;
