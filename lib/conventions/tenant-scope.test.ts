import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import {
  organizationOrigin,
  originScope as moduleOriginScope,
  type Origin,
  type OriginScope,
} from './organization-origin';
import { listProductSources, repositoryRoot } from './product-sources';
import {
  bindingInitializer,
  chainCalls,
  continuationCalls,
  enclosingFunction,
  functionOrganizationArguments,
  organizationTables,
  stringValue,
  unwrap,
  type ChainCall,
} from './query-chains';

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
// A privileged `.rpc(...)` passes the function's organization argument (from
// the generated types), or its function sits in UNSCOPED_FUNCTIONS, or it
// carries an annotation when a helper built its arguments. The organization
// value of a filter or an rpc must derive from a resolved context, a
// resolver's argument or a scoped read (lib/conventions/organization-origin.ts),
// never from a Server Action's raw parameter.

/** The closed set of reasons an unfiltered admin query may carry. */
const TENANT_SCOPE_REASONS = {
  'by-id-then-verified': "reads a row by id and compares its organization with the caller's before using it",
  'child-of-verified-parent':
    'filters by the id of a parent row whose organization the server already verified',
  'own-user-row': "reads or writes the signed-in user's own row (profile, membership list, preferences)",
  'cross-organization-by-design':
    "spans organizations on purpose, for example the signed-in user's memberships or a global lookup",
  'built-from-context':
    "passes rpc arguments that a module helper built from the resolved context's organization",
} as const;

// Database functions without an organization argument, each with the argument
// that scopes it instead. A privileged rpc of any other such function fails;
// an entry that no product code calls, or whose function gained an
// organization argument, fails as stale.
const UNSCOPED_FUNCTIONS: Readonly<Record<string, string>> = {
  get_invite_by_code: 'Looks up one invitation by its unguessable code before the caller is a member.',
  redeem_organization_invite_for_user:
    'Redeems an invite code for the verified user; the code names the organization.',
  check_user_exists_by_email:
    'Global account lookup by email for the invite flow; returns no organization data.',
  create_organization_with_defaults: 'Creates a new organization with the verified user as its first admin.',
  consume_rate_limit: 'Counts attempts per keyed subject hash; the limits are global, not per organization.',
  transition_email_change:
    "Changes the verified user's own email-change state, which belongs to no organization.",
  withdraw_time_correction:
    'The function accepts only the request author passed as p_actor_id (time_correction_not_requester).',
  decide_time_correction:
    "The action resolves the caller in the request's organization and checks the time-approval responsibility there first.",
  decide_time_correction_batch:
    'The action requires one organization for all requests, resolves the caller in it and checks the time-approval responsibility first.',
  revise_time_correction_request:
    "The action resolves the caller in the request's organization first; the function accepts only the request author as p_actor_id.",
  end_responsibility_delegation:
    "The action reads the delegation inside the caller's organization first; the function checks the actor in the delegation's organization.",
};

const ORGANIZATION_ARGUMENT_NAMES = ['p_organization_id', 'p_org_id', 'organization_id', 'org_id'];

const ANNOTATION = /\/\/\s*tenant-scope:\s*([a-z-]+)\s*(?:[—–-]+\s*(.*))?$/;

const RLS_CLIENT_FACTORIES = new Set([
  'createSupabaseServerClient',
  'createSupabaseBrowserClient',
  'createBrowserClient',
  'createClient',
]);

const ORGANIZATION_FILTERS = new Set(['eq', 'in', 'match', 'filter']);

type TenantFinding = { file: string; line: number; table: string; problem: string };

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

/** The values an organization filter compares with. */
function organizationFilterValues(chainCall: ChainCall): ts.Expression[] {
  if (!filtersOrganization(chainCall)) return [];
  const { method, call } = chainCall;
  if (method === 'match') {
    const filter = call.arguments[0] && unwrap(call.arguments[0]);
    return filter ? organizationPropertyValues(filter, 'organization_id') : [];
  }
  const value = call.arguments[method === 'filter' ? 2 : 1];
  return value ? [value] : [];
}

function organizationPropertyValues(node: ts.Expression, name: string, depth = 0): ts.Expression[] {
  if (!ts.isObjectLiteralExpression(node) || depth > 4) return [];
  return node.properties.flatMap((property) => {
    if (ts.isSpreadAssignment(property)) {
      const spread = rpcArgumentObject(property.expression);
      return spread ? organizationPropertyValues(spread, name, depth + 1) : [];
    }
    if (ts.isShorthandPropertyAssignment(property) && property.name.text === name) return [property.name];
    if (
      ts.isPropertyAssignment(property) &&
      (ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name)) &&
      property.name.text === name
    )
      return [property.initializer];
    return [];
  });
}

