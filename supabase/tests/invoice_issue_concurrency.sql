-- Two issues that run at the same time get two consecutive numbers, and an
-- issue whose transaction rolls back uses none
-- (migration 20261216100000_issue_invoices_with_gapless_numbers.sql). The
-- first session issues a draft and keeps its transaction open; the second
-- session's issue waits for the series' row lock and, once the first
-- commits, takes the next number. A third issue rolls back; the number it
-- took goes to the next issue.
--
-- The sessions need committed rows, so this file writes one synthetic
-- organization through dblink connections and deletes it at the start (a run
-- that broke off) and at the end. Deleting the organization is the one way an
-- issued invoice goes. The main session only orchestrates and rolls back.
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
  insert into public.clients (id, organization_id, name, client_type, address) values
  ('38070000-0000-4000-8000-000000000020', '38070000-0000-4000-8000-000000000010',
   'Hausverwaltung Lindenhof GmbH', 'gewerblich', 'Hofweg 1, 10117 Berlin');
  -- Three complete drafts, 101 to 103.
  for v_draft in select ('38070000-0000-4000-8000-00000000010' || n)::uuid from generate_series(1, 3) n loop
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

create function pg_temp.issue_statement(p_draft text) returns text language sql as $$
  select format($issue$select public.issue_invoice('38070000-0000-4000-8000-000000000001',
    '38070000-0000-4000-8000-000000000010', %L, 1, gen_random_uuid(),
    '{"organizationName":"Haustechnik Sonnenberg","profile":{},"files":{},"buyer":{}}') ->> 'invoiceNumber'$issue$,
    p_draft);
$$;

-- The first issue holds its transaction open with its number taken.
select dblink_exec('issue_race_first', 'begin');
select dblink_exec('issue_race_first', 'set local role service_role');
select * from dblink('issue_race_first', pg_temp.issue_statement('38070000-0000-4000-8000-000000000101'))
  as first(number text);

create temporary table issue_race_second_pid on commit drop as
select pid from dblink('issue_race_second', 'select pg_backend_pid()') as second(pid integer);
select dblink_exec('issue_race_second', 'set role service_role');
select dblink_send_query('issue_race_second', pg_temp.issue_statement('38070000-0000-4000-8000-000000000102'));

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
  v_year text := to_char(now() at time zone 'Europe/Berlin', 'YYYY');
  v_second text;
  v_numbers text[];
begin
  select number into v_second from dblink_get_result('issue_race_second') as second(number text);
  perform * from dblink_get_result('issue_race_second') as done(number text);
  select array_agg(invoice_number order by invoice_number) into v_numbers
  from dblink('issue_race_setup', $read$
    select invoice_number from public.invoices where organization_id = '38070000-0000-4000-8000-000000000010'
      and invoice_number is not null
  $read$) as issued(invoice_number text);
  if v_second is distinct from 'RE-' || v_year || '-002'
    or v_numbers is distinct from array['RE-' || v_year || '-001', 'RE-' || v_year || '-002'] then
    raise exception 'two concurrent issues got % (second answered %)', v_numbers, v_second;
  end if;
end $$;

-- An issue that rolls back uses no number: the next issue takes it.
select dblink_exec('issue_race_first', 'begin');
select dblink_exec('issue_race_first', 'set local role service_role');
select * from dblink('issue_race_first', pg_temp.issue_statement('38070000-0000-4000-8000-000000000103'))
  as rolled_back(number text);
select dblink_exec('issue_race_first', 'rollback');
do $$
declare
  v_year text := to_char(now() at time zone 'Europe/Berlin', 'YYYY');
  v_number text;
begin
  select number into v_number
  from dblink('issue_race_second', pg_temp.issue_statement('38070000-0000-4000-8000-000000000103'))
    as third(number text);
  if v_number is distinct from 'RE-' || v_year || '-003' then
    raise exception 'an issue after a rolled-back one got %, a number went missing', v_number;
  end if;
end $$;

select dblink_exec('issue_race_setup', statement) from issue_race_cleanup;

select dblink_disconnect('issue_race_second');
select dblink_disconnect('issue_race_first');
select dblink_disconnect('issue_race_setup');
rollback;
