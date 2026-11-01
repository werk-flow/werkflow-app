import { expect, test } from 'bun:test';
import ts from 'typescript';

import { couldContainServerDirective, unguardedActions } from '@/lib/testing/server-action-inventory';

// Planted sources prove the guard analysis of
// lib/security/server-action-authorization.test.ts: what counts as a Server
// Action, which calls count as the guard, and the order rule.

function fixture(source: string): string[] {
  return unguardedActions(
    'app/fixture.tsx',
    ts.createSourceFile('app/fixture.tsx', source, ts.ScriptTarget.Latest, true),
  );
}

test('inline use-server functions inside an ordinary page cannot bypass the identity inventory', () => {
  expect(
    fixture(
      `export default function Page() { async function save() { 'use server'; return readPrivate(); } }`,
    ),
  ).toHaveLength(1);
  expect(
    fixture(
      `export default function Page() { return <form action={async () => { 'use server'; return readPrivate(); }} />; }`,
    ),
  ).toHaveLength(1);
  expect(
    fixture(
      `export default function Page() { async function save() { 'use server'; const auth = await resolveActionContext(); if (!auth.success) return auth; return readPrivate(); } }`,
    ),
  ).toEqual([]);
});

test('unresolved action aliases and re-exports fail instead of silently disappearing', () => {
  expect(() =>
    fixture(`'use server'; const inner = async () => readPrivate(); export const save = inner;`),
  ).toThrow('unresolved action alias');
  expect(() =>
    fixture(`'use server'; const inner = async () => readPrivate(); export default inner;`),
  ).toThrow('unresolved default action alias');
  expect(() => fixture(`'use server'; export { save } from './other';`)).toThrow('re-exports');
});

test('direct functions and directive prologues are inventoried while literal text is not a directive', () => {
  expect(
    fixture(`'use strict'; 'use server'; export async function save() { return readPrivate(); }`),
  ).toHaveLength(1);
  expect(
    fixture(
      `'use server'; export const save = async () => readPrivate(); export default async function() { return readPrivate(); }`,
    ),
  ).toHaveLength(2);
  expect(fixture(`const explanation = 'use server'; export const value = 1;`)).toEqual([]);
  expect(
    fixture(
      `'use server'; export async function save() { const unused = async () => resolveActionContext(); return readPrivate(); }`,
    ),
  ).toHaveLength(1);
  const escaped = String.raw`'use\x20server'; export async function save() { return readPrivate(); }`;
  expect(couldContainServerDirective(escaped)).toBe(true);
  expect(fixture(escaped)).toHaveLength(1);
});

test('only the owner module and its wrappers count; identity alone or a lookalike name does not', () => {
  expect(
    fixture(
      `'use server'; export async function save() { await getAuthenticatedUser(); return readPrivate(); }`,
    ),
  ).toHaveLength(1);
  for (const lookalike of [
    'requirePresent',
    'requireJsonRecord',
    'authorizeTarget',
    'getAuthorizedItemContext',
  ]) {
    expect(
      fixture(`'use server'; export async function save() { ${lookalike}(); return readPrivate(); }`),
    ).toHaveLength(1);
  }
  expect(
    fixture(
      `'use server'; export async function save(id) { const auth = await resolveActionContextFor(id); if (!auth.success) return auth; return readPrivate(); }`,
    ),
  ).toEqual([]);
});

test('called arrow and expression helpers establish context, unused closures do not', () => {
  expect(
    fixture(
      `'use server'; const guard = async () => resolveActionContext(); export async function save() { const auth = await guard(); if (!auth.success) return auth; return readPrivate(); }`,
    ),
  ).toEqual([]);
  expect(
    fixture(
      `'use server'; const guard = async function() { const auth = await authenticateAndAuthorize(); if (!auth.success) throw new Error('denied'); }; export async function save() { await guard(); return readPrivate(); }`,
    ),
  ).toEqual([]);
  expect(
    fixture(
      `'use server'; const guard = async () => { const unused = () => resolveActionContext(); }; export async function save() { await guard(); return readPrivate(); }`,
    ),
  ).toHaveLength(1);
});