/** The object literal an rpc receives: inline, through `rpcArgs(name, {...})`, or bound to a const. */
function rpcArgumentObject(
  argument: ts.Expression | undefined,
  depth = 0,
): ts.ObjectLiteralExpression | undefined {
  if (!argument || depth > 4) return undefined;
  const node = unwrap(argument);
  if (ts.isObjectLiteralExpression(node)) return node;
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'rpcArgs') {
    return rpcArgumentObject(node.arguments[1], depth + 1);
  }
  if (ts.isIdentifier(node)) {
    const initializer = bindingInitializer(enclosingFunction(node) ?? node.getSourceFile(), node.text);
    return rpcArgumentObject(initializer, depth + 1);
  }
  return undefined;
}

/** Why an organization value is not trusted, or undefined when it derives from the resolved context. */
function untrustedOrigin(value: ts.Expression, scope: OriginScope): string | undefined {
  const origin: Origin = organizationOrigin(value, scope);
  if (origin.kind === 'trusted' || origin.kind === 'parameter') return undefined;
  if (origin.kind === 'action-parameter') {
    return `organization value \`${value.getText()}\` is the Server Action's raw parameter ${origin.name}; resolve it with resolveActionContextFor first or use the context's orgId`;
  }
  return `organization value \`${value.getText()}\` does not derive from a resolved context or a loaded row (${origin.text.slice(0, 60)})`;
}

function scanTenantScope(
  file: string,
  text: string,
  tables: ReadonlySet<string>,
  functions: ReadonlyMap<string, string | null> = new Map(),
): { findings: TenantFinding[]; annotations: { line: number; used: boolean; reason: string }[] } {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const lines = text.split(/\r?\n/);
  const findings: TenantFinding[] = [];
  const annotations = new Map<number, { line: number; used: boolean; reason: string }>();
  lines.forEach((content, index) => {
    const match = ANNOTATION.exec(content.trim());
    if (match) annotations.set(index, { line: index + 1, used: false, reason: match[1] ?? '' });
  });
  const originScope: OriginScope = moduleOriginScope(source);

  /** Records the annotation above `node`; returns a finding text when it is missing or malformed. */
  const reviewedReason = (node: ts.Node, call: ts.CallExpression): string | undefined => {
    const annotation = annotationAbove(source, lines, chainAnchor(node as ts.Expression), call);
    if (!annotation) return 'no tenant-scope annotation';
    const record = annotations.get(annotation.line);
    if (record) record.used = true;
    if (!(annotation.reason in TENANT_SCOPE_REASONS))
      return `unknown tenant-scope reason "${annotation.reason}"`;
    if (annotation.explanation.length < 12)
      return `tenant-scope ${annotation.reason} needs a "— why" explanation`;
    return undefined;
  };

  const scanRpc = (node: ts.CallExpression, receiver: ts.Expression): void => {
    if (isRlsClient(receiver)) return;
    const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
    const name = stringValue(node.arguments[0]);
    const table = `rpc ${name ?? '<runtime name>'}`;
    if (name !== undefined && functions.get(name) === null) {
      if (!(name in UNSCOPED_FUNCTIONS))
        findings.push({
          file,
          line,
          table,
          problem: 'takes no organization argument and is not in UNSCOPED_FUNCTIONS',
        });
      return;
    }
    // A runtime name is checked against every organization argument name.
    const argumentNames =
      name === undefined ? ORGANIZATION_ARGUMENT_NAMES : [functions.get(name) ?? 'p_organization_id'];
    const args = rpcArgumentObject(node.arguments[1]);
    const [value] = args
      ? argumentNames.flatMap((argument) => organizationPropertyValues(args, argument))
      : [];
    if (!value) {
      const problem = reviewedReason(chainCalls(node).top, node);
      if (problem)
        findings.push({
          file,
          line,
          table,
          problem: `does not visibly pass its organization and has ${problem}`,
        });
      return;
    }
    const problem = untrustedOrigin(value, originScope);
    if (problem) findings.push({ file, line, table, problem });
  };

  ts.forEachChild(source, function visit(node) {
    ts.forEachChild(node, visit);
    if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return;
    if (node.expression.name.text === 'rpc') {
      scanRpc(node, node.expression.expression);
      return;
    }
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
    for (const value of allCalls.flatMap(organizationFilterValues)) {
      const problem = untrustedOrigin(value, originScope);
      if (problem) findings.push({ file, line, table, problem });
    }
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
  const functions = functionOrganizationArguments();
  expect([...functions.values()].filter((argument) => argument !== null).length).toBeGreaterThan(100);
  const unscoped: string[] = [];
  const stale: string[] = [];
  const called = new Set<string>();
  for (const file of listProductSources(['lib', 'app'])) {
    const text = readFileSync(resolve(repositoryRoot, file), 'utf8');
    for (const match of text.matchAll(/\.rpc\(\s*'([a-z_]+)'/g)) if (match[1]) called.add(match[1]);
    if (!text.includes('.from(') && !text.includes('.rpc(') && !text.includes('tenant-scope:')) continue;
    const { findings, annotations } = scanTenantScope(file, text, tables, functions);
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
  expect(
    Object.keys(UNSCOPED_FUNCTIONS).filter((name) => !called.has(name) || functions.get(name) !== null),
    'These UNSCOPED_FUNCTIONS entries name a function that no product code calls or that takes an organization argument; remove them.',
  ).toEqual([]);
});

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
      `async function f(admin, orgId) { await admin.from('jobs').delete().eq('id', id).eq('organization_id', orgId); }`,
    ),
  ).toEqual([]);
  expect(
    fixtureFindings(
      `async function f(admin, orgId) { let query = admin.from('jobs').select('id'); query = query.eq('organization_id', orgId); }`,
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
    `async function f(admin, orgId) {\n  // tenant-scope: own-user-row — the caller's own row\n  await admin.from('jobs').select('id').eq('organization_id', orgId);\n}`,
    fixtureTables,
  );
  expect(annotations.map((annotation) => annotation.used)).toEqual([false]);
});

