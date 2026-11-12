// Rule test: a private copy of the shared stack answers for a tree's types only when it is that
// tree's schema and nothing the tree runs there can change the shared cluster: the stack holds
// nothing the tree lacks and can prove it, every pending statement is one database's DDL, none
// reaches outside the copy, and no migration of the tree changes roles, databases or settings.
import { expect, test } from 'bun:test';

import { copyRefusal } from './stack-copy';

const pending = { stackOnly: [], treeOnly: ['add_a_table'], changed: [], unverified: [] };

test("a tree that only adds one database's schema objects may use the copy", () => {
  expect(
    copyRefusal(
      pending,
      [
        `set local search_path = '';
         create table public.added (id uuid primary key, note text);
         create unique index added_note on public.added (note);
         -- grant admin to nobody; a comment is no statement
         grant select, insert on public.added to authenticated;
         revoke all on public.added from anon;
         create policy "members read" on public.added for select to authenticated using (true);
         create or replace function public.added_count() returns integer language plpgsql as $$
         begin
           return (select count(*) from public.added);
         end $$;
         create trigger added_touch after insert on public.added for each row execute function public.added_count();
         grant execute on function public.added_count() to authenticated;
         alter publication supabase_realtime add table public.added;
         alter default privileges in schema public revoke execute on functions from public;
         comment on table public.added is 'a list; with a semicolon inside';`,
      ],
      ['create table public.first (id int);'],
    ),
  ).toBeUndefined();
});

test('a stack that holds what the tree lacks, or cannot prove what it ran, is no base for the tree', () => {
  expect(copyRefusal({ ...pending, stackOnly: ['merged_after_this_branch'] }, [], [])).toContain(
    'merge main',
  );
  expect(copyRefusal({ ...pending, changed: ['reviewed_again'] }, [], [])).toContain('other statements');
  expect(copyRefusal({ ...pending, unverified: ['repaired'] }, [], [])).toContain('without their statements');
});

test('a pending statement that runs code or is no database-local DDL goes to a fresh stack', () => {
  for (const sql of [
    // The guard reads top-level statements, so a body cannot hide one.
    'DO $$ BEGIN CREATE ROLE reporting; END $$;',
    'do $$ begin perform public.backfill(); end $$;',
    'select public.backfill();',
    'call public.backfill();',
    "insert into public.settings (key) values ('a');",
    'update public.jobs set state = state;',
    'delete from public.jobs where false;',
    'create extension if not exists btree_gist with schema extensions;',
    "copy public.jobs from '/tmp/jobs.csv';",
    'create role reporting;',
    'alter role authenticator set statement_timeout = 8000;',
    'grant reporting to authenticated;',
    'revoke reporting from authenticated;',
    'alter system set max_connections = 200;',
    "alter database postgres set timezone to 'Europe/Berlin';",
    'grant connect on database postgres to anon;',
    'comment on role authenticator is $$x$$;',
  ])
    expect(copyRefusal(pending, [sql], []), sql).toContain('runs code or reaches past a private database');
});

test('a function body that changes the cluster or runs dynamic SQL goes to a fresh stack', () => {
  for (const body of [
    'create role reporting;',
    'grant reporting to authenticated;',
    "execute format('create %s reporting', 'role');",
    'execute v_statement;',
    "perform cron.schedule('purge', '0 3 * * *', 'select 1');",
    "perform dblink_exec('host=x', 'select 1');",
  ]) {
    const sql = `create function public.f() returns void language plpgsql as $$ begin ${body} end $$;`;
    expect(copyRefusal(pending, [sql], []), body).toContain('reaches past a private database');
  }
});

test("a tree whose migrations change the cluster lends the copy none of its functions' calls", () => {
  const tree = [
    'create function public.provision() returns void language plpgsql as $$ begin create role reporting; end $$;',
  ];
  expect(copyRefusal(pending, ['create index jobs_state on public.jobs (state);'], tree)).toContain(
    'a migration of this tree changes the cluster',
  );
});
