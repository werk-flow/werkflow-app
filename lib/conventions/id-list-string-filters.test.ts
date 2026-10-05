import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { listProductSources, repositoryRoot } from './product-sources';

// Tier 2 for id lists hidden in PostgREST filter strings. The `.in(` rule in
// id-list-batches.test.ts cannot see a list that a caller writes into a string
// filter, yet the string travels in the same query string and hits the same
// URL limit (the calendar board answered 414 for 205 ids). A call in product
// code under lib/ and app/ fails when
//   1. `.not(column, 'in', list)` gets a list that is not a literal,
//   2. `.filter(column, 'in' | 'not.in', list)` gets a list that is not a literal,
//   3. `.or(filter)` gets a filter that holds a joined list: a `.join(` call or
//      a template that continues after `in.(`, followed through local
//      constants,
// unless the site is a reviewed entry in BOUNDED_STRING_FILTERS whose reason
// names the bound. An organization-sized list is never an entry: filter the
// rows in memory after a bounded read, or batch through readInBatches. An
// entry that matches no call fails too.

/** file -> "method column <- filter expression" -> why the list is bounded. */
const BOUNDED_STRING_FILTERS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  'lib/time-corrections/pending-projection.ts': {
    "or * <- batch .map((id) => { const revision = revisionByRequest.get(id); if (revision === undefined) throw new Error('Pending correction revision is missing from its requested batch.'); return `and(request_id.eq.${id},revision.eq.${revision})`; }) .join(',')":
      'the batch parameter of readInBatches at REVISION_PAIR_BATCH_SIZE (40) request-revision pairs per request',
  },
};

type StringFilterCall = { file: string; line: number; key: string };

function isLiteral(node: ts.Expression): boolean {
  return ts.isStringLiteralLike(node);
}

/** The initializers of the `const` declarations in one file, by name. */
function constantInitializers(source: ts.SourceFile): Map<string, ts.Expression[]> {
  const initializers = new Map<string, ts.Expression[]>();
  function visit(node: ts.Node): void {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.isVariableDeclarationList(node.parent) &&
      (node.parent.flags & ts.NodeFlags.Const) !== 0
    ) {
      const known = initializers.get(node.name.text) ?? [];
      known.push(node.initializer);
      initializers.set(node.name.text, known);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return initializers;
}

/** Whether the expression, followed through local constants, builds a joined list into a filter string. */
function holdsJoinedList(
  node: ts.Node,
  initializers: ReadonlyMap<string, ts.Expression[]>,
  followed: Set<string> = new Set(),
): boolean {
  if (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === 'join'
  ) {
    return true;
  }
  if (ts.isTemplateExpression(node)) {
    const texts = [node.head.text, ...node.templateSpans.map((span) => span.literal.text)];
    if (texts.slice(0, -1).some((text) => /in\.\($/.test(text))) return true;
  }
  if (ts.isIdentifier(node) && !followed.has(node.text)) {
    followed.add(node.text);
    if (
      (initializers.get(node.text) ?? []).some((initializer) =>
        holdsJoinedList(initializer, initializers, followed),
      )
    )
      return true;
  }
  return (
    ts.forEachChild(node, (child) => holdsJoinedList(child, initializers, followed) || undefined) ?? false
  );
}

/** Every string-filter call of one source text that needs a bound. */
function stringFilterCalls(file: string, text: string): StringFilterCall[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const initializers = constantInitializers(source);
  const calls: StringFilterCall[] = [];
  function record(node: ts.CallExpression, method: string, column: string, filter: ts.Expression): void {
    calls.push({
      file,
      line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1,
      key: `${method} ${column} <- ${filter.getText(source).replace(/\s+/g, ' ')}`,
    });
  }
  function visit(node: ts.Node): void {
    ts.forEachChild(node, visit);
    if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return;
    const method = node.expression.name.text;
    const [first, second, third] = node.arguments;
    if (method === 'or' && first && holdsJoinedList(first, initializers)) {
      record(node, method, '*', first);
      return;
    }
    if (method !== 'not' && method !== 'filter') return;
    if (!first || !second || !third || !ts.isStringLiteralLike(second)) return;
    const operators = method === 'not' ? ['in'] : ['in', 'not.in'];
    if (!operators.includes(second.text) || isLiteral(third)) return;
    record(node, method, ts.isStringLiteralLike(first) ? first.text : first.getText(source), third);
  }
  visit(source);
  return calls;
}

test('the rule catches a not.in list in an or-filter, a not-in call and an in filter', () => {
  // The follow-up attention read before it moved the visibility rule into memory.
  const formerAttentionRead = `
    const activeManagerList = [...activeManagerIds].join(',');
    const visibilityFilter = activeManagerList
      ? \`owner_user_id.eq.\${context.userId},owner_user_id.not.in.(\${activeManagerList})\`
      : \`owner_user_id.eq.\${context.userId}\`;
    admin.from('client_follow_ups').select('id').or(visibilityFilter);
  `;
  expect(stringFilterCalls('fixture.ts', formerAttentionRead).map((call) => call.key)).toEqual([
    'or * <- visibilityFilter',
  ]);
  const notIn = `query.not('status', 'in', \`(\${ids.join(',')})\`);`;
  expect(stringFilterCalls('fixture.ts', notIn).map((call) => call.key)).toEqual([
    "not status <- `(${ids.join(',')})`",
  ]);
  const filterIn = `query.filter('id', 'not.in', list); query.filter('id', 'in', '(a,b)');`;
  expect(stringFilterCalls('fixture.ts', filterIn).map((call) => call.key)).toEqual(['filter id <- list']);
  const fixedFilters = `
    query.not('status', 'in', '(closed_without_visit,duplicate)');
    query.or(\`site_id.is.null,site_id.eq.\${siteId}\`);
  `;
  expect(stringFilterCalls('fixture.ts', fixedFilters)).toEqual([]);
});

test('every id list in a PostgREST string filter is a literal or a reviewed bounded site', () => {
  const calls = listProductSources(['lib', 'app']).flatMap((file) =>
    stringFilterCalls(file, readFileSync(resolve(repositoryRoot, file), 'utf8')),
  );
  const unreviewed = calls.filter((call) => BOUNDED_STRING_FILTERS[call.file]?.[call.key] === undefined);
  expect(
    unreviewed.map((call) => `${call.file}:${call.line} ${call.key}`),
    'Filter the excluded ids in memory after a bounded read (readAllRows in lib/supabase/query-batches.ts) or batch the list through readInBatches. Add a BOUNDED_STRING_FILTERS entry only when the input bounds the list, and say which.',
  ).toEqual([]);
  const seen = new Set(calls.map((call) => `${call.file}\n${call.key}`));
  const stale = Object.entries(BOUNDED_STRING_FILTERS).flatMap(([file, entries]) =>
    Object.keys(entries)
      .filter((key) => !seen.has(`${file}\n${key}`))
      .map((key) => `${file}: ${key}`),
  );
  expect(stale, 'These BOUNDED_STRING_FILTERS entries match no call; remove them.').toEqual([]);
}, 60_000);
