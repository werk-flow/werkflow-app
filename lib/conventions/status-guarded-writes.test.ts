import { expect, test } from 'bun:test';
import ts from 'typescript';
import { listProductSources, parseProductSource } from './product-sources';

// Tier 2 for "a state check and its write are one step" (AGENTS.md "4. Code
// quality and maintainability"; docs/technical/code-quality.md). An action that
// checks a row's state (`status`, `role`, a `…_status`, a `…_at` marker, a
// movement quantity, a version) and then updates or deletes the row by id alone
// overwrites a change that landed between the check and the write: a pending
// invite is deleted, a line that gained a movement swaps its item, a role an
// admin just raised is lowered by Büro.
//
// For every `.from('T').update()` or `.from('T').delete()` under app/ and lib/,
// the scan collects the state columns of T (from the generated database types)
// that the enclosing function reads before the write: a property access
// (`row.status`, `entries.some((entry) => entry.status …)`) or a destructured
// binding (`const { status } = managed.invite`). A value copied into an object
// or assigned to is not a check. The write complies when its filter names
// every checked column (`.eq('status', 'pending')`) and it reads its rows back
// (`.select('id')`), so that zero rows become the stale refusal. Filters added
// to a builder held in a variable (`const guarded = base.eq(…)`) count. A
// database function that locks the row and repeats the check (`.rpc(...)`) is
// the other way to comply; the scan does not see it as a write.

const STATE_COLUMN = /^(status|state|role|version|[a-z]+(?:_[a-z]+)*_(?:status|state|version|at|quantity))$/;
// Bookkeeping stamps are not a state an action decides on.
const NOT_A_STATE = new Set(['created_at', 'updated_at']);
// Columns whose name reads like a state but that hold plain data, keyed `table.column`.
const DATA_COLUMNS: Readonly<Record<string, string>> = {
  'client_contacts.role': 'The contact’s job title as free text („Hausverwalter“), not a permission role.',
};
const FILTERS = new Set(['eq', 'neq', 'is', 'in', 'gt', 'gte', 'lt', 'lte', 'not', 'match', 'filter']);
const DATABASE_TYPES = 'lib/supabase/database.types.ts';

// Reviewed writes, keyed `file::function::table`, with the reason the state
// check may stay outside the write. Shrink only; a stale entry fails the test.
const ALLOWED_UNGUARDED: Readonly<Record<string, string>> = {};

function unwrap(node: ts.Expression): ts.Expression {
  let current = node;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isAwaitExpression(current)
  )
    current = current.expression;
  return current;
}

function propertyNameText(name: ts.PropertyName): string {
  return ts.isIdentifier(name) || ts.isStringLiteralLike(name) ? name.text : name.getText();
}

function typeMember(members: ts.NodeArray<ts.TypeElement>, name: string): ts.TypeLiteralNode | null {
  for (const member of members)
    if (
      ts.isPropertySignature(member) &&
      propertyNameText(member.name) === name &&
      member.type &&
      ts.isTypeLiteralNode(member.type)
    )
      return member.type;
  return null;
}

