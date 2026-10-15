import { describe, expect, test } from 'bun:test';
import ts from 'typescript';

import { listProductSources, parseProductSource } from '../conventions/product-sources';

// Tier 2 for the abuse limits (docs/technical/security.md#trust-boundaries,
// "Abuse limits"). Every product call that sends mail through an edge
// function, redeems an invite or activates billing must follow a checked
// `consumeRateLimit` call (lib/security/rate-limit.ts) in the function that
// makes it. Checked means the limiter runs unconditionally in that function's
// statement list (a `try` block continues it) before the call, and its
// verdict is bound and tested by an `if` that returns or throws, or the call
// is itself that `if`'s condition. A module-local helper counts as a limiter
// when its body checks a limiter that way or returns a limiter's verdict;
// its callers check its result in turn. A call in a module-local, unexported
// helper is also limited when every call of that helper follows a checked
// limit in its caller. Anything else fails here, or carries a reviewed reason
// in REVIEWED_UNLIMITED.

type LimitedKind = 'edge-function mail' | 'invite redemption' | 'billing activation';

/** `file#kind` -> why the call needs no limit. Shrink-only: an entry that matches nothing fails. */
const REVIEWED_UNLIMITED: Readonly<Record<string, string>> = {};

const LIMITER = 'consumeRateLimit';
const REDEMPTION_RPCS = new Set(['redeem_organization_invite_for_user']);
const BILLING_TABLES = new Set(['subscriptions']);
const WRITE_METHODS = new Set(['insert', 'upsert', 'update']);

function firstStringArgument(call: ts.CallExpression): string | null {
  const [first] = call.arguments;
  return first !== undefined && ts.isStringLiteralLike(first) ? first.text : null;
}

// True when the callee chain of a write runs through `.from('<billing table>')`.
function writesBillingTable(callee: ts.PropertyAccessExpression): boolean {
  let current: ts.Expression = callee.expression;
  while (ts.isCallExpression(current) || ts.isPropertyAccessExpression(current)) {
    if (
      ts.isCallExpression(current) &&
      ts.isPropertyAccessExpression(current.expression) &&
      current.expression.name.text === 'from'
    ) {
      const table = firstStringArgument(current);
      return table !== null && BILLING_TABLES.has(table);
    }
    current = current.expression;
  }
  return false;
}

function limitedKind(call: ts.CallExpression): LimitedKind | null {
  const callee = call.expression;
  if (!ts.isPropertyAccessExpression(callee)) return null;
  const method = callee.name.text;
  if (
    method === 'invoke' &&
    ts.isPropertyAccessExpression(callee.expression) &&
    callee.expression.name.text === 'functions'
  ) {
    return 'edge-function mail';
  }
  if (method === 'rpc') {
    const name = firstStringArgument(call);
    return name !== null && REDEMPTION_RPCS.has(name) ? 'invite redemption' : null;
  }
  if (WRITE_METHODS.has(method) && writesBillingTable(callee)) return 'billing activation';
  return null;
}

type NamedFunction = { name: string; body: ts.Node; exported: boolean };

