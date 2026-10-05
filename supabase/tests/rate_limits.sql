-- General rate limiter (migration 20261002120000_create_rate_limit_attempts.sql,
-- lib/security/rate-limit.ts): client roles reach neither the table nor the
-- function, the function allows N attempts per key and window and refuses the
-- next, an expired window frees the key, and keys do not share a budget.
-- Runs inside one transaction against the local stack and rolls back.
begin;

-- Client roles hold no privilege on the table or the function.
do $$
declare api_role text;
begin
  foreach api_role in array array['anon', 'authenticated'] loop
    if has_table_privilege(api_role, 'public.rate_limit_attempts',
        'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      or has_any_column_privilege(api_role, 'public.rate_limit_attempts', 'SELECT,INSERT,UPDATE') then
      raise exception '% holds a privilege on rate_limit_attempts', api_role;
    end if;
    if has_function_privilege(api_role, 'public.consume_rate_limit(text, text, integer, integer)', 'execute') then
      raise exception '% may execute consume_rate_limit', api_role;
    end if;
  end loop;
  if has_table_privilege('service_role', 'public.rate_limit_attempts', 'INSERT,UPDATE,DELETE') then
    raise exception 'service_role may write rate_limit_attempts directly';
  end if;
  if not has_function_privilege('service_role', 'public.consume_rate_limit(text, text, integer, integer)', 'execute') then
    raise exception 'service_role lost execute on consume_rate_limit';
  end if;
  if not (select prosecdef and proconfig @> array['search_path=""']
          from pg_proc where oid = 'public.consume_rate_limit(text, text, integer, integer)'::regprocedure) then
    raise exception 'consume_rate_limit must be SECURITY DEFINER with an empty search_path';
  end if;
end;
$$;

-- The real denials, as the Data API roles would meet them.
set local role anon;
do $$
begin
  begin
    perform 1 from public.rate_limit_attempts;
    raise exception 'anon read rate_limit_attempts';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.consume_rate_limit('client_probe', repeat('a', 64), 5, 60);
    raise exception 'anon executed consume_rate_limit';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;
set local role authenticated;
do $$
begin
  begin
    perform 1 from public.rate_limit_attempts;
    raise exception 'authenticated read rate_limit_attempts';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.rate_limit_attempts (action, subject_hash, expires_at)
    values ('client_probe', repeat('a', 64), now() + interval '1 hour');
    raise exception 'authenticated inserted into rate_limit_attempts';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.consume_rate_limit('client_probe', repeat('a', 64), 5, 60);
    raise exception 'authenticated executed consume_rate_limit';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

-- The service role: N attempts pass, the next is refused and not recorded, a
-- different key keeps its own budget, and the call holds the key's lock.
set local role service_role;
do $$
declare
  key_a constant text := repeat('a', 64);
  key_b constant text := repeat('b', 64);
  attempt integer;
begin
  for attempt in 1..3 loop
    if not public.consume_rate_limit('probe_action', key_a, 3, 3600) then
      raise exception 'attempt % within the limit was refused', attempt;
    end if;
  end loop;
  if public.consume_rate_limit('probe_action', key_a, 3, 3600) then
    raise exception 'attempt over the limit was allowed';
  end if;
  if (select count(*) from public.rate_limit_attempts
      where action = 'probe_action' and subject_hash = key_a) <> 3 then
    raise exception 'a refused attempt was recorded';
  end if;
  if not exists (select 1 from pg_locks where locktype = 'advisory' and pid = pg_backend_pid()) then
    raise exception 'consume_rate_limit did not take the per-key advisory lock';
  end if;

  -- Independent keys: another subject and another action under the same subject.
  if not public.consume_rate_limit('probe_action', key_b, 3, 3600) then
    raise exception 'another subject shared the exhausted budget';
  end if;
  if not public.consume_rate_limit('other_action', key_a, 3, 3600) then
    raise exception 'another action shared the exhausted budget';
  end if;

  -- Malformed input is rejected instead of being stored.
  begin
    perform public.consume_rate_limit('probe_action', 'person@example.test', 3, 3600);
    raise exception 'a clear-text subject was accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.consume_rate_limit('probe_action', key_a, 0, 3600);
    raise exception 'a zero maximum was accepted';
  exception when invalid_parameter_value then null;
  end;
end;
$$;
reset role;

-- An expired window frees the key, and expired rows are removed on the next call.
update public.rate_limit_attempts
set attempted_at = now() - interval '2 hours', expires_at = now() - interval '1 hour'
where action = 'probe_action' and subject_hash = repeat('a', 64);
set local role service_role;
do $$
begin
  if not public.consume_rate_limit('probe_action', repeat('a', 64), 3, 3600) then
    raise exception 'an expired window still refused the attempt';
  end if;
  if (select count(*) from public.rate_limit_attempts
      where action = 'probe_action' and subject_hash = repeat('a', 64)) <> 1 then
    raise exception 'expired attempts were not removed';
  end if;
end;
$$;
reset role;

-- Retention also sweeps expired rows of keys that never return.
update public.rate_limit_attempts
set attempted_at = now() - interval '2 hours', expires_at = now() - interval '1 hour'
where action = 'other_action';
set local role service_role;
do $$
begin
  perform public.consume_rate_limit('sweep_trigger', repeat('c', 64), 3, 3600);
  if exists (select 1 from public.rate_limit_attempts where action = 'other_action') then
    raise exception 'expired rows of an idle key were kept';
  end if;
end;
$$;
reset role;

rollback;
