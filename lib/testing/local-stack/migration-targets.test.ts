import { expect, test } from 'bun:test';
import { migrationChanges, sharedChanges } from './migration-targets';

const named = (sql: string): string[] =>
  migrationChanges(sql).targets.map((found) => `${found.kind} ${found.schema}.${found.name}`);

test('a table, its columns, constraints, indexes, comments and rows name the table', () => {
  expect(
    named(`
      create table if not exists public.jobs (id uuid primary key, note text default 'a;b');
      alter table only jobs add column due date, enable row level security;
      create unique index concurrently if not exists jobs_due_idx on public.jobs (due);
      create index on "Jobs" using btree (id);
      comment on column public.jobs.due is 'Fällig; im Kalender';
      comment on table jobs is 'x';
      insert into jobs (id) values (gen_random_uuid()) on conflict (id) do update set note = excluded.note;
      update only jobs set note = '' where id is null;
      delete from app_private.queue where true;
      with gone as (delete from archive returning id) select count(*) from gone;
      truncate table jobs_staging, jobs_old;
    `),
  ).toEqual([
    'relation public.jobs',
    'relation public.jobs',
    'relation public.jobs',
    'relation public.jobs_due_idx',
    'relation public.Jobs',
    'relation public.jobs',
    'relation public.jobs',
    'relation public.jobs',
    'relation public.jobs',
    'relation app_private.queue',
    'relation public.archive',
    'relation public.jobs_staging',
    'relation public.jobs_old',
  ]);
});

test('a function names itself, never what its body writes', () => {
  const sql = `
    create or replace function app_private.close_period(p_id uuid, p_at timestamptz default now())
    returns void language plpgsql security definer set search_path = '' as $fn$
    begin
      insert into public.audit_events (id) values (p_id); -- not a target of this migration
      update public.periods set closed = true where id = p_id;
    end $fn$;
    alter function app_private.close_period(uuid, timestamptz) owner to postgres;
    revoke all on function app_private.close_period(uuid, timestamptz) from public, anon;
    grant execute on function app_private.close_period(uuid, timestamptz), public.other() to authenticated;
    drop function if exists public.old_one(int), public.old_two();
  `;
  expect(named(sql)).toEqual([
    'function app_private.close_period',
    'function app_private.close_period',
    'function app_private.close_period',
    'function app_private.close_period',
    'function public.other',
    'function public.old_one',
    'function public.old_two',
  ]);
});

test('policies and triggers are named with their table', () => {
  expect(
    named(`
      create policy "Büro sieht alles" on public.jobs for select to authenticated using (true);
      drop policy if exists "Büro sieht alles" on public.jobs;
      create trigger touch_jobs before insert or update of note on public.jobs for each row execute function touch();
      drop trigger if exists touch_jobs on jobs;
      create or replace trigger on_signup after insert on auth.users for each row execute function public.handle();
    `),
  ).toEqual([
    'policy public.jobs.Büro sieht alles',
    'policy public.jobs.Büro sieht alles',
    'trigger public.jobs.touch_jobs',
    'trigger public.jobs.touch_jobs',
    'trigger auth.users.on_signup',
  ]);
});

test('types, schemas, extensions, roles, publications and cron jobs are named', () => {
  expect(
    named(`
      create type public.job_state as enum ('offen', 'erledigt');
      alter type job_state add value if not exists 'geparkt';
      create schema if not exists app_private;
      create extension if not exists pg_cron with schema extensions;
      grant usage on schema app_private to service_role;
      grant app_reader to authenticator;
      alter publication supabase_realtime add table public.jobs, public.visits;
      select cron.schedule('nightly-cleanup', '0 3 * * *', 'select 1');
      select pg_catalog.set_config('search_path', '', false);
      notify pgrst, 'reload schema';
    `),
  ).toEqual([
    'type public.job_state',
    'type public.job_state',
    'schema .app_private',
    'extension .pg_cron',
    'schema .app_private',
    'role .authenticator',
    'publication .supabase_realtime.public.jobs',
    'publication .supabase_realtime.public.visits',
    'cron job cron.nightly-cleanup',
  ]);
});

test('an unqualified name stands for every schema on the search path, and an unknown path makes it opaque', () => {
  expect(
    named(
      "set search_path to app_private, public; create table t (id int); alter table public.u add c int; set search_path to 'app_private'; update jobs set id = 1; reset search_path; delete from v;",
    ),
  ).toEqual([
    'relation app_private.t',
    'relation public.t',
    'relation public.u',
    'relation app_private.jobs',
    'relation public.v',
  ]);
  expect(named("select set_config('search_path', 'app_private, extensions', false); truncate w;")).toEqual([
    'relation app_private.w',
    'relation extensions.w',
  ]);
  const unknown = migrationChanges(
    "select pg_catalog.set_config('search_path', '', false); insert into jobs values (1); insert into public.kept values (1);",
  );
  expect(unknown.opaque).toEqual(['insert into jobs values (1)']);
  expect(unknown.targets).toEqual([{ kind: 'relation', schema: 'public', name: 'kept' }]);
  // A path built by an expression is unknown, not its first literal.
  expect(
    migrationChanges(
      "select set_config('search_path', 'pub' || 'lic', false); alter table jobs add column a int;",
    ).opaque,
  ).toEqual(['alter table jobs add column a int']);
});

