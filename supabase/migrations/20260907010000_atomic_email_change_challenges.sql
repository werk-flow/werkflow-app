-- SR-04: only verified server actions may create or consume email challenges.
-- Previously client-writable verification flags cannot establish ownership.
revoke all on public.email_change_challenges from public, anon, authenticated;
drop policy if exists email_change_challenges_select_own on public.email_change_challenges;
drop policy if exists email_change_challenges_insert_own on public.email_change_challenges;
drop policy if exists email_change_challenges_update_own on public.email_change_challenges;
drop policy if exists email_change_challenges_delete_own on public.email_change_challenges;
delete from public.email_change_challenges;

alter table public.email_change_challenges
  add column challenge_id uuid not null default gen_random_uuid(),
  add column completion_token uuid,
  add column completion_started_at timestamptz,
  add constraint email_change_completion_shape check (
    (completion_token is null and completion_started_at is null)
    or (completion_token is not null and completion_started_at is not null and status = 'pending_new')
  );

-- Serialize every mutation, including creation when there is no row to lock.
-- Hashes and completion tokens never cross the authenticated Data API boundary.
-- The server supplies the authenticated user ID, never a browser parameter.
create function public.transition_email_change(
  p_user_id uuid,
  p_operation text,
  p_current_email text,
  p_expected_challenge_id uuid default null,
  p_code_hash text default null,
  p_new_email text default null,
  p_completion_token uuid default null
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  challenge public.email_change_challenges;
  account_email text;
  checked_at timestamptz;
  next_attempt integer;
  token uuid;
begin
  if p_user_id is null or p_operation is null or p_operation not in (
    'request_current', 'verify_current', 'save_new', 'resend_new', 'verify_new',
    'complete', 'abandon_rejected_completion', 'reset'
  ) then return jsonb_build_object('error', 'unexpected_error'); end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('email-change:' || p_user_id::text, 0)
  );
  select * into challenge from public.email_change_challenges
    where user_id = p_user_id for update;
  select lower(trim(email)) into account_email from auth.users where id = p_user_id;
  checked_at := clock_timestamp();
  if account_email is null then return jsonb_build_object('error', 'not_authenticated'); end if;

  if p_operation in ('complete', 'abandon_rejected_completion') then
    if challenge.user_id is null or challenge.completion_token is null
      or p_completion_token is distinct from challenge.completion_token
      or p_expected_challenge_id is distinct from challenge.challenge_id then
      return jsonb_build_object('error', 'challenge_not_found');
    end if;
    -- A completed Auth request can be reconciled after a lost HTTP response.
    if account_email = challenge.new_email then
      delete from public.email_change_challenges where user_id = p_user_id;
      return jsonb_build_object('status', 'completed', 'email', account_email);
    end if;
    if p_operation = 'abandon_rejected_completion' and account_email = challenge.current_email then
      delete from public.email_change_challenges where user_id = p_user_id;
      return jsonb_build_object('status', 'ok');
    end if;
    return jsonb_build_object('error', 'completion_pending');
  end if;

  if challenge.completion_token is not null then
    if p_operation = 'verify_new' and p_expected_challenge_id = challenge.challenge_id then
      return jsonb_build_object('status', 'completion_pending', 'email', challenge.new_email,
        'token', challenge.completion_token, 'challengeId', challenge.challenge_id);
    end if;
    -- No replacement, expiry-based takeover, or reset while Auth may be running.
    return jsonb_build_object('error', 'completion_pending');
  end if;
  if lower(trim(p_current_email)) is distinct from account_email then
    return jsonb_build_object('error', 'challenge_expired');
  end if;

  if p_operation = 'request_current' then
    if p_code_hash is null or p_code_hash !~ '^[a-f0-9]{64}$' then
      return jsonb_build_object('error', 'invalid_code');
    end if;
    if challenge.current_email_last_sent_at > checked_at - interval '60 seconds' then
      return jsonb_build_object('error', 'cooldown');
    end if;
    insert into public.email_change_challenges (
      user_id, current_email, status, challenge_id, current_email_code_hash,
      current_email_code_expires_at, current_email_last_sent_at
    ) values (
      p_user_id, account_email, 'pending_current', gen_random_uuid(), p_code_hash,
      checked_at + interval '10 minutes', checked_at
    ) on conflict (user_id) do update set
      current_email = excluded.current_email, status = excluded.status,
      challenge_id = excluded.challenge_id, current_email_code_hash = excluded.current_email_code_hash,
      current_email_code_expires_at = excluded.current_email_code_expires_at,
      current_email_last_sent_at = excluded.current_email_last_sent_at, current_email_attempt_count = 0,
      current_email_verified_at = null, current_email_verified_expires_at = null,
      new_email = null, new_email_code_hash = null, new_email_code_expires_at = null,
      new_email_last_sent_at = null, new_email_attempt_count = 0, new_email_requested_at = null,
      created_at = checked_at, updated_at = checked_at;
    return jsonb_build_object('status', 'ok');
  end if;

  if p_operation = 'reset' and challenge.user_id is null then
    return jsonb_build_object('status', 'ok');
  end if;
  if challenge.user_id is null or p_expected_challenge_id is distinct from challenge.challenge_id then
    return jsonb_build_object('error', 'challenge_not_found');
  end if;
  if challenge.current_email is distinct from account_email then
    return jsonb_build_object('error', 'challenge_expired');
  end if;
  if p_operation = 'reset' then
    delete from public.email_change_challenges where user_id = p_user_id;
    return jsonb_build_object('status', 'ok');
  end if;
  if p_code_hash is null or p_code_hash !~ '^[a-f0-9]{64}$' then
    return jsonb_build_object('error', 'invalid_code');
  end if;

  if p_operation = 'verify_current' then
    if challenge.status <> 'pending_current' then
      return jsonb_build_object('error', 'challenge_not_found');
    end if;
    if challenge.current_email_attempt_count >= 5 then
      return jsonb_build_object('error', 'too_many_attempts');
    end if;
    if challenge.current_email_code_hash is null or challenge.current_email_code_expires_at is null
      or challenge.current_email_code_expires_at <= checked_at then
      return jsonb_build_object('error', 'challenge_expired');
    end if;
    if challenge.current_email_code_hash <> p_code_hash then
      next_attempt := challenge.current_email_attempt_count + 1;
      update public.email_change_challenges set current_email_attempt_count = next_attempt,
        current_email_code_expires_at = case when next_attempt >= 5 then checked_at
          else current_email_code_expires_at end, updated_at = checked_at
        where user_id = p_user_id;
      return jsonb_build_object('error', case when next_attempt >= 5 then 'too_many_attempts' else 'invalid_code' end);
    end if;
    update public.email_change_challenges set status = 'current_verified',
      current_email_code_hash = null, current_email_code_expires_at = null,
      current_email_verified_at = checked_at,
      current_email_verified_expires_at = checked_at + interval '10 minutes', updated_at = checked_at
      where user_id = p_user_id;
    return jsonb_build_object('status', 'ok');
  end if;

  if challenge.current_email_verified_at is null or challenge.current_email_verified_expires_at is null then
    return jsonb_build_object('error', 'current_email_not_verified');
  end if;
  if challenge.current_email_verified_expires_at <= checked_at then
    return jsonb_build_object('error', 'verification_window_expired');
  end if;
  if p_operation in ('save_new', 'resend_new') then
    if (p_operation = 'save_new' and challenge.status <> 'current_verified')
      or (p_operation = 'resend_new' and challenge.status <> 'pending_new') then
      return jsonb_build_object('error', 'challenge_not_found');
    end if;
    if p_new_email is null or length(p_new_email) > 320 or p_new_email not like '%@%'
      or lower(trim(p_new_email)) = account_email
      or (p_operation = 'resend_new' and lower(trim(p_new_email)) is distinct from challenge.new_email) then
      return jsonb_build_object('error', 'invalid_email');
    end if;
    if p_operation = 'resend_new' and challenge.new_email_last_sent_at > checked_at - interval '60 seconds' then
      return jsonb_build_object('error', 'cooldown');
    end if;
    update public.email_change_challenges set status = 'pending_new', challenge_id = gen_random_uuid(),
      new_email = lower(trim(p_new_email)), new_email_code_hash = p_code_hash,
      new_email_code_expires_at = checked_at + interval '10 minutes', new_email_last_sent_at = checked_at,
      new_email_attempt_count = 0, new_email_requested_at = checked_at, updated_at = checked_at
      where user_id = p_user_id;
    return jsonb_build_object('status', 'ok');
  end if;

  if challenge.status <> 'pending_new' or challenge.new_email is null then
    return jsonb_build_object('error', 'challenge_not_found');
  end if;
  if challenge.new_email_attempt_count >= 5 then
    return jsonb_build_object('error', 'new_email_too_many_attempts');
  end if;
  if challenge.new_email_code_hash is null or challenge.new_email_code_expires_at is null
    or challenge.new_email_code_expires_at <= checked_at then
    return jsonb_build_object('error', 'new_email_code_expired');
  end if;
  if challenge.new_email_code_hash <> p_code_hash then
    next_attempt := challenge.new_email_attempt_count + 1;
    update public.email_change_challenges set new_email_attempt_count = next_attempt,
      new_email_code_expires_at = case when next_attempt >= 5 then checked_at
        else new_email_code_expires_at end, updated_at = checked_at where user_id = p_user_id;
    return jsonb_build_object('error', case when next_attempt >= 5 then 'new_email_too_many_attempts' else 'new_email_invalid_code' end);
  end if;
  token := gen_random_uuid();
  update public.email_change_challenges set completion_token = token, completion_started_at = checked_at,
    new_email_code_hash = null, updated_at = checked_at where user_id = p_user_id;
  return jsonb_build_object('status', 'claimed', 'email', challenge.new_email,
    'token', token, 'challengeId', challenge.challenge_id);
end;
$$;

revoke all on function public.transition_email_change(uuid, text, text, uuid, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.transition_email_change(uuid, text, text, uuid, text, text, uuid)
  to service_role;
