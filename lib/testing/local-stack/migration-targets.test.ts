import { expect, test } from 'bun:test';
import { migrationChanges, sharedChanges } from './migration-targets';

/** Each target as `kind schema.name (part)`; an unqualified name has no schema. */
const named = (sql: string): string[] =>
  migrationChanges(sql).targets.map(
    (found) =>
      `${found.kind} ${found.schema === null ? '' : `${found.schema}.`}${found.name}${found.part === null ? '' : ` (${found.part})`}`,
  );

const shared = (left: string, right: string): string[] =>
  sharedChanges(migrationChanges(left), migrationChanges(right));

test('a table, its columns, constraints, indexes and comments name the table', () => {
  expect(
    named(`
      create table if not exists public.jobs (id uuid primary key, note text default 'a;b');
      alter table only jobs add column due date, enable row level security;
      create unique index concurrently if not exists jobs_due_idx on public.jobs (due);
      create index on "Jobs" using btree (id);
      comment on column public.jobs.due is 'Fällig; im Kalender';
      comment on column jobs.note is 'x';
      comment on table jobs is 'x';
      truncate table jobs_staging, jobs_old;
    `),
  ).toEqual([
    'object public.jobs',
    'object jobs',
    'object public.jobs',
    'object public.jobs_due_idx',
    'object Jobs',
    'object public.jobs',
    'object jobs',
    'object jobs',
    'object jobs_staging',
    'object jobs_old',
  ]);
});