const fixtureFunctions = new Map<string, string | null>([
  ['close_job', 'p_organization_id'],
  ['withdraw_own_request', null],
]);

function actionFindings(body: string, helpers = ''): string[] {
  const code = `'use server';\n${helpers}\nexport async function save(rawInput) {\n${body}\n}`;
  return scanTenantScope('lib/fixture.ts', code, fixtureTables, fixtureFunctions).findings.map(
    (finding) => `${finding.table}: ${finding.problem.split(';')[0]}`,
  );
}

test('planted origin violations: an organization value must come from the resolved context', () => {
  const parse = 'const parsed = inputSchema.safeParse(rawInput); if (!parsed.success) return;';
  const context = 'const auth = await resolveActionContext(); if (!auth.success) return auth;';
  const admin = 'const admin = createSupabaseAdminClient();';
  expect(
    actionFindings(
      `${parse} ${context} ${admin} await admin.rpc('close_job', { p_organization_id: auth.context.orgId, p_job_id: parsed.data.jobId });`,
    ),
  ).toEqual([]);
  expect(
    actionFindings(
      `${parse} ${context} ${admin} await admin.rpc('close_job', { p_organization_id: parsed.data.organizationId });`,
    ),
  ).toEqual([
    "rpc close_job: organization value `parsed.data.organizationId` is the Server Action's raw parameter rawInput",
  ]);
  expect(
    actionFindings(
      `${parse} const auth = await resolveActionContextFor(parsed.data.organizationId); if (!auth.success) return auth; ${admin} await admin.rpc('close_job', { p_organization_id: parsed.data.organizationId });`,
    ),
  ).toEqual([]);
  expect(actionFindings(`${context} ${admin} await admin.rpc('close_job', { p_job_id: rawInput });`)).toEqual(
    ['rpc close_job: does not visibly pass its organization and has no tenant-scope annotation'],
  );
  expect(
    actionFindings(
      `${context} await createSupabaseAdminClient().rpc('withdraw_own_request', { p_id: rawInput });`,
    ),
  ).toEqual(['rpc withdraw_own_request: takes no organization argument and is not in UNSCOPED_FUNCTIONS']);
  expect(
    actionFindings(
      `${context} ${admin} await admin.from('jobs').update({ done: true }).eq('organization_id', rawInput.organizationId);`,
    ),
  ).toEqual([
    "jobs: organization value `rawInput.organizationId` is the Server Action's raw parameter rawInput",
  ]);
});