test('SELECT INTO, SET SCHEMA and RENAME TO name the object under its new identity', () => {
  expect(
    named(`
      select 1 as id into public.copied;
      with source as (select 1 as id) select id into temp scratch from source;
      alter table public.jobs set schema app_private;
      alter function public.f(int) set schema app_private;
      alter table jobs rename to work_orders;
      alter policy old_name on jobs rename to new_name;
    `),
  ).toEqual([
    'relation public.copied',
    'relation public.scratch',
    'relation public.jobs',
    'relation app_private.jobs',
    'function public.f',
    'function app_private.f',
    'relation public.jobs',
    'relation public.work_orders',
    'policy public.jobs.old_name',
    'policy public.jobs.new_name',
  ]);
});

test('a non-ASCII name is read whole, and an unquoted one folds only ASCII letters', () => {
  const unquoted = migrationChanges('alter table Büro add column x int;');
  expect(sharedChanges(unquoted, migrationChanges('alter table "büro" add column y int;'))).toEqual([
    'relation public.büro',
  ]);
  expect(named('create function prüfe() returns int as $körper$ select 1; $körper$ language sql;')).toEqual([
    'function public.prüfe',
  ]);
});

test('a statement the reader cannot name a target for is opaque', () => {
  const changes = migrationChanges(`
    do $$ begin perform 1; end $$;
    alter default privileges in schema public revoke execute on functions from anon;
    select public.backfill_jobs();
    create table kept (id int);
  `);
  expect(changes.opaque).toEqual([
    'do $$ begin perform 1; end $$',
    'alter default privileges in schema public revoke execute on ',
    'select public.backfill_jobs()',
  ]);
  expect(changes.targets).toEqual([{ kind: 'relation', schema: 'public', name: 'kept' }]);
});

test('comments and quoted semicolons never split a statement', () => {
  expect(
    named(`
      /* a block; /* nested; */ still a comment; */
      create table a (note text default E'it\\'s; fine');
      -- create table b (id int);
      create table "c;d" (id int);
    `),
  ).toEqual(['relation public.a', 'relation public.c;d']);
});

test('two migrations conflict on one object, a schema-wide grant or an opaque statement, and not on separate objects', () => {
  const read = migrationChanges;
  const jobs = read('alter table jobs add column a int;');
  expect(sharedChanges(jobs, read('create index jobs_a on public.jobs (a);'))).toEqual([
    'relation public.jobs',
  ]);
  expect(sharedChanges(jobs, read('alter table visits add column a int;'))).toEqual([]);
  expect(sharedChanges(jobs, read('grant select on all tables in schema public to authenticated;'))).toEqual([
    'relation public.jobs',
  ]);
  expect(sharedChanges(jobs, read('do $$ begin end $$;'))).toEqual([
    'a statement it cannot read on the other side ("do $$ begin end $$")',
  ]);
  expect(
    sharedChanges(
      read('create function f() returns int as $$ select 1 $$ language sql;'),
      read('drop function f(int);'),
    ),
  ).toEqual(['function public.f']);
  // Realtime membership of different tables commutes; a whole-publication change does not.
  const realtime = read('alter publication supabase_realtime add table jobs;');
  expect(sharedChanges(realtime, read('alter publication supabase_realtime add table visits;'))).toEqual([]);
  expect(
    sharedChanges(realtime, read('alter publication supabase_realtime set (publish = insert);')),
  ).toEqual(['publication supabase_realtime.public.jobs']);
  // Policies with different names on one table commute.
  expect(
    sharedChanges(
      read('create policy a on jobs using (true);'),
      read('create policy b on jobs using (true);'),
    ),
  ).toEqual([]);
});

test('a view, CREATE TABLE AS and a data copy conflict with a newer change to what they read', () => {
  const addNote = migrationChanges('alter table jobs add column note text;');
  for (const reader of [
    'create view job_summary as select * from public.jobs j join visits v on v.job_id = j.id;',
    'create table job_copy as select * from jobs;',
    'with fresh as (select id from jobs) insert into archive select * from fresh;',
    'update visits set due = j.due from archive a, jobs j where j.id = visits.job_id;',
  ])
    expect(sharedChanges(migrationChanges(reader), addNote), reader).toEqual(['relation public.jobs']);
  // A pure SELECT changes nothing.
  expect(sharedChanges(migrationChanges('select count(*) from jobs;'), addNote)).toEqual([]);
});

test('SET SCHEMA moves the search path, and creating or dropping a publication changes all of it', () => {
  expect(named("set schema 'app_private'; alter table jobs add column flag int;")).toEqual([
    'relation app_private.jobs',
  ]);
  expect(
    sharedChanges(
      migrationChanges('alter publication supabase_realtime add table jobs;'),
      migrationChanges('drop publication supabase_realtime; create publication supabase_realtime;'),
    ),
  ).toEqual(['publication supabase_realtime.public.jobs']);
});
