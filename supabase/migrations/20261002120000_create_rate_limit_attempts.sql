-- Attempts counted by the general rate limiter (lib/security/rate-limit.ts).
-- One row is one allowed attempt of one action by one subject. The subject is
-- an HMAC computed on the server, so an email address or IP address never
-- reaches this table in clear. Rate-limit state only: no client role reads or
-- writes it, and consume_rate_limit is the one writer.
create table public.rate_limit_attempts (
  id bigint generated always as identity primary key,
  action text not null check (action ~ '^[a-z][a-z0-9_]{0,62}$'),
  subject_hash text not null check (subject_hash ~ '^[0-9a-f]{64}$'),
  attempted_at timestamptz not null default now(),
  expires_at timestamptz not null,
  check (expires_at > attempted_at)
);

-- The window count of one key, and the sweep of expired rows of every key.
create index rate_limit_attempts_key_expires_at_idx
  on public.rate_limit_attempts (action, subject_hash, expires_at);
create index rate_limit_attempts_expires_at_idx
  on public.rate_limit_attempts (expires_at);

-- RLS without a policy: client roles see no row even if a grant appeared later.
alter table public.rate_limit_attempts enable row level security;

-- Valid under revoked default privileges (migration 20260928095752) and under
-- the old automatic grants alike: remove everything, then grant what is used.
-- The service role reads for diagnosis; writes go through the function below.
revoke all on table public.rate_limit_attempts from public, anon, authenticated, service_role;
grant select on table public.rate_limit_attempts to service_role;

-- Checks and records one attempt atomically. Returns true when the attempt is
-- allowed (and recorded), false when the key already has p_max_attempts
-- unexpired attempts (nothing is recorded, so a refused caller does not extend
-- its own lockout). A transaction-scoped advisory lock per key serializes
-- concurrent attempts, so two requests cannot both take the last slot.
-- Retention: every call removes the key's expired rows and up to 100 expired
-- rows of any key, so the table holds roughly the attempts of the longest window.
create function public.consume_rate_limit(
  p_action text,
  p_subject_hash text,
  p_max_attempts integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  checked_at timestamptz := now();
  recent_attempts integer;
begin
  if p_action is null or p_action !~ '^[a-z][a-z0-9_]{0,62}$' then
    raise exception 'invalid_rate_limit_action' using errcode = '22023';
  end if;
  if p_subject_hash is null or p_subject_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_rate_limit_subject' using errcode = '22023';
  end if;
  if p_max_attempts is null or p_max_attempts < 1 or p_max_attempts > 10000 then
    raise exception 'invalid_rate_limit_maximum' using errcode = '22023';
  end if;
  if p_window_seconds is null or p_window_seconds < 1 or p_window_seconds > 604800 then
    raise exception 'invalid_rate_limit_window' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('rate_limit:' || p_action || ':' || p_subject_hash, 0));

  delete from public.rate_limit_attempts
  where id in (
    select id from public.rate_limit_attempts
    where expires_at <= checked_at
    order by expires_at
    limit 100
    for update skip locked
  );
  delete from public.rate_limit_attempts
  where action = p_action and subject_hash = p_subject_hash and expires_at <= checked_at;

  select count(*) into recent_attempts
  from public.rate_limit_attempts
  where action = p_action and subject_hash = p_subject_hash and expires_at > checked_at;
  if recent_attempts >= p_max_attempts then
    return false;
  end if;

  insert into public.rate_limit_attempts (action, subject_hash, attempted_at, expires_at)
  values (p_action, p_subject_hash, checked_at, checked_at + make_interval(secs => p_window_seconds));
  return true;
end;
$$;

revoke all on function public.consume_rate_limit(text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_rate_limit(text, text, integer, integer) to service_role;
