// Rule test: the shared stack drifts from a tree when it holds a migration name the tree lacks,
// lacks one of the tree's, or applied other statements under the same name. Versions, comments and
// layout never count, so a migration renamed before merge is no drift.
import { expect, test } from 'bun:test';

import { driftLine, localDriftNotice, migrationDrift, readsSharedStack, sqlShape } from './migration-drift';

const FILE = `-- Close the period on the latest decision.
create or replace function public.close_period(p_id uuid)
returns void language plpgsql as $body$
begin
  -- a comment inside the body is part of the function
  update public.periods set closed = true where id = p_id;
end;
$body$;

/* grants /* nested */ follow */
revoke all on function public.close_period(uuid) from public;
grant execute on function public.close_period(uuid) to service_role;
`;

/** The statements the Supabase CLI records for FILE: cut at top-level semicolons and trimmed. */
const RECORDED = [
  `-- Close the period on the latest decision.
create or replace function public.close_period(p_id uuid)
returns void language plpgsql as $body$
begin
  -- a comment inside the body is part of the function
  update public.periods set closed = true where id = p_id;
end;
$body$`,
  `/* grants /* nested */ follow */
revoke all on function public.close_period(uuid) from public`,
  'grant execute on function public.close_period(uuid) to service_role',
];

test('recorded statements have the shape of the file they came from, whatever its comments, layout or line endings', () => {
  expect(sqlShape(RECORDED.join('\n;\n'))).toBe(sqlShape(FILE));
  const relaid = FILE.replace('-- Close the period on the latest decision.', '-- Reworded header.')
    .replace('/* grants /* nested */ follow */', '')
    .replace(/\n/g, '\r\n');
  expect(sqlShape(relaid)).toBe(sqlShape(FILE));
});

test('a change inside a literal, an identifier or a function body changes the shape', () => {
  for (const [from, to] of [
    ['closed = true', 'closed = false'],
    ['a comment inside the body', 'another comment inside the body'],
    ['service_role', 'authenticated'],
  ] as const)
    expect(sqlShape(FILE.replace(from, to)), to).not.toBe(sqlShape(FILE));
  expect(sqlShape("select 'a  -- b'")).not.toBe(sqlShape("select 'a -- b'"));
  expect(sqlShape('select "A  b"')).not.toBe(sqlShape('select "A b"'));
  expect(sqlShape("select E'it\\'s -- here'")).toBe("select E'it\\'s -- here'");
  expect(sqlShape("select 'it''s -- here'")).toBe("select 'it''s -- here'");
});

test('drift compares by name and statements, never by version', () => {
  const tree = [
    { name: 'close_period', sql: FILE },
    { name: 'only_here', sql: 'select 1;' },
    { name: 'edited_after_apply', sql: 'select 2;' },
    { name: 'repaired', sql: 'select 3;' },
  ];
  const drift = migrationDrift(tree, [
    // The same migration under its pre-merge version.
    { version: '20261107150000', name: 'close_period', statements: RECORDED },
    { version: '20261107160000', name: 'edited_after_apply', statements: ['select 4'] },
    // `supabase migration repair` records no statements.
    { version: '20261107170000', name: 'repaired', statements: null },
    { version: '20261107180000', name: 'another_branch', statements: ['select 5'] },
  ]);
  expect(drift).toEqual({
    stackOnly: ['another_branch'],
    treeOnly: ['only_here'],
    changed: ['edited_after_apply'],
  });
  expect(driftLine(drift)).toBe(
    "The shared stack's migrations drift from this tree's: 1 migrations only on the shared stack (another_branch), 1 only in this tree (only_here), 1 with other statements (edited_after_apply).",
  );
  expect(
    driftLine(
      migrationDrift(tree.slice(0, 1), [{ version: '1', name: 'close_period', statements: RECORDED }]),
    ),
  ).toBeUndefined();
  expect(driftLine(undefined)).toBeUndefined();
});

test('the line names at most three migrations per part', () => {
  expect(driftLine({ stackOnly: ['a', 'b', 'c', 'd'], treeOnly: [], changed: [] })).toBe(
    "The shared stack's migrations drift from this tree's: 4 migrations only on the shared stack (a, b, c, …), 0 only in this tree.",
  );
});

test('SQL groups and local browser groups read the shared stack; unit, static, contract and canary groups do not', () => {
  for (const id of ['sql:security', 'golden:p1-01', 'audit:lab:office'])
    expect(readsSharedStack(['unit:all', id]), id).toBe(true);
  expect(readsSharedStack(['unit:all', 'static:lint', 'ui:contracts', 'canary:providers'])).toBe(false);
});

test('a local run notes drift only when it reads the shared stack, outside CI and the Boat machine', () => {
  // A folder without migrations or a stack that cannot be read is no drift, so the run goes on as before.
  expect(localDriftNotice('/nonexistent-checkout', ['sql:security'], {})).toBeUndefined();
  // These return before the stack is read at all.
  expect(localDriftNotice(process.cwd(), ['unit:all', 'static:lint'], {})).toBeUndefined();
  expect(localDriftNotice(process.cwd(), ['sql:security'], { CI: 'true' })).toBeUndefined();
  expect(localDriftNotice(process.cwd(), ['sql:security'], { WERKFLOW_BOAT_MACHINE: '1' })).toBeUndefined();
});
