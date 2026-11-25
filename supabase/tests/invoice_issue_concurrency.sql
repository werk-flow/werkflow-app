-- Two issues checked under the same number at the same time issue one
-- invoice under it, and an issue whose transaction rolls back uses no number
-- (migration 20270111100001_issue_invoices_with_gapless_numbers.sql). The
-- first session issues a draft and keeps its transaction open; the second
-- session's issue, checked under the same number, waits for the series' row
-- lock and, once the first commits, is refused invoice_number_moved without
-- using a number; checked again under the next number, it takes it. A third
-- issue rolls back; the number it took goes to the next issue.
--
-- The sessions need committed rows, so this file writes one synthetic
-- organization through dblink connections and deletes it at the start (a run
-- that broke off) and at the end. Deleting the organization is the one way an
-- issued invoice goes. The main session only orchestrates and rolls back.
--
-- The series carries no year, so no number depends on the day the test runs;
-- each issue names the Berlin day its own statement starts at, the day
-- issue_invoice takes once the series' lock is held. A run across midnight or
-- New Year changes no expected number; a race that crosses midnight says so.
-- The yearly restart is in invoice_issue.sql.
\connect postgres supabase_admin
begin;
set local search_path = public, extensions, pg_temp;
create extension if not exists dblink with schema extensions;
select dblink_connect('issue_race_setup', 'dbname=postgres user=postgres');
select dblink_connect('issue_race_first', 'dbname=postgres user=postgres');
select dblink_connect('issue_race_second', 'dbname=postgres user=postgres');

create temporary table issue_race_cleanup (statement text) on commit drop;
insert into issue_race_cleanup values
  ('delete from public.organizations where id = ''38070000-0000-4000-8000-000000000010'''),
  ('delete from auth.users where id = ''38070000-0000-4000-8000-000000000001''');
select dblink_exec('issue_race_setup', statement) from issue_race_cleanup;

select dblink_exec('issue_race_setup', $setup$
do $$
declare
  v_draft uuid;
begin
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values
  ('38070000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'issue-race-admin@example.test', '', now(), '{}'::jsonb,
   '{"first_name":"Erika","last_name":"Musterfrau"}'::jsonb, now(), now());
  insert into public.organizations (id, name, admin_id, unique_code) values
  ('38070000-0000-4000-8000-000000000010', 'Haustechnik Sonnenberg Rechnungsrennen',
   '38070000-0000-4000-8000-000000000001', 'ISSRACE');
  insert into public.invoice_settings (organization_id, number_prefix, number_with_year, number_min_digits,
    next_number)
  values ('38070000-0000-4000-8000-000000000010', 'RE-', false, 3, 1);
  insert into public.clients (id, organization_id, name, client_type, address) values
  ('38070000-0000-4000-8000-000000000020', '38070000-0000-4000-8000-000000000010',
   'Hausverwaltung Lindenhof GmbH', 'gewerblich', 'Hofweg 1, 10117 Berlin');
  -- Four complete drafts, 101 to 104.
  for v_draft in select ('38070000-0000-4000-8000-00000000010' || n)::uuid from generate_series(1, 4) n loop
    insert into public.invoices (id, organization_id, client_id, recipient_client_id, service_start, service_end,
      line_net_cents, tax_cents, gross_cents, created_by, updated_by)
    values (v_draft, '38070000-0000-4000-8000-000000000010', '38070000-0000-4000-8000-000000000020',
      '38070000-0000-4000-8000-000000000020', date '2037-11-02', date '2037-11-02', 7200, 1368, 8568,
      '38070000-0000-4000-8000-000000000001', '38070000-0000-4000-8000-000000000001');
    insert into public.invoice_lines (organization_id, invoice_id, position, name, quantity, unit,
      unit_price_cents, tax_category, tax_rate_basis_points, net_cents)
    values ('38070000-0000-4000-8000-000000000010', v_draft, 1, 'Monteurstunde', 1, 'hour', 7200, 'S', 1900, 7200);
  end loop;
end $$
$setup$);

-- An issue of p_draft checked under the series' p_sequence-th number, on
-- p_day or else the Berlin day the statement starts at.
create function pg_temp.issue_statement(p_draft text, p_sequence integer, p_day date default null)
returns text language sql as $$
  select format($issue$select public.issue_invoice('38070000-0000-4000-8000-000000000001',
    '38070000-0000-4000-8000-000000000010', %L, 1, gen_random_uuid(),
    '{"organizationName":"Haustechnik Sonnenberg","profile":{},"files":{},"buyer":{}}', %L,
    coalesce(%L::date, (statement_timestamp() at time zone 'Europe/Berlin')::date)) ->> 'invoiceNumber'$issue$,
    p_draft, 'RE-' || lpad(p_sequence::text, 3, '0'), p_day);
$$;

-- The first issue holds its transaction open with its number taken.
select dblink_exec('issue_race_first', 'begin');
select dblink_exec('issue_race_first', 'set local role service_role');
select * from dblink('issue_race_first', pg_temp.issue_statement('38070000-0000-4000-8000-000000000101', 1))
  as first(number text);