test('planted order violations: the guard runs unconditionally and is checked before the first privileged call', () => {
  const action = (body: string, helpers = ''): string[] =>
    fixture(`'use server'; ${helpers} export async function save(id) { ${body} }`);
  const checked = 'const auth = await resolveActionContext(); if (!auth.success) return auth;';
  const remove = "await createSupabaseAdminClient().from('jobs').delete().eq('id', id);";
  expect(action(`${checked} ${remove}`)).toEqual([]);
  expect(action(`try { ${checked} ${remove} } catch { return null; }`)).toEqual([]);
  expect(action(`await resolveActionContext(); ${remove}`)).toEqual([
    'app/fixture.tsx#save: ignores the result of resolveActionContext',
  ]);
  expect(
    action(`const auth = await resolveActionContext(); ${remove} if (!auth.success) return auth;`),
  ).toEqual(['app/fixture.tsx#save: .delete() before checking the result of resolveActionContext']);
  expect(action(`const auth = await resolveActionContext(); if (auth.success) { ${remove} }`)).toEqual([
    'app/fixture.tsx#save: .delete() before checking the result of resolveActionContext',
  ]);
  expect(action(`await admin.from('jobs').update({ done: true }); ${checked}`)).toEqual([
    'app/fixture.tsx#save: .update() before the guard',
  ]);
  expect(action(`if (id) { ${checked} } ${remove}`)).toEqual([
    'app/fixture.tsx#save: calls resolveActionContext conditionally or nested in an expression',
  ]);
  expect(action(`await purge(id); ${checked}`, `async function purge(id) { ${remove} }`)).toEqual([
    'app/fixture.tsx#save: purge() before the guard',
  ]);
  expect(
    action(
      "const [auth] = await Promise.all([resolveActionContext(), admin.rpc('touch')]); if (!auth.success) return auth;",
    ),
  ).toEqual(['app/fixture.tsx#save: .rpc() beside resolveActionContext before its check']);
  expect(action(`try { ${checked} } catch { await admin.from('audit').insert({}); return null; }`)).toEqual([
    'app/fixture.tsx#save: .insert() in a catch or finally block before the guard',
  ]);
});

test('planted order cases: identity first may read the row whose organization it then resolves', () => {
  const action = (body: string, helpers = ''): string[] =>
    fixture(`'use server'; ${helpers} export async function save(id) { ${body} }`);
  const identity = 'const user = await getAuthenticatedUser(); if (!user) return null;';
  const load =
    "const admin = createSupabaseAdminClient(); const { data } = await admin.from('jobs').select('organization_id').eq('id', id).single();";
  const context =
    'const auth = await resolveActionContextFor(data.organization_id); if (!auth.success) return auth;';
  const remove = "await admin.from('jobs').delete().eq('id', id);";
  expect(action(`${identity} ${load} ${context} ${remove}`)).toEqual([]);
  expect(action(`${load} ${context}`)).toEqual([
    'app/fixture.tsx#save: createSupabaseAdminClient() before the guard',
  ]);
  expect(action(`${identity} ${load} await admin.rpc('touch'); ${context}`)).toEqual([
    'app/fixture.tsx#save: .rpc() before the guard',
  ]);
  const verify =
    'async function verify(org) { const caller = await resolveActionContextFor(org); return caller.success ? caller.context.role : null; }';
  expect(
    action(
      "const role = await verify(id); if (!role) return null; await createSupabaseAdminClient().rpc('x');",
      verify,
    ),
  ).toEqual([]);
  expect(action("await verify(id); await createSupabaseAdminClient().rpc('x');", verify)).toEqual([
    'app/fixture.tsx#save: ignores the result of verify',
  ]);
});
