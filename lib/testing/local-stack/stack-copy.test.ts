// Rule test: a private copy of the shared stack answers for a tree's types only when it is that
// tree's schema: the stack holds nothing the tree lacks, and no pending migration reaches past a
// private database into the shared cluster or needs what the copy cannot hold.
import { expect, test } from 'bun:test';

import { copyRefusal } from './stack-copy';

const pending = { stackOnly: [], treeOnly: ['add_a_table'], changed: [] };

test("a tree that only adds its own migrations to the stack's may use the copy", () => {
  expect(
    copyRefusal(pending, [
      `create table public.added (id uuid primary key);
       -- grant admin to nobody; a comment is no statement
       grant select, insert on public.added to authenticated;
       revoke all on public.added from anon;
       create policy "members read" on public.added for select to authenticated using (true);
       comment on table public.added is 'create role is only a word here';`,
    ]),
  ).toBeUndefined();
});

test('a stack that holds what the tree lacks is no base for the tree', () => {
  expect(copyRefusal({ ...pending, stackOnly: ['merged_after_this_branch'] }, [])).toContain('merge main');
  expect(copyRefusal({ ...pending, changed: ['reviewed_again'] }, [])).toContain('other statements');
});

test('a pending migration that reaches past a private database goes to a fresh stack', () => {
  for (const sql of [
    'create role reporting;',
    'alter role authenticator set statement_timeout = 8000;',
    'create table public.a (id int);\ngrant reporting to authenticated;',
    'revoke reporting from authenticated;',
    'alter system set max_connections = 200;',
    'alter database postgres set timezone to "Europe/Berlin";',
    "select cron.schedule('purge', '0 3 * * *', $$select public.purge()$$);",
    'create extension if not exists pg_cron with schema pg_catalog;',
  ])
    expect(copyRefusal(pending, [sql]), sql).toContain('reaches past a private database');
});