-- The second issue is checked under the first one's number and its very day,
-- so only the number can make it stale.
create temporary table issue_race_day on commit drop as
select day from dblink('issue_race_first',
  'select issue_date from public.invoices where id = ''38070000-0000-4000-8000-000000000101''') as first(day date);
create temporary table issue_race_second_pid on commit drop as
select pid from dblink('issue_race_second', 'select pg_backend_pid()') as second(pid integer);
select dblink_exec('issue_race_second', 'set role service_role');
select dblink_send_query('issue_race_second',
  pg_temp.issue_statement('38070000-0000-4000-8000-000000000102', 1, (select day from issue_race_day)));

do $$
declare
  v_pid integer := (select pid from issue_race_second_pid);
  v_deadline timestamptz := clock_timestamp() + interval '10 seconds';
begin
  while cardinality(pg_blocking_pids(v_pid)) = 0 loop
    if clock_timestamp() > v_deadline then
      raise exception 'the second issue never waited for the first one''s number';
    end if;
  end loop;
end $$;

select dblink_exec('issue_race_first', 'commit');

do $$
declare
  v_message text;
  v_second text;
  v_numbers text[];
begin
  perform * from dblink_get_result('issue_race_second', false) as result(number text);
  v_message := dblink_error_message('issue_race_second');
  perform * from dblink_get_result('issue_race_second', false) as done(number text);
  -- The second issue read its day after the first committed, so before now: on
  -- the same Berlin day still, its refusal came from the number.
  if (clock_timestamp() at time zone 'Europe/Berlin')::date is distinct from (select day from issue_race_day) then
    raise exception 'the race crossed Berlin midnight, so its refusal proves nothing; run it again';
  end if;
  if position('invoice_number_moved' in coalesce(v_message, '')) = 0 then
    raise exception 'an issue checked under a number another issue took answered %', v_message;
  end if;
  select number into v_second
  from dblink('issue_race_second', pg_temp.issue_statement('38070000-0000-4000-8000-000000000102', 2))
    as second(number text);
  select array_agg(invoice_number order by invoice_number) into v_numbers
  from dblink('issue_race_setup', $read$
    select invoice_number from public.invoices where organization_id = '38070000-0000-4000-8000-000000000010'
      and invoice_number is not null
  $read$) as issued(invoice_number text);
  if v_second is distinct from 'RE-002' or v_numbers is distinct from array['RE-001', 'RE-002'] then
    raise exception 'two concurrent issues got % (the second, checked again, answered %)', v_numbers, v_second;
  end if;
end $$;

-- An issue that rolls back uses no number: the next issue takes it.
select dblink_exec('issue_race_first', 'begin');
select dblink_exec('issue_race_first', 'set local role service_role');
select * from dblink('issue_race_first', pg_temp.issue_statement('38070000-0000-4000-8000-000000000103', 3))
  as rolled_back(number text);
select dblink_exec('issue_race_first', 'rollback');
do $$
declare
  v_number text;
begin
  select number into v_number
  from dblink('issue_race_second', pg_temp.issue_statement('38070000-0000-4000-8000-000000000103', 3))
    as third(number text);
  if v_number is distinct from 'RE-003' then
    raise exception 'an issue after a rolled-back one got %, a number went missing', v_number;
  end if;
end $$;

-- A direct line delete that races an issue waits for it and is then refused:
-- no line of an issued invoice goes, whoever writes.
select dblink_exec('issue_race_first', 'begin');
select dblink_exec('issue_race_first', 'set local role service_role');
select * from dblink('issue_race_first', pg_temp.issue_statement('38070000-0000-4000-8000-000000000104', 4))
  as issuing(number text);
select dblink_send_query('issue_race_second',
  'delete from public.invoice_lines where invoice_id = ''38070000-0000-4000-8000-000000000104''');
do $$
declare
  v_pid integer := (select pid from issue_race_second_pid);
  v_deadline timestamptz := clock_timestamp() + interval '10 seconds';
begin
  while cardinality(pg_blocking_pids(v_pid)) = 0 loop
    if clock_timestamp() > v_deadline then
      raise exception 'a line delete never waited for the issue in flight';
    end if;
  end loop;
end $$;
select dblink_exec('issue_race_first', 'commit');
do $$
declare
  v_message text;
  v_lines bigint;
begin
  perform * from dblink_get_result('issue_race_second', false) as result(status text);
  v_message := dblink_error_message('issue_race_second');
  perform * from dblink_get_result('issue_race_second', false) as result(status text);
  select lines into v_lines from dblink('issue_race_setup', $read$
    select count(*) from public.invoice_lines where invoice_id = '38070000-0000-4000-8000-000000000104'
  $read$) as remaining(lines bigint);
  if position('invoice_issued' in coalesce(v_message, '')) = 0 or v_lines is distinct from 1::bigint then
    raise exception 'a line delete that raced the issue answered % and left % lines', v_message, v_lines;
  end if;
end $$;

select dblink_exec('issue_race_setup', statement) from issue_race_cleanup;

select dblink_disconnect('issue_race_second');
select dblink_disconnect('issue_race_first');
select dblink_disconnect('issue_race_setup');
rollback;