/** The state columns of every public table, from the generated database types. */
function stateColumnsByTable(): Map<string, Set<string>> {
  const source = parseProductSource(DATABASE_TYPES);
  const columns = new Map<string, Set<string>>();
  const visit = (node: ts.Node): void => {
    if (ts.isTypeAliasDeclaration(node) && node.name.text === 'Database' && ts.isTypeLiteralNode(node.type)) {
      const publicSchema = typeMember(node.type.members, 'public');
      const tables = publicSchema ? typeMember(publicSchema.members, 'Tables') : null;
      for (const table of tables?.members ?? []) {
        if (!ts.isPropertySignature(table) || !table.type || !ts.isTypeLiteralNode(table.type)) continue;
        const row = typeMember(table.type.members, 'Row');
        const names = (row?.members ?? []).flatMap((member) =>
          ts.isPropertySignature(member) ? [propertyNameText(member.name)] : [],
        );
        columns.set(
          propertyNameText(table.name),
          new Set(names.filter((name) => STATE_COLUMN.test(name) && !NOT_A_STATE.has(name))),
        );
      }
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return columns;
}

function enclosingFunction(node: ts.Node): ts.Node {
  let current: ts.Node | undefined = node.parent;
  while (current && !ts.isFunctionLike(current) && !ts.isSourceFile(current)) current = current.parent;
  return current ?? node.getSourceFile();
}

function functionName(scope: ts.Node): string {
  if ((ts.isFunctionDeclaration(scope) || ts.isMethodDeclaration(scope)) && scope.name)
    return scope.name.getText();
  if (ts.isVariableDeclaration(scope.parent) && ts.isIdentifier(scope.parent.name))
    return scope.parent.name.text;
  return ts.isSourceFile(scope) ? '<module>' : '<anonymous>';
}

type ChainCall = { method: string; firstArgument: string | null };

/** The calls of a builder chain from its root outwards: `.from('t')`, `.update()`, `.eq('id', x)`. */
function chainCalls(expression: ts.Expression): ChainCall[] {
  const calls: ChainCall[] = [];
  let current: ts.Expression = unwrap(expression);
  while (ts.isCallExpression(current) && ts.isPropertyAccessExpression(current.expression)) {
    const argument = current.arguments[0];
    calls.unshift({
      method: current.expression.name.text,
      firstArgument: argument && ts.isStringLiteralLike(argument) ? argument.text : null,
    });
    current = unwrap(current.expression.expression);
  }
  return calls;
}

/** The outermost expression of the builder chain that `node` belongs to. */
function chainTop(node: ts.Expression): ts.Expression {
  let current = node;
  for (;;) {
    const parent = current.parent;
    if (
      (ts.isPropertyAccessExpression(parent) && parent.expression === current) ||
      (ts.isCallExpression(parent) && parent.expression === current)
    )
      current = parent;
    else return current;
  }
}

/** Past the parentheses, `as` casts and `?:` branches that wrap a builder. */
function wrapperOf(expression: ts.Expression): ts.Node {
  let current: ts.Node = expression;
  while (
    ts.isParenthesizedExpression(current.parent) ||
    ts.isConditionalExpression(current.parent) ||
    ts.isAsExpression(current.parent)
  )
    current = current.parent;
  return current;
}

/**
 * Collects the calls a builder receives from `start` on: its own chain, the
 * chain continued after a wrapper (`(swap ? base.eq(…) : base).select('id')`),
 * and the variable it ends up held in (`const guarded = …`).
 */
function followBuilder(start: ts.Expression, calls: ChainCall[], holders: string[]): void {
  let top = chainTop(start);
  calls.push(...chainCalls(top));
  for (;;) {
    const wrapper = wrapperOf(top);
    const parent = wrapper.parent;
    if (wrapper !== top && ts.isPropertyAccessExpression(parent) && parent.expression === wrapper) {
      top = chainTop(parent);
      calls.push(...chainCalls(top));
      continue;
    }
    if (ts.isVariableDeclaration(parent) && parent.initializer === wrapper && ts.isIdentifier(parent.name))
      holders.push(parent.name.text);
    return;
  }
}

/** The calls the write chain receives, including those on the variables that hold its builder. */
function writeCalls(write: ts.PropertyAccessExpression, scope: ts.Node): ChainCall[] {
  const calls: ChainCall[] = [];
  const pending: string[] = [];
  followBuilder(write, calls, pending);
  const seen = new Set<string>();
  for (let holder = pending.pop(); holder !== undefined; holder = pending.pop()) {
    if (seen.has(holder)) continue;
    seen.add(holder);
    const name = holder;
    const visit = (node: ts.Node): void => {
      const parent = node.parent;
      if (
        ts.isIdentifier(node) &&
        node.text === name &&
        !(ts.isVariableDeclaration(parent) && parent.name === node) &&
        !(ts.isPropertyAccessExpression(parent) && parent.name === node)
      )
        followBuilder(node, calls, pending);
      ts.forEachChild(node, visit);
    };
    visit(scope);
  }
  return calls;
}

/** The columns a filter call names; `.or('a.gt.0,b.gt.0')` names each column of its PostgREST filter. */
function filteredColumns(call: ChainCall): string[] {
  if (!call.firstArgument) return [];
  if (call.method === 'or')
    return [...call.firstArgument.matchAll(/(?:^|[,(])([a-z_]+)\.(?:not\.)?[a-z]+\./g)].flatMap((match) =>
      match[1] ? [match[1]] : [],
    );
  return FILTERS.has(call.method) ? [call.firstArgument] : [];
}

/** A read of the value, not a copy into an object (`{ status: row.status }`) or an assignment target. */
function isCheck(node: ts.PropertyAccessExpression): boolean {
  const parent = node.parent;
  if (ts.isPropertyAssignment(parent) && parent.initializer === node) return false;
  return !(
    ts.isBinaryExpression(parent) &&
    parent.left === node &&
    parent.operatorToken.kind === ts.SyntaxKind.EqualsToken
  );
}

/** State columns of the written table that the function reads before `before`. */
function checkedColumns(scope: ts.Node, stateColumns: ReadonlySet<string>, before: number): Set<string> {
  const checked = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (node.pos >= before) return;
    if (ts.isPropertyAccessExpression(node) && stateColumns.has(node.name.text) && isCheck(node))
      checked.add(node.name.text);
    if (ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent)) {
      const key = node.propertyName ?? node.name;
      if (ts.isIdentifier(key) && stateColumns.has(key.text)) checked.add(key.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(scope);
  return checked;
}

function findingsIn(
  file: string,
  stateColumns: ReadonlyMap<string, ReadonlySet<string>>,
  text?: string,
): string[] {
  const source = parseProductSource(file, text);
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isPropertyAccessExpression(node) &&
      /^(update|delete)$/.test(node.name.text) &&
      ts.isCallExpression(node.parent) &&
      node.parent.expression === node
    ) {
      const table = chainCalls(chainTop(node)).find((call) => call.method === 'from')?.firstArgument;
      const columns = table ? stateColumns.get(table) : undefined;
      if (table && columns) {
        const scope = enclosingFunction(node);
        const checked = checkedColumns(scope, columns, node.pos);
        if (checked.size > 0) {
          const calls = writeCalls(node, scope);
          const filtered = new Set(calls.flatMap(filteredColumns));
          const missing = [...checked].filter((column) => !filtered.has(column)).sort();
          const problems = [
            ...(missing.length > 0 ? [`filter on ${missing.join(', ')} missing`] : []),
            ...(calls.some((call) => call.method === 'select') ? [] : ['reads no rows back']),
          ];
          if (problems.length > 0)
            found.push(
              `${file}::${functionName(scope)}::${table} (${node.name.text}: ${problems.join('; ')})`,
            );
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

const findingKey = (finding: string): string => finding.replace(/ \(.*\)$/, '');

test('a write after a state check filters on the checked state and reads its rows back', () => {
  const stateColumns = stateColumnsByTable();
  expect(stateColumns.get('organization_invites')?.has('status')).toBe(true);
  const staleDataColumns: string[] = [];
  for (const key of Object.keys(DATA_COLUMNS)) {
    const [table = '', column = ''] = key.split('.');
    // Removing the data column from its table's state columns takes it out of the scan.
    if (!stateColumns.get(table)?.delete(column)) staleDataColumns.push(key);
  }
  expect(
    staleDataColumns,
    'These DATA_COLUMNS keys name no state-like column of the generated types; remove them.',
  ).toEqual([]);
  const findings = listProductSources(['app', 'lib']).flatMap((file) => findingsIn(file, stateColumns));
  expect(
    findings.filter((finding) => !Object.hasOwn(ALLOWED_UNGUARDED, findingKey(finding))),
    "Repeat each checked state in the write's filter (`.eq('status', expected)`), read the rows back with `.select('id')` and return the module's stale or conflict code when none came back, or move the check into the database function that writes the row under lock.",
  ).toEqual([]);
  expect(
    Object.keys(ALLOWED_UNGUARDED).filter((entry) => !findings.map(findingKey).includes(entry)),
    'These allowlisted writes are no longer findings; remove them from ALLOWED_UNGUARDED.',
  ).toEqual([]);
}, 60_000);

test('the scan catches a planted read-check-write', () => {
  const columns = new Map([['things', new Set(['status', 'taken_quantity'])]]);
  const action = `export async function cancelThing(id: string) {
  const { data: thing } = await admin.from('things').select('id, status').eq('id', id).maybeSingle();
  if (thing?.status !== 'pending') return { success: false, error: 'not_pending' };
  const { error } = await admin.from('things').update({ status: 'cancelled' }).eq('id', id);
  return error ? { success: false, error: 'cancel_failed' } : { success: true };
}`;
  expect(findingsIn('lib/planted.ts', columns, action)).toEqual([
    'lib/planted.ts::cancelThing::things (update: filter on status missing; reads no rows back)',
  ]);
  const guarded = action.replace(".eq('id', id);", ".eq('id', id).eq('status', 'pending').select('id');");
  expect(findingsIn('lib/planted.ts', columns, guarded)).toEqual([]);
  const unread = action.replace(".eq('id', id);", ".eq('id', id).eq('status', 'pending');");
  expect(findingsIn('lib/planted.ts', columns, unread)).toEqual([
    'lib/planted.ts::cancelThing::things (update: reads no rows back)',
  ]);

  // A state handed over by a helper and destructured is a check too.
  const destructured = `export async function deleteThing(id: string) {
  const { status } = await loadThing(id);
  if (status === 'pending') return { success: false, error: 'must_cancel_first' };
  await admin.from('things').delete().eq('id', id).select('id');
}`;
  expect(findingsIn('lib/planted.ts', columns, destructured)).toEqual([
    'lib/planted.ts::deleteThing::things (delete: filter on status missing)',
  ]);

  // A filter added to a held builder counts; a copied value is no check.
  const held = `export async function editThing(id: string, swap: boolean, row: Thing) {
  if (swap && row.taken_quantity > 0) return { success: false, error: 'has_movements' };
  const payload = { note: 'x', taken_quantity: row.taken_quantity };
  const base = admin.from('things').update(payload).eq('id', id);
  const guarded = swap ? base.eq('taken_quantity', 0) : base;
  return guarded.select('id').maybeSingle();
}`;
  expect(findingsIn('lib/planted.ts', columns, held)).toEqual([]);
  expect(findingsIn('lib/planted.ts', columns, held.replace(".eq('taken_quantity', 0)", ''))).toEqual([
    'lib/planted.ts::editThing::things (update: filter on taken_quantity missing)',
  ]);
  const copiedOnly = held.replace('swap && row.taken_quantity > 0', 'swap');
  expect(findingsIn('lib/planted.ts', columns, copiedOnly.replace(".eq('taken_quantity', 0)", ''))).toEqual(
    [],
  );

  // The chain continues after a wrapped builder, and `.or()` names the columns of its filter.
  const wrapped = held.replace(
    "const guarded = swap ? base.eq('taken_quantity', 0) : base;\n  return guarded",
    "return (swap ? base.or('taken_quantity.eq.0,status.neq.done') : base)",
  );
  expect(findingsIn('lib/planted.ts', columns, wrapped)).toEqual([]);
  expect(findingsIn('lib/planted.ts', columns, wrapped.replace("'taken_quantity.eq.0,", "'"))).toEqual([
    'lib/planted.ts::editThing::things (update: filter on taken_quantity missing)',
  ]);
});
