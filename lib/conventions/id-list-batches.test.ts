import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { listProductSources, repositoryRoot } from './product-sources';

// Tier 2 for bounded id-list reads. PostgREST receives `.in(column, list)` in
// the query string and the gateway rejects a long one: the calendar board
// answered 414 for 205 employee records on 2026-09-30. A `.in(` call in
// product code (app/, components/, hooks/ and lib/) passes when its list is
//   1. a literal array or a SCREAMING_CASE constant (a fixed status set),
//   2. the batch parameter of a `readInBatches` callback, or
//   3. a reviewed site in BOUNDED_LISTS, whose reason names the bound.
// An organization-sized list (every employee, job, customer, equipment item
// or service case) is never a BOUNDED_LISTS entry: batch it. An entry that
// matches no call fails too, so the list only describes current code.

/** file -> "column <- list expression" -> why the list is bounded. */
const BOUNDED_LISTS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  'lib/documents/actions.ts': {
    'version_number <- releasedVersionNumbers': 'the released version numbers of one personnel document',
  },
  'lib/documents/hydration.ts': {
    'organization_id <- organizationIds':
      'the distinct organizations of the document rows already loaded for one caller, who reads within their own memberships; it sits beside the batched id list as the tenant filter',
  },
  'lib/members/queries.ts': {
    'organization_id <- organizationIds':
      "the caller's own memberships; the requested user ids beside it are batched",
  },
  'lib/time-tracking/change-request-reader.ts': {
    'organization_id <- [...organizationIds]':
      "the caller's permitted organizations (own memberships); the entry and request ids beside it are batched",
  },
};

type ListCall = { file: string; line: number; key: string };

function isFixedList(list: ts.Expression): boolean {
  if (ts.isIdentifier(list)) return /^[A-Z][A-Z0-9_]*$/.test(list.text);
  if (!ts.isArrayLiteralExpression(list)) return false;
  return list.elements.every(
    (element) =>
      ts.isStringLiteralLike(element) ||
      ts.isNumericLiteral(element) ||
      (ts.isSpreadElement(element) && isFixedList(element.expression)),
  );
}

/** The batch parameter name when `node` sits in the callback of a `readInBatches` call. */
function enclosingBatchParameters(node: ts.Node): string[] {
  const names: string[] = [];
  for (
    let current: ts.Node | undefined = node.parent, child: ts.Node = node;
    current;
    child = current, current = current.parent
  ) {
    if (
      !ts.isCallExpression(current) ||
      !ts.isIdentifier(current.expression) ||
      current.expression.text !== 'readInBatches'
    )
      continue;
    const callback = current.arguments[1];
    if (callback !== child || !(ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))) continue;
    const parameter = callback.parameters[0]?.name;
    if (parameter && ts.isIdentifier(parameter)) names.push(parameter.text);
  }
  return names;
}

function mentions(node: ts.Node, name: string): boolean {
  if (ts.isIdentifier(node) && node.text === name) return true;
  return ts.forEachChild(node, (child) => mentions(child, name)) ?? false;
}

function unbatchedListCalls(
  file: string,
  text = readFileSync(resolve(repositoryRoot, file), 'utf8'),
): ListCall[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const calls: ListCall[] = [];
  function visit(node: ts.Node): void {
    ts.forEachChild(node, visit);
    if (
      !ts.isCallExpression(node) ||
      !ts.isPropertyAccessExpression(node.expression) ||
      node.expression.name.text !== 'in'
    )
      return;
    const [column, list] = node.arguments;
    if (!column || !list || !ts.isStringLiteralLike(column) || isFixedList(list)) return;
    if (enclosingBatchParameters(node).some((name) => mentions(list, name))) return;
    calls.push({
      file,
      line: source.getLineAndCharacterOfPosition(node.expression.name.getStart()).line + 1,
      key: `${column.text} <- ${list.getText().replace(/\s+/g, ' ')}`,
    });
  }
  visit(source);
  return calls;
}

test('the scan flags an unbatched id list in a route, a component or a hook, and accepts a batched one', () => {
  const unbatched = `export default async function Page({ ids }: { ids: string[] }) {
  return admin.from('profiles').select('id').in('id', ids);
}`;
  const batched = `export default async function Page({ ids }: { ids: string[] }) {
  return readInBatches(ids, (batch) => admin.from('profiles').select('id').in('id', batch));
}`;
  expect(unbatchedListCalls('app/(app)/probe/page.tsx', unbatched).map((call) => call.key)).toEqual([
    'id <- ids',
  ]);
  expect(unbatchedListCalls('app/(app)/probe/page.tsx', batched)).toEqual([]);
  // Every product root is scanned, not lib/ alone.
  const scanned = new Set(listProductSources().map((file) => file.split('/')[0]));
  expect([...scanned].sort()).toEqual(['app', 'components', 'hooks', 'lib']);
});

test('every id list sent to PostgREST is fixed, batched, or a reviewed bounded site', () => {
  const calls = listProductSources().flatMap((file) => unbatchedListCalls(file));
  const unreviewed = calls.filter((call) => BOUNDED_LISTS[call.file]?.[call.key] === undefined);
  expect(
    unreviewed.map((call) => `${call.file}:${call.line} ${call.key}`),
    "Read an id list through readInBatches (lib/supabase/query-batches.ts). Add a BOUNDED_LISTS entry only when the input bounds the list (a validated selection, one record's children, one page of rows) and say which.",
  ).toEqual([]);
  const seen = new Set(calls.map((call) => `${call.file}\n${call.key}`));
  const stale = Object.entries(BOUNDED_LISTS).flatMap(([file, entries]) =>
    Object.keys(entries)
      .filter((key) => !seen.has(`${file}\n${key}`))
      .map((key) => `${file}: ${key}`),
  );
  expect(stale, 'These BOUNDED_LISTS entries match no call; remove them.').toEqual([]);
});