function isExported(node: ts.Node): boolean {
  const statement = ts.isVariableDeclaration(node) ? node.parent.parent : node;
  return (
    ts.canHaveModifiers(statement) &&
    (ts.getModifiers(statement) ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
  );
}

// The nearest enclosing function with a name: a declaration, or a function bound to a variable.
function enclosingNamedFunction(node: ts.Node): NamedFunction | null {
  for (let current = node.parent; current !== undefined; current = current.parent) {
    if (ts.isFunctionDeclaration(current) && current.name && current.body) {
      return { name: current.name.text, body: current.body, exported: isExported(current) };
    }
    if (
      (ts.isArrowFunction(current) || ts.isFunctionExpression(current)) &&
      ts.isVariableDeclaration(current.parent) &&
      ts.isIdentifier(current.parent.name)
    ) {
      return { name: current.parent.name.text, body: current.body, exported: isExported(current.parent) };
    }
  }
  return null;
}

function forEachNode(node: ts.Node, visit: (node: ts.Node) => void): void {
  visit(node);
  ts.forEachChild(node, (child) => forEachNode(child, visit));
}

function calledName(call: ts.CallExpression): string | null {
  return ts.isIdentifier(call.expression) ? call.expression.text : null;
}

function unwrapExpression(node: ts.Expression): ts.Expression {
  let current = node;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAwaitExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isNonNullExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function isLimiterCall(node: ts.Expression, limiters: ReadonlySet<string>): boolean {
  const inner = unwrapExpression(node);
  if (!ts.isCallExpression(inner)) return false;
  const name = calledName(inner);
  return name !== null && limiters.has(name);
}

/**
 * Whether a condition always evaluates a limiter call: `await limit()`,
 * `!(await limit())`, `(await limit()) !== 'allowed'`. The right side of
 * `&&`, `||` and `??` may not run, so only their left side counts.
 */
function conditionRunsLimiter(condition: ts.Expression, limiters: ReadonlySet<string>): boolean {
  const node = unwrapExpression(condition);
  if (isLimiterCall(node, limiters)) return true;
  if (ts.isPrefixUnaryExpression(node)) return conditionRunsLimiter(node.operand, limiters);
  if (!ts.isBinaryExpression(node)) return false;
  const shortCircuits = new Set([
    ts.SyntaxKind.AmpersandAmpersandToken,
    ts.SyntaxKind.BarBarToken,
    ts.SyntaxKind.QuestionQuestionToken,
  ]);
  if (shortCircuits.has(node.operatorToken.kind)) return conditionRunsLimiter(node.left, limiters);
  return conditionRunsLimiter(node.left, limiters) || conditionRunsLimiter(node.right, limiters);
}

/** Whether a branch leaves the function: a `return` or `throw`, or a block that holds one. */
function exits(statement: ts.Statement): boolean {
  if (ts.isReturnStatement(statement) || ts.isThrowStatement(statement)) return true;
  return ts.isBlock(statement) && statement.statements.some(exits);
}

function mentions(node: ts.Node, binding: string): boolean {
  if (ts.isIdentifier(node) && node.text === binding) return true;
  return ts.forEachChild(node, (child) => mentions(child, binding) || undefined) === true;
}

/** The name `const verdict = await limit(...)` binds, when the statement is that. */
function boundLimiter(statement: ts.Statement, limiters: ReadonlySet<string>): string | undefined {
  if (!ts.isVariableStatement(statement)) return undefined;
  const [declaration, ...others] = statement.declarationList.declarations;
  if (!declaration || others.length > 0 || !ts.isIdentifier(declaration.name)) return undefined;
  const initializer = declaration.initializer;
  return initializer && isLimiterCall(initializer, limiters) ? declaration.name.text : undefined;
}

type LimitState = { kind: 'open' } | { kind: 'pending'; binding: string } | { kind: 'checked' };

/** The state after one statement of the owner's own list. */
function stepLimit(statement: ts.Statement, state: LimitState, limiters: ReadonlySet<string>): LimitState {
  if (state.kind === 'checked') return state;
  if (state.kind === 'pending') {
    if (
      ts.isIfStatement(statement) &&
      mentions(statement.expression, state.binding) &&
      exits(statement.thenStatement)
    ) {
      return { kind: 'checked' };
    }
    // Returning the verdict hands its check to the caller.
    if (
      ts.isReturnStatement(statement) &&
      statement.expression &&
      mentions(statement.expression, state.binding)
    ) {
      return { kind: 'checked' };
    }
    return state;
  }
  if (
    ts.isIfStatement(statement) &&
    conditionRunsLimiter(statement.expression, limiters) &&
    exits(statement.thenStatement)
  ) {
    return { kind: 'checked' };
  }
  if (
    ts.isReturnStatement(statement) &&
    statement.expression &&
    isLimiterCall(statement.expression, limiters)
  ) {
    return { kind: 'checked' };
  }
  const binding = boundLimiter(statement, limiters);
  return binding === undefined ? state : { kind: 'pending', binding };
}

type LimitWalk = { kind: 'reached'; checked: boolean } | { kind: 'passed'; state: LimitState };

/**
 * Walks one statement list in order until the statement that holds `target`.
 * A `try` block continues the list; its state carries past the statement only
 * when no catch can fall through after a refusal was skipped.
 */
function walkLimit(
  statements: readonly ts.Statement[],
  start: LimitState,
  limiters: ReadonlySet<string>,
  target: ts.Node | undefined,
): LimitWalk {
  let state = start;
  for (const statement of statements) {
    const holdsTarget = target !== undefined && statement.pos <= target.pos && target.end <= statement.end;
    if (holdsTarget) {
      if (state.kind !== 'checked' && ts.isTryStatement(statement)) {
        const block = statement.tryBlock;
        if (block.pos <= target.pos && target.end <= block.end) {
          return walkLimit(block.statements, state, limiters, target);
        }
      }
      return { kind: 'reached', checked: state.kind === 'checked' };
    }
    if (ts.isTryStatement(statement)) {
      const inner = walkLimit(statement.tryBlock.statements, state, limiters, undefined);
      const catchExits = !statement.catchClause || exits(statement.catchClause.block);
      if (inner.kind === 'passed' && catchExits) state = inner.state;
      continue;
    }
    state = stepLimit(statement, state, limiters);
  }
  return { kind: 'passed', state };
}

/** Whether a function body checks a limiter or hands a limiter's verdict to its caller. */
function settlesLimit(body: ts.ConciseBody, limiters: ReadonlySet<string>): boolean {
  if (!ts.isBlock(body)) return isLimiterCall(body, limiters);
  const walk = walkLimit(body.statements, { kind: 'open' }, limiters, undefined);
  return walk.kind === 'passed' && walk.state.kind === 'checked';
}

function namedFunctions(source: ts.SourceFile): Array<{ name: string; body: ts.ConciseBody }> {
  const functions: Array<{ name: string; body: ts.ConciseBody }> = [];
  forEachNode(source, (node) => {
    if (ts.isFunctionDeclaration(node) && node.name && node.body) {
      functions.push({ name: node.name.text, body: node.body });
    }
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
    ) {
      functions.push({ name: node.name.text, body: node.initializer.body });
    }
  });
  return functions;
}

/** The unlimited calls of one module, as `kind` plus line. */
function unlimitedCalls(source: ts.SourceFile): Array<{ kind: LimitedKind; line: number }> {
  const calls: ts.CallExpression[] = [];
  forEachNode(source, (node) => {
    if (ts.isCallExpression(node)) calls.push(node);
  });

  // Module functions that check a limiter or return its verdict, to a fixed point.
  const functions = namedFunctions(source);
  const limiters = new Set([LIMITER]);
  for (let changed = true; changed; ) {
    changed = false;
    for (const { name, body } of functions) {
      if (limiters.has(name) || !settlesLimit(body, limiters)) continue;
      limiters.add(name);
      changed = true;
    }
  }

  function isLimitedAt(node: ts.Node, visiting: ReadonlySet<string>): boolean {
    const owner = enclosingNamedFunction(node);
    if (owner === null) return false;
    const available = new Set([...limiters].filter((name) => name !== owner.name));
    const walk = ts.isBlock(owner.body)
      ? walkLimit(owner.body.statements, { kind: 'open' }, available, node)
      : undefined;
    if (walk?.kind === 'reached' && walk.checked) return true;
    if (owner.exported || visiting.has(owner.name)) return false;
    const callers = calls.filter((call) => calledName(call) === owner.name);
    const references = countReferences(source, owner.name);
    // A helper passed around as a value has callers this module cannot see.
    if (callers.length === 0 || references !== callers.length + 1) return false;
    const next = new Set([...visiting, owner.name]);
    return callers.every((call) => isLimitedAt(call, next));
  }

  return calls.flatMap((call) => {
    const kind = limitedKind(call);
    if (kind === null || isLimitedAt(call, new Set())) return [];
    return [{ kind, line: source.getLineAndCharacterOfPosition(call.getStart(source)).line + 1 }];
  });
}

function countReferences(source: ts.SourceFile, name: string): number {
  let count = 0;
  forEachNode(source, (node) => {
    if (ts.isIdentifier(node) && node.text === name) count += 1;
  });
  return count;
}

function limitedKindsIn(source: ts.SourceFile): Set<LimitedKind> {
  const kinds = new Set<LimitedKind>();
  forEachNode(source, (node) => {
    const kind = ts.isCallExpression(node) ? limitedKind(node) : null;
    if (kind !== null) kinds.add(kind);
  });
  return kinds;
}

test('every mail send, invite redemption and billing activation follows consumeRateLimit', () => {
  const files = listProductSources();
  const findings: string[] = [];
  const matched = new Set<string>();
  const seenKinds = new Set<LimitedKind>();
  for (const file of files) {
    const source = parseProductSource(file);
    for (const kind of limitedKindsIn(source)) seenKinds.add(kind);
    for (const { kind, line } of unlimitedCalls(source)) {
      const key = `${file}#${kind}`;
      if (Object.hasOwn(REVIEWED_UNLIMITED, key)) matched.add(key);
      else findings.push(`${file}:${line} ${kind} without a preceding consumeRateLimit`);
    }
  }
  expect(findings).toEqual([]);
  expect(Object.keys(REVIEWED_UNLIMITED).filter((key) => !matched.has(key))).toEqual([]);
  // The scan still recognizes every kind: a renamed call shape must not pass silently.
  expect([...seenKinds].sort()).toEqual(['billing activation', 'edge-function mail', 'invite redemption']);
});

describe('planted violations', () => {
  const findingsIn = (text: string): string[] =>
    unlimitedCalls(parseProductSource('lib/x/actions.ts', text)).map(({ kind, line }) => `${line} ${kind}`);

  test('a send, a redemption and an activation without a limit fail; a limit after the call is too late', () => {
    expect(
      findingsIn(
        [
          'export async function invite() {',
          "  await admin.functions.invoke('send-invite-email', {});",
          '}',
          'export async function redeem() {',
          "  await admin.rpc('redeem_organization_invite_for_user', {});",
          '  await consumeRateLimit(check);',
          '}',
          'export const activate = async () => {',
          "  await admin.from('subscriptions').upsert({ status: 'active' });",
          '};',
          'export async function read() {',
          "  await admin.from('subscriptions').select('*');",
          "  await admin.rpc('get_invite_by_code', {});",
          '}',
        ].join('\n'),
      ),
    ).toEqual(['2 edge-function mail', '5 invite redemption', '9 billing activation']);
  });

  test('a local limiter helper counts, and a helper is limited only when every caller limits first', () => {
    const helper = [
      'async function limit(id) { return consumeRateLimit({ action: "a", subject: id }); }',
      "async function send() { await admin.functions.invoke('mail', {}); }",
      'export async function first() { if (await limit("x")) return; await send(); }',
      'export async function second() { const refused = await limit("y"); if (refused) return refused; await send(); }',
    ];
    expect(findingsIn(helper.join('\n'))).toEqual([]);
    expect(findingsIn([...helper, 'export async function third() { await send(); }'].join('\n'))).toEqual([
      '2 edge-function mail',
    ]);
    expect(findingsIn([...helper, 'export const handlers = { send };'].join('\n'))).toEqual([
      '2 edge-function mail',
    ]);
    // A caller that ignores the helper's verdict does not limit.
    expect(
      findingsIn(
        [...helper, 'export async function fourth() { await limit("z"); await send(); }'].join('\n'),
      ),
    ).toEqual(['2 edge-function mail']);
  });

  test('an ignored, conditional or unchecked verdict does not limit; a checked one does', () => {
    const mail = "await admin.functions.invoke('mail', {});";
    const findingsFor = (body: string): string[] => findingsIn(`export async function send() {\n${body}\n}`);
    expect(findingsFor(`await consumeRateLimit(check); ${mail}`)).toEqual(['2 edge-function mail']);
    expect(findingsFor(`const verdict = await consumeRateLimit(check); ${mail}`)).toEqual([
      '2 edge-function mail',
    ]);
    expect(
      findingsFor(
        `const verdict = await consumeRateLimit(check); ${mail} if (verdict !== 'allowed') return;`,
      ),
    ).toEqual(['2 edge-function mail']);
    expect(
      findingsFor(
        `if (flag) { const verdict = await consumeRateLimit(check); if (verdict !== 'allowed') return; } ${mail}`,
      ),
    ).toEqual(['2 edge-function mail']);
    expect(findingsFor(`if (flag || (await consumeRateLimit(check)) !== 'allowed') return; ${mail}`)).toEqual(
      ['2 edge-function mail'],
    );
    expect(
      findingsFor(`const verdict = await consumeRateLimit(check); if (verdict === 'limited') log(); ${mail}`),
    ).toEqual(['2 edge-function mail']);
    expect(
      findingsFor(
        `const verdict = await consumeRateLimit(check); if (verdict !== 'allowed') return; ${mail}`,
      ),
    ).toEqual([]);
    expect(
      findingsFor(`if ((await consumeRateLimit(check)) !== 'allowed') throw new Error('x'); ${mail}`),
    ).toEqual([]);
    expect(
      findingsFor(
        `try { const verdict = await consumeRateLimit(check); if (verdict !== 'allowed') { return; } ${mail} } catch { return; }`,
      ),
    ).toEqual([]);
  });

  test('an exported helper is never limited by its callers', () => {
    expect(
      findingsIn(
        [
          "export async function send() { await admin.functions.invoke('mail', {}); }",
          "export async function caller() { if ((await consumeRateLimit(check)) !== 'allowed') return; await send(); }",
        ].join('\n'),
      ),
    ).toEqual(['1 edge-function mail']);
  });
});