test('a data statement names what it writes, what it reads and what it calls', () => {
  expect(
    named(
      'insert into jobs (id) values (gen_random_uuid()) on conflict (id) do update set note = excluded.note;',
    ),
  ).toEqual(['object jobs', 'object values', 'object gen_random_uuid', 'object conflict']);
  expect(named('update only jobs set note = app.label(id) where id is null;')).toEqual([
    'object jobs',
    'object app.label',
  ]);
  // A WITH query's name counts as a read, and so does every word before a parenthesis, keywords
  // included: each matches only an object of that name.
  expect(
    named('with gone as (delete from app_private.queue returning id) select count(*) from gone;'),
  ).toEqual(['object app_private.queue', 'object as', 'object count', 'object gone']);
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
    drop function if exists public.old_one(int), old_two();
  `;
  expect(named(sql)).toEqual([
    'object app_private.close_period',
    'object app_private.close_period',
    'object app_private.close_period',
    'object app_private.close_period',
    'object public.other',
    'object public.old_one',
    'object old_two',
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
      alter policy old_name on jobs rename to new_name;
    `),
  ).toEqual([
    'policy public.jobs (Büro sieht alles)',
    'policy public.jobs (Büro sieht alles)',
    'trigger public.jobs (touch_jobs)',
    'trigger jobs (touch_jobs)',
    'trigger auth.users (on_signup)',
    'policy jobs (old_name)',
    'policy jobs (new_name)',
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
      alter publication supabase_realtime add table public.jobs, visits;
      select cron.schedule('nightly-cleanup', '0 3 * * *', 'select 1');
      select pg_catalog.set_config('search_path', '', false);
      notify pgrst, 'reload schema';
    `),
  ).toEqual([
    'object public.job_state',
    'object job_state',
    'schema app_private',
    'extension pg_cron',
    'schema app_private',
    'role authenticator',
    'publication public.jobs (supabase_realtime)',
    'publication visits (supabase_realtime)',
    'cron job nightly-cleanup',
  ]);
});

test('an unqualified name matches the name in every schema, whatever the search path', () => {
  // Each of these leaves `jobs` in a schema only PostgreSQL's search path rules could tell.
  for (const prefix of [
    '',
    'set search_path to app_private;',
    "set local schema 'app_private';",
    "begin; select set_config('search_path', 'app_private', true and false); commit;",
    "create view path_view as select set_config('search_path', 'app_private', false);",
    'begin; set search_path to app_private; rollback;',
    'begin; set local search_path to app_private; savepoint s; release s; commit;',
  ]) {
    const sql = `${prefix} alter table jobs add column flag int;`;
    expect(shared(sql, 'alter table public.jobs add column a int;'), prefix).toEqual(['public.jobs']);
    expect(shared(sql, 'alter table app_private.jobs add column a int;'), prefix).toEqual([
      'app_private.jobs',
    ]);
    expect(shared(sql, 'alter table app_private.visits add column a int;'), prefix).toEqual([]);
  }
  // A written schema matches only itself.
  expect(shared('alter table public.jobs add a int;', 'alter table app_private.jobs add b int;')).toEqual([]);
});

test('a table, view, function and type of one name are one target', () => {
  const replaced =
    'create or replace function public.source_rows() returns setof jobs language sql as $$ select 1 $$;';
  expect(shared('create table snapshot as select * from public.source_rows();', replaced)).toEqual([
    'public.source_rows',
  ]);
  expect(
    shared(
      'insert into archive select price(id) from jobs;',
      'create or replace function price(int) returns int as $$ select 1 $$ language sql;',
    ),
  ).toEqual(['price']);
  expect(shared("create type public.state as enum ('a');", 'drop view if exists state;')).toEqual([
    'public.state',
  ]);
});

test('SELECT INTO, SET SCHEMA and RENAME TO name the object under its new identity', () => {
  expect(
    named(`
      select 1 as id into public.copied;
      alter table public.jobs set schema app_private;
      alter function public.f(int) set schema app_private;
      alter table jobs rename to work_orders;
    `),
  ).toEqual([
    'object public.copied',
    'object public.jobs',
    'object app_private.jobs',
    'object public.f',
    'object app_private.f',
    'object jobs',
    'object work_orders',
  ]);
  expect(named('with source as (select 1 as id) select id into temp scratch from source;')).toEqual([
    'object scratch',
    'object as',
    'object source',
  ]);
});

test('a non-ASCII name is read whole, and an unquoted one folds only ASCII letters', () => {
  expect(shared('alter table Büro add column x int;', 'alter table "büro" add column y int;')).toEqual([
    'büro',
  ]);
  expect(named('create function prüfe() returns int as $körper$ select 1; $körper$ language sql;')).toEqual([
    'object prüfe',
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
  expect(changes.targets).toEqual([{ kind: 'object', schema: null, name: 'kept', part: null }]);
});

test('comments and quoted semicolons never split a statement', () => {
  expect(
    named(`
      /* a block; /* nested; */ still a comment; */
      create table a (note text default E'it\\'s; fine');
      -- create table b (id int);
      create table "c;d" (id int);
    `),
  ).toEqual(['object a', 'object c;d']);
});

test('two migrations conflict on one object, a schema-wide grant or an opaque statement, and not on separate objects', () => {
  const jobs = 'alter table jobs add column a int;';
  expect(shared(jobs, 'create index jobs_a on public.jobs (a);')).toEqual(['public.jobs']);
  expect(shared(jobs, 'alter table visits add column a int;')).toEqual([]);
  expect(shared(jobs, 'grant select on all tables in schema public to authenticated;')).toEqual(['jobs']);
  expect(
    shared(
      'alter table app_private.jobs add a int;',
      'grant select on all tables in schema public to authenticated;',
    ),
  ).toEqual([]);
  expect(shared(jobs, 'do $$ begin end $$;')).toEqual([
    'a statement it cannot read on the other side ("do $$ begin end $$")',
  ]);
  expect(
    shared('create function f() returns int as $$ select 1 $$ language sql;', 'drop function f(int);'),
  ).toEqual(['f']);
  // Realtime membership of different tables commutes; a whole-publication change does not.
  const realtime = 'alter publication supabase_realtime add table jobs;';
  expect(shared(realtime, 'alter publication supabase_realtime add table visits;')).toEqual([]);
  expect(shared(realtime, 'alter publication supabase_realtime set (publish = insert);')).toEqual([
    'publication supabase_realtime, table jobs',
  ]);
  expect(
    shared(realtime, 'drop publication supabase_realtime; create publication supabase_realtime;'),
  ).toEqual(['publication supabase_realtime, table jobs']);
  // Policies with different names on one table commute.
  expect(shared('create policy a on jobs using (true);', 'create policy b on jobs using (true);')).toEqual(
    [],
  );
  expect(shared('create policy a on jobs using (true);', 'drop policy a on public.jobs;')).toEqual([
    'policy a on public.jobs',
  ]);
});

test('a view, CREATE TABLE AS and a data copy conflict with a newer change to what they read', () => {
  const addNote = 'alter table jobs add column note text;';
  for (const reader of [
    'create view job_summary as select * from public.jobs j join visits v on v.job_id = j.id;',
    'create table job_copy as select * from jobs;',
    'with fresh as (select id from jobs) insert into archive select * from fresh;',
    'update visits set due = j.due from archive a, jobs j where j.id = visits.job_id;',
    'with jobs as (select * from jobs) insert into archive select * from jobs;',
    'create view summary as select j.* from (select 1) seed, jobs j;',
  ])
    expect(shared(reader, addNote), reader).toEqual([
      reader.includes('public.jobs') ? 'public.jobs' : 'jobs',
    ]);
  // A pure SELECT changes nothing.
  expect(shared('select count(*) from jobs;', addNote)).toEqual([]);
});

test('a table definition conflicts with a change to the table or type it takes its shape from', () => {
  const addNote = 'alter table jobs add column note text;';
  for (const copy of [
    'create table archive (like jobs including all);',
    'create table archive (id int, like public.jobs);',
    'create table archive (id int) inherits (audit, jobs);',
    'create table archive partition of jobs for values in (1);',
    'create foreign table archive (id int) inherits (jobs) server s;',
    'alter table archive inherit jobs;',
    'alter table archive no inherit jobs;',
    'alter table archive attach partition jobs for values in (1);',
    'alter table archive detach partition jobs;',
  ]) {
    const name = copy.includes('public.jobs') ? 'public.jobs' : 'jobs';
    // The copy older than the change, and the change older than the copy.
    expect(shared(copy, addNote), copy).toEqual([name]);
    expect(shared(addNote, copy), copy).toEqual([name]);
  }
  expect(shared('create table archive of job_row;', 'alter type job_row add attribute note text;')).toEqual([
    'job_row',
  ]);
  expect(named('alter table archive not of;')).toEqual(['object archive']);
  // A check's LIKE compares text and names no table.
  expect(named("create table archive (mail text check (mail like '%@%'));")).toEqual(['object archive']);
});

test('a statement with CASCADE is opaque, but a foreign key rule is not', () => {
  for (const cascade of [
    'drop schema scratchpad cascade;',
    'drop table if exists jobs cascade;',
    'drop function touch() cascade;',
    'truncate jobs cascade;',
    'revoke grant option for select on jobs from office cascade;',
    // A schema named like a foreign key action (CodeRabbit on #482).
    'drop schema delete cascade;',
    'drop table update cascade;',
    'drop trigger cleanup on delete cascade;',
  ])
    expect(migrationChanges(cascade).opaque, cascade).toHaveLength(1);
  expect(
    shared(
      'create table scratchpad.items (id int);',
      'drop schema scratchpad cascade; create schema scratchpad;',
    ),
  ).toEqual(['a statement it cannot read on the other side ("drop schema scratchpad cascade")']);
  expect(
    named(`
      create table visits (job_id int references jobs on delete cascade on update cascade);
      comment on table visits is 'cascade';
      create table "cascade" (id int);
    `),
  ).toEqual(['object visits', 'object visits', 'object cascade']);
});

test('a policy, trigger or publication member conflicts with any change to its table, and not with another one beside it', () => {
  const trigger =
    'create trigger touch_widgets before update on widgets for each row execute function touch();';
  for (const table of [
    'drop table widgets; create table widgets (id int);',
    'alter table public.widgets rename to gadgets;',
    'alter table widgets set schema app_private;',
    'alter table widgets add column note text;',
  ]) {
    expect(shared(trigger, table), table).toEqual(['trigger touch_widgets on widgets']);
    expect(shared(table, trigger), table).toEqual(['trigger touch_widgets on widgets']);
  }
  expect(shared('create policy a on public.widgets using (true);', 'drop table widgets;')).toEqual([
    'policy a on public.widgets',
  ]);
  expect(shared('alter publication supabase_realtime add table widgets;', 'drop table widgets;')).toEqual([
    'publication supabase_realtime, table widgets',
  ]);
  // Different names beside one table commute, and a table of another name is apart.
  expect(shared(trigger, 'create policy a on widgets using (true);')).toEqual([]);
  expect(
    shared(
      trigger,
      'create trigger audit_widgets after insert on widgets for each row execute function audit();',
    ),
  ).toEqual([]);
  expect(shared(trigger, 'drop table gadgets;')).toEqual([]);
  expect(shared(trigger, 'alter publication supabase_realtime set (publish = insert);')).toEqual([]);
});
