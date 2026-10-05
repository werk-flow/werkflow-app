import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { listProductSources, repositoryRoot } from './product-sources';

// Tier 2 for tenant scoping of service-role queries (AGENTS.md "3. Security").
// The admin client bypasses RLS, so a query on a table with an
// `organization_id` column is scoped only by its own filter. In product code
// under lib/ and app/, every such query passes when its builder chain
//   1. filters `.eq('organization_id', …)`, `.in('organization_id', …)`,
//      `.match({ organization_id })` or `.filter('organization_id', 'eq', …)`,
//   2. inserts or upserts rows that each name `organization_id`, or
//   3. carries a `// tenant-scope: <reason> — <why>` comment directly above
//      the chain, with a reason from TENANT_SCOPE_REASONS.
// A receiver counts as the admin client unless it is provably the caller's
// RLS client (a binding of `createSupabaseServerClient()` or the browser
// client), so an unknown client is treated as privileged. An annotation that
// excuses no unfiltered query fails too, so the comments describe the code.

/** The closed set of reasons an unfiltered admin query may carry. */
const TENANT_SCOPE_REASONS = {
  'by-id-then-verified': "reads a row by id and compares its organization with the caller's before using it",
  'child-of-verified-parent':
    'filters by the id of a parent row whose organization the server already verified',
  'own-user-row': "reads or writes the signed-in user's own row (profile, membership list, preferences)",
  'cross-organization-by-design':
    "spans organizations on purpose, for example the signed-in user's memberships or a global lookup",
} as const;

const ANNOTATION = /\/\/\s*tenant-scope:\s*([a-z-]+)\s*(?:[—–-]+\s*(.*))?$/;

const RLS_CLIENT_FACTORIES = new Set([
  'createSupabaseServerClient',
  'createSupabaseBrowserClient',
  'createBrowserClient',
  'createClient',
]);

const ORGANIZATION_FILTERS = new Set(['eq', 'in', 'match', 'filter']);