test('planted origin cases: rows, local helpers and their callers', () => {
  const admin = 'const admin = createSupabaseAdminClient();';
  const unscopedRow =
    "\n// tenant-scope: by-id-then-verified — the job's organization must be resolved before use\nconst { data: job } = await admin.from('jobs').select('organization_id').eq('id', rawInput).single();\n";
  expect(
    actionFindings(
      `${admin} ${unscopedRow} await admin.rpc('close_job', { p_organization_id: job.organization_id });`,
    ),
  ).toEqual([
    "rpc close_job: organization value `job.organization_id` does not derive from a resolved context or a loaded row (an unscoped read of 'jobs')",
  ]);
  expect(
    actionFindings(
      `${admin} ${unscopedRow} const auth = await resolveActionContextFor(job.organization_id); if (!auth.success) return auth; await admin.rpc('close_job', { p_organization_id: job.organization_id });`,
    ),
  ).toEqual([]);
  const helper =
    "async function close(admin, { orgId }) { await admin.from('jobs').delete().eq('organization_id', orgId); }";
  expect(
    actionFindings(
      `const auth = await resolveActionContext(); if (!auth.success) return auth; await close(createSupabaseAdminClient(), { orgId: auth.context.orgId });`,
      helper,
    ),
  ).toEqual([]);
  expect(actionFindings(`await close(createSupabaseAdminClient(), { orgId: rawInput });`, helper)).toEqual([
    "jobs: organization value `orgId` is the Server Action's raw parameter rawInput",
  ]);
});

test('planted verifier cases: only a verifier of the same binding, called before the use, vouches', () => {
  const parse = 'const parsed = inputSchema.safeParse(rawInput); if (!parsed.success) return;';
  const admin = 'const admin = createSupabaseAdminClient();';
  const verify =
    'const auth = await resolveActionContextFor(parsed.data.organizationId); if (!auth.success) return auth;';
  const rpc = "await admin.rpc('close_job', { p_organization_id: parsed.data.organizationId });";
  const raw =
    "rpc close_job: organization value `parsed.data.organizationId` is the Server Action's raw parameter rawInput";
  expect(actionFindings(`${parse} ${verify} ${admin} ${rpc}`)).toEqual([]);
  // A block-scoped `parsed` shadows the verified one: same text, another binding.
  expect(
    actionFindings(
      `${parse} ${verify} ${admin} { const parsed = { data: { organizationId: rawInput } }; ${rpc} }`,
    ),
  ).toEqual([raw]);
  // The verifier runs after the value is used.
  expect(actionFindings(`${parse} ${admin} ${rpc} ${verify}`)).toEqual([raw]);
  // A resolver that does not verify its argument vouches for nothing.
  expect(
    actionFindings(
      `${parse} const auth = await requireAuth(parsed.data.organizationId); if (!auth.success) return auth; ${admin} ${rpc}`,
    ),
  ).toEqual([raw]);
  // A local helper that passes its own first parameter to a verifier verifies too.
  expect(
    actionFindings(
      `${parse} const auth = await contextFor(parsed.data.organizationId); if (!auth.success) return auth; ${admin} ${rpc}`,
      'async function contextFor(organizationId) { return resolveActionContextFor(organizationId); }',
    ),
  ).toEqual([]);
});

test('planted user scopes: a user_id filter scopes rows only with a trusted user id', () => {
  const admin = 'const admin = createSupabaseAdminClient();';
  const read = (userId: string): string =>
    `const { data: member } = await admin.from('organization_members').select('organization_id').eq('user_id', ${userId}).single(); await admin.rpc('close_job', { p_organization_id: member.organization_id });`;
  expect(
    actionFindings(
      `const user = await getAuthenticatedUser(); if (!user) return; ${admin} ${read('user.id')}`,
    ),
  ).toEqual([]);
  expect(
    actionFindings(
      `const auth = await resolveActionContext(); if (!auth.success) return auth; ${admin} ${read('auth.context.userId')}`,
    ),
  ).toEqual([]);
  expect(actionFindings(`${admin} ${read('rawInput')}`)).toEqual([
    "rpc close_job: organization value `member.organization_id` is the Server Action's raw parameter rawInput",
  ]);
});

test('an overloaded database function contributes the Args of every variant', () => {
  const types = ts.createSourceFile(
    'database.types.ts',
    [
      'export type Database = { public: { Functions: {',
      '  single: { Args: { p_id: string }; Returns: undefined };',
      '  overloaded: | { Args: { p_id: string }; Returns: undefined } | { Args: { p_org_id: string; p_id: string }; Returns: undefined };',
      '  split_args: { Args: { p_id: string } | { organization_id: string }; Returns: undefined };',
      '} } };',
    ].join('\n'),
    ts.ScriptTarget.Latest,
    true,
  );
  expect(Object.fromEntries(functionOrganizationArguments(types))).toEqual({
    single: null,
    overloaded: 'p_org_id',
    split_args: 'organization_id',
  });
});