/** Tables and views of the public schema whose rows carry `organization_id`. */
function organizationTables(): Set<string> {
  const file = 'lib/supabase/database.types.ts';
  const source = ts.createSourceFile(
    file,
    readFileSync(resolve(repositoryRoot, file), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  const tables = new Set<string>();
  const memberType = (
    members: ts.NodeArray<ts.TypeElement>,
    name: string,
  ): ts.TypeLiteralNode | undefined => {
    for (const member of members) {
      if (
        ts.isPropertySignature(member) &&
        member.name.getText(source).replace(/['"]/g, '') === name &&
        member.type &&
        ts.isTypeLiteralNode(member.type)
      ) {
        return member.type;
      }
    }
    return undefined;
  };
  ts.forEachChild(source, function visit(node) {
    if (ts.isTypeAliasDeclaration(node) && node.name.text === 'Database' && ts.isTypeLiteralNode(node.type)) {
      const publicSchema = memberType(node.type.members, 'public');
      if (!publicSchema) return;
      for (const group of ['Tables', 'Views']) {
        const relations = memberType(publicSchema.members, group);
        for (const relation of relations?.members ?? []) {
          if (!ts.isPropertySignature(relation) || !relation.type || !ts.isTypeLiteralNode(relation.type))
            continue;
          const row = memberType(relation.type.members, 'Row');
          if (row && hasMember(row, 'organization_id')) {
            tables.add(relation.name.getText(source).replace(/['"]/g, ''));
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  });
  return tables;
}

function hasMember(literal: ts.TypeLiteralNode, name: string): boolean {
  return literal.members.some(
    (member) => ts.isPropertySignature(member) && member.name.getText().replace(/['"]/g, '') === name,
  );
}

type TenantFinding = { file: string; line: number; table: string; problem: string };

function stringValue(node: ts.Node | undefined): string | undefined {
  return node && ts.isStringLiteralLike(node) ? node.text : undefined;
}

function propertyNames(node: ts.Expression): string[] {
  if (!ts.isObjectLiteralExpression(node)) return [];
  return node.properties.flatMap((property) => {
    if (ts.isShorthandPropertyAssignment(property)) return [property.name.text];
    if (ts.isPropertyAssignment(property)) {
      const name = property.name;
      return [ts.isIdentifier(name) || ts.isStringLiteralLike(name) ? name.text : name.getText()];
    }
    return [];
  });
}

/** Unwraps `(x)`, `x as T`, `x satisfies T` and `await x`. */
function unwrap(node: ts.Expression): ts.Expression {
  let current = node;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isAwaitExpression(current) ||
    ts.isNonNullExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

/** The variable initializer that `name` refers to inside `scope`, when it is a const or let binding. */
function bindingInitializer(scope: ts.Node, name: string): ts.Expression | undefined {
  let found: ts.Expression | undefined;
  ts.forEachChild(scope, function visit(node) {
    if (found) return;
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name &&
      node.initializer
    ) {
      found = node.initializer;
      return;
    }
    ts.forEachChild(node, visit);
  });
  return found;
}

/** True when every row of an insert payload names `organization_id`. */
function payloadNamesOrganization(payload: ts.Expression, scope: ts.Node, depth = 0): boolean {
  const node = unwrap(payload);
  if (depth > 4) return false;
  if (ts.isObjectLiteralExpression(node)) {
    return (
      propertyNames(node).includes('organization_id') ||
      node.properties.some(
        (property) =>
          ts.isSpreadAssignment(property) && payloadNamesOrganization(property.expression, scope, depth + 1),
      )
    );
  }
  if (ts.isArrayLiteralExpression(node)) {
    return (
      node.elements.length > 0 &&
      node.elements.every((element) =>
        ts.isSpreadElement(element)
          ? payloadNamesOrganization(element.expression, scope, depth + 1)
          : payloadNamesOrganization(element, scope, depth + 1),
      )
    );
  }
  if (ts.isConditionalExpression(node)) {
    return (
      payloadNamesOrganization(node.whenTrue, scope, depth + 1) &&
      payloadNamesOrganization(node.whenFalse, scope, depth + 1)
    );
  }
  if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
    const method = node.expression.name.text;
    const callback = node.arguments[0];
    if (
      (method === 'map' || method === 'flatMap') &&
      callback &&
      (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))
    ) {
      return returnedExpressions(callback).every((returned) =>
        payloadNamesOrganization(returned, callback, depth + 1),
      );
    }
    if (method === 'filter' || method === 'slice' || method === 'concat') {
      return payloadNamesOrganization(node.expression.expression, scope, depth + 1);
    }
  }
  if (ts.isIdentifier(node)) {
    const initializer = bindingInitializer(enclosingFunction(scope) ?? scope.getSourceFile(), node.text);
    return initializer !== undefined && payloadNamesOrganization(initializer, scope, depth + 1);
  }
  return false;
}

function returnedExpressions(callback: ts.ArrowFunction | ts.FunctionExpression): ts.Expression[] {
  if (!ts.isBlock(callback.body)) return [callback.body];
  const returned: ts.Expression[] = [];
  ts.forEachChild(callback.body, function visit(node) {
    if (ts.isFunctionLike(node)) return;
    if (ts.isReturnStatement(node) && node.expression) returned.push(node.expression);
    ts.forEachChild(node, visit);
  });
  return returned.length ? returned : [];
}

function enclosingFunction(node: ts.Node): ts.Node | undefined {
  for (let current = node.parent; current; current = current.parent) {
    if (ts.isFunctionLike(current)) return current;
  }
  return undefined;
}

type ChainCall = { method: string; call: ts.CallExpression };

/** Calls applied to the builder that `fromCall` starts, outermost last. */
function chainCalls(fromCall: ts.CallExpression): { calls: ChainCall[]; top: ts.Expression } {
  const calls: ChainCall[] = [];
  let current: ts.Expression = fromCall;
  for (;;) {
    const parent = current.parent;
    if (parent && ts.isPropertyAccessExpression(parent) && parent.expression === current) {
      const call = parent.parent;
      if (call && ts.isCallExpression(call) && call.expression === parent) {
        calls.push({ method: parent.name.text, call });
        current = call;
        continue;
      }
    }
    if (
      parent &&
      (ts.isParenthesizedExpression(parent) || ts.isAsExpression(parent) || ts.isNonNullExpression(parent))
    ) {
      current = parent;
      continue;
    }
    return { calls, top: current };
  }
}

/** Builder variables continued after the chain: `let query = admin.from(…)…; query = query.eq(…)`. */
function continuationCalls(top: ts.Expression): ChainCall[] {
  const parent = top.parent;
  let name: string | undefined;
  if (
    parent &&
    ts.isVariableDeclaration(parent) &&
    parent.initializer === top &&
    ts.isIdentifier(parent.name)
  ) {
    name = parent.name.text;
  } else if (
    parent &&
    ts.isBinaryExpression(parent) &&
    parent.right === top &&
    parent.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
    ts.isIdentifier(parent.left)
  ) {
    name = parent.left.text;
  }
  if (!name) return [];
  const scope = enclosingFunction(top) ?? top.getSourceFile();
  const calls: ChainCall[] = [];
  const builderName = name;
  ts.forEachChild(scope, function visit(node) {
    if (
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === builderName &&
      node.parent &&
      ts.isCallExpression(node.parent) &&
      node.parent.expression === node
    ) {
      calls.push({ method: node.name.text, call: node.parent });
      calls.push(...chainCalls(node.parent).calls);
    }
    ts.forEachChild(node, visit);
  });
  return calls;
}

function filtersOrganization({ method, call }: ChainCall): boolean {
  if (!ORGANIZATION_FILTERS.has(method)) return false;
  const [first, second] = call.arguments;
  if (method === 'match')
    return first !== undefined && propertyNames(unwrap(first)).includes('organization_id');
  if (stringValue(first) !== 'organization_id') return false;
  return method !== 'filter' || stringValue(second) === 'eq' || stringValue(second) === 'in';
}

/** True when the receiver is provably the caller's RLS client. */
function isRlsClient(receiver: ts.Expression): boolean {
  const node = unwrap(receiver);
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
    return RLS_CLIENT_FACTORIES.has(node.expression.text);
  }
  if (!ts.isIdentifier(node)) return false;
  const scope = enclosingFunction(node) ?? node.getSourceFile();
  for (let current: ts.Node | undefined = scope; current; current = enclosingFunction(current)) {
    const initializer = bindingInitializer(current, node.text);
    if (initializer) return isRlsClient(initializer);
  }
  const fileInitializer = bindingInitializer(node.getSourceFile(), node.text);
  return fileInitializer !== undefined && isRlsClient(fileInitializer);
}

function annotationAbove(source: ts.SourceFile, lines: string[], node: ts.Node, fromCall: ts.CallExpression) {
  const start = source.getLineAndCharacterOfPosition(node.getStart(source)).line;
  const end = source.getLineAndCharacterOfPosition(fromCall.getEnd()).line;
  const candidates: number[] = [];
  for (let line = start - 1; line >= 0 && /^\s*\/\//.test(lines[line] ?? ''); line -= 1)
    candidates.push(line);
  for (let line = start; line <= end; line += 1) candidates.push(line);
  for (const line of candidates) {
    const match = ANNOTATION.exec((lines[line] ?? '').trim());
    if (match) return { line, reason: match[1] ?? '', explanation: (match[2] ?? '').trim() };
  }
  return undefined;
}

/** The expression a chain hangs from: the statement-level start used to look for an annotation. */
function chainAnchor(top: ts.Expression): ts.Node {
  let current: ts.Node = top;
  while (
    current.parent &&
    (ts.isAwaitExpression(current.parent) ||
      ts.isParenthesizedExpression(current.parent) ||
      ts.isVariableDeclaration(current.parent) ||
      ts.isVariableDeclarationList(current.parent) ||
      ts.isReturnStatement(current.parent) ||
      ts.isExpressionStatement(current.parent) ||
      ts.isVariableStatement(current.parent) ||
      (ts.isBinaryExpression(current.parent) && current.parent.right === current))
  ) {
    current = current.parent;
  }
  return current;
}

function scanTenantScope(
  file: string,
  text: string,
  tables: ReadonlySet<string>,
): { findings: TenantFinding[]; annotations: { line: number; used: boolean; reason: string }[] } {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const lines = text.split(/\r?\n/);
  const findings: TenantFinding[] = [];
  const annotations = new Map<number, { line: number; used: boolean; reason: string }>();
  lines.forEach((content, index) => {
    const match = ANNOTATION.exec(content.trim());
    if (match) annotations.set(index, { line: index + 1, used: false, reason: match[1] ?? '' });
  });

  ts.forEachChild(source, function visit(node) {
    ts.forEachChild(node, visit);
    if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return;
    if (node.expression.name.text !== 'from') return;
    const receiver = node.expression.expression;
    if (ts.isPropertyAccessExpression(receiver) && receiver.name.text === 'storage') return;
    if (ts.isIdentifier(receiver) && /^(Array|Buffer|Object|Uint8Array)$/.test(receiver.text)) return;
    const tableArgument = node.arguments[0];
    if (!tableArgument) return;
    // A table chosen at runtime is treated as an organization table.
    const literalTable = stringValue(tableArgument);
    const table = literalTable ?? `<${tableArgument.getText(source)}>`;
    if ((literalTable !== undefined && !tables.has(literalTable)) || isRlsClient(receiver)) return;
    const { calls, top } = chainCalls(node);
    const allCalls = [...calls, ...continuationCalls(top)];
    const line = source.getLineAndCharacterOfPosition(node.expression.name.getStart(source)).line + 1;
    const annotation = annotationAbove(source, lines, chainAnchor(top), node);
    const scoped =
      allCalls.some(filtersOrganization) ||
      allCalls.some(
        ({ method, call }) =>
          (method === 'insert' || method === 'upsert') &&
          call.arguments[0] !== undefined &&
          payloadNamesOrganization(call.arguments[0], call),
      );
    if (annotation) {
      const record = annotations.get(annotation.line);
      if (record) record.used = !scoped;
      if (scoped) return;
      if (!(annotation.reason in TENANT_SCOPE_REASONS)) {
        findings.push({ file, line, table, problem: `unknown tenant-scope reason "${annotation.reason}"` });
      } else if (annotation.explanation.length < 12) {
        findings.push({
          file,
          line,
          table,
          problem: `tenant-scope ${annotation.reason} needs a "— why" explanation`,
        });
      }
      return;
    }
    if (!scoped)
      findings.push({ file, line, table, problem: 'no organization filter and no tenant-scope annotation' });
  });
  return { findings, annotations: [...annotations.values()] };
}

test('every admin query on an organization table is filtered or carries a reviewed reason', () => {
  const tables = organizationTables();
  expect(tables.size).toBeGreaterThan(50);
  const unscoped: string[] = [];
  const stale: string[] = [];
  for (const file of listProductSources(['lib', 'app'])) {
    const text = readFileSync(resolve(repositoryRoot, file), 'utf8');
    if (!text.includes('.from(') && !text.includes('tenant-scope:')) continue;
    const { findings, annotations } = scanTenantScope(file, text, tables);
    for (const finding of findings) {
      unscoped.push(`${finding.file}:${finding.line} ${finding.table}: ${finding.problem}`);
    }
    for (const annotation of annotations) {
      if (!annotation.used) stale.push(`${file}:${annotation.line}`);
    }
  }
  expect(
    unscoped,
    "Add .eq('organization_id', <authorized org id>) to the chain (it only narrows), or, when the row is scoped another way, a `// tenant-scope: <reason> — <why>` comment above it with a reason from TENANT_SCOPE_REASONS.",
  ).toEqual([]);
  expect(stale, 'These tenant-scope annotations excuse no unfiltered admin query; remove them.').toEqual([]);
}, 120_000);

const fixtureTables = new Set(['jobs', 'time_entries']);

function fixtureFindings(code: string): string[] {
  return scanTenantScope('lib/fixture.ts', code, fixtureTables).findings.map((finding) => finding.problem);
}

test('the scan rejects an unfiltered admin query and accepts the reviewed forms', () => {
  expect(
    fixtureFindings(`async function f(admin) { await admin.from('jobs').delete().eq('id', id); }`),
  ).toHaveLength(1);
  expect(
    fixtureFindings(
      `async function f(admin) { await admin.from('jobs').delete().eq('id', id).eq('organization_id', orgId); }`,
    ),
  ).toEqual([]);
  expect(
    fixtureFindings(
      `async function f(admin) { let query = admin.from('jobs').select('id'); query = query.eq('organization_id', orgId); }`,
    ),
  ).toEqual([]);
  expect(
    fixtureFindings(
      `async function f(admin) { await admin.from('jobs').insert({ id, organization_id: orgId }); }`,
    ),
  ).toEqual([]);
  expect(
    fixtureFindings(
      `async function f(admin) { await admin.from('jobs').insert(rows.map((row) => ({ ...row, organization_id }))); }`,
    ),
  ).toEqual([]);
  expect(fixtureFindings(`async function f(admin) { await admin.from('jobs').insert(rows); }`)).toHaveLength(
    1,
  );
  expect(fixtureFindings(`async function f(admin) { await admin.from('profiles').select('id'); }`)).toEqual(
    [],
  );
  expect(
    fixtureFindings(
      `async function f() { const supabase = await createSupabaseServerClient(); await supabase.from('jobs').select('id'); }`,
    ),
  ).toEqual([]);
  expect(
    fixtureFindings(
      `async function f(client) { await client.from('jobs').select('id').eq('jobs.organization_id', orgId); }`,
    ),
  ).toHaveLength(1);
});

test('annotations need a reason from the closed set and an explanation, and go stale when filtered', () => {
  expect(
    fixtureFindings(
      `async function f(admin) {\n  // tenant-scope: by-id-then-verified — the job's organization is compared below\n  const { data } = await admin.from('jobs').select('organization_id').eq('id', id);\n}`,
    ),
  ).toEqual([]);
  expect(
    fixtureFindings(
      `async function f(admin) {\n  // tenant-scope: trusted — because\n  await admin.from('jobs').select('id');\n}`,
    ),
  ).toEqual(['unknown tenant-scope reason "trusted"']);
  expect(
    fixtureFindings(
      `async function f(admin) {\n  // tenant-scope: own-user-row\n  await admin.from('jobs').select('id');\n}`,
    ),
  ).toHaveLength(1);
  const { annotations } = scanTenantScope(
    'lib/fixture.ts',
    `async function f(admin) {\n  // tenant-scope: own-user-row — the caller's own row\n  await admin.from('jobs').select('id').eq('organization_id', orgId);\n}`,
    fixtureTables,
  );
  expect(annotations.map((annotation) => annotation.used)).toEqual([false]);
});
