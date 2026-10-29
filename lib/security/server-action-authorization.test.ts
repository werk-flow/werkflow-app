import { expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';

// Tier 1 and 2 guard for SI-025. Every exported function of a 'use server'
// module is a public POST endpoint. It establishes the caller's organization
// context through the one owner module, lib/org/action-context.ts, directly
// or through a named wrapper that this file proves is built on it. An action
// that needs no organization (the caller's own account, a step before any
// membership) is listed with its reason and reaches the session identity. The
// check is called unconditionally and its failure returns or throws before the
// first admin client, rpc or write (see "Order" below). This proves the place
// of the right kind of check, not its correctness; the boundary tests own that.

const repositoryRoot = resolve(import.meta.dir, '../..');

const OWNER_MODULE = 'lib/org/action-context.ts';
// The owner functions. The self-service pair resolves prestart memberships too,
// for an employee acting on their own personnel items, and grants no role there.
const ROOT_OWNERS: Record<string, string> = {
  resolveActionContext: OWNER_MODULE,
  resolveActionContextFor: OWNER_MODULE,
  resolveSelfServiceContext: 'lib/org/self-service-context.ts',
  resolveSelfServiceContextFor: 'lib/org/self-service-context.ts',
};
const CONTEXT_ROOTS = new Set(Object.keys(ROOT_OWNERS));

// Exported guards of other modules. Each one must reach a root (checked below).
const CONTEXT_WRAPPERS: Record<string, string> = {
  authenticateAndAuthorize: 'lib/jobs/auth.ts',
  getAuthorizedDocumentContext: 'lib/documents/access.ts',
  requireServiceManager: 'lib/service-cases/manager-context.ts',
  requireAuth: 'lib/time-accounts/access.ts',
  requireManagerAndClient: 'lib/clients/manager-access.ts',
  requireManagedInvite: 'lib/invites/managed-invite.ts',
  verifyCurrentMembership: 'lib/time-tracking/action-access.ts',
  requirePersonnelManager: 'lib/personnel/record-writes.ts',
  requireManagerRecord: 'lib/personnel/lifecycle-action-context.ts',
  getSelfContext: 'lib/personnel/lifecycle-action-context.ts',
};

const SESSION_IDENTITY = 'getAuthenticatedUser';

const OWN_ACCOUNT = "Changes the caller's own account, which belongs to no organization.";

// Actions that run on the verified session identity alone. Keep each reason true; an entry
// whose action gains an organization check, or disappears, fails as stale.
const IDENTITY_ONLY_ACTIONS: Record<string, string> = {
  'lib/auth/actions.ts#deleteAccount': OWN_ACCOUNT,
  'lib/auth/actions.ts#invalidateProfileCache': OWN_ACCOUNT,
  'lib/auth/actions.ts#rememberPasswordResetAddress': OWN_ACCOUNT,
  'lib/settings/actions.ts#removeProfileAvatar': OWN_ACCOUNT,
  'lib/settings/actions.ts#updateProfileAvatar': OWN_ACCOUNT,
  'lib/settings/actions.ts#updateProfileSettings': OWN_ACCOUNT,
  'lib/settings/email-change-actions.ts#clearEmailChangeChallengeBeforeSignOut': OWN_ACCOUNT,
  'lib/settings/email-change-actions.ts#requestCurrentEmailChangeOtp': OWN_ACCOUNT,
  'lib/settings/email-change-actions.ts#resetEmailChangeWizard': OWN_ACCOUNT,
  'lib/settings/email-change-actions.ts#savePendingNewEmailVerification': OWN_ACCOUNT,
  'lib/settings/email-change-actions.ts#touchPendingNewEmailVerification': OWN_ACCOUNT,
  'lib/settings/email-change-actions.ts#verifyCurrentEmailChangeOtp': OWN_ACCOUNT,
  'lib/settings/email-change-actions.ts#verifyNewEmailChangeOtp': OWN_ACCOUNT,
  'lib/org/actions.ts#createOrganization': 'Runs before the caller has a membership.',
  'lib/org/join-request-actions.ts#requestOrganizationJoin': 'Runs before the caller has a membership.',
  'lib/org/join-request-actions.ts#withdrawOrganizationJoinRequest':
    "Withdraws the caller's own request, which exists before any membership.",
  'lib/subscription/actions.ts#simulatePayment':
    'Activates the subscription before the first organization exists.',
  'lib/members/actions.ts#getProfilesByIds':
    'Names are visible across every organization the caller shares with the person (SI-015).',
  'lib/time-tracking/clock-state-actions.ts#clockOutBeforeSignOut':
    "Ends the caller's own open sessions in every organization at sign-out.",
  'lib/time-tracking/review-actions.ts#getChangeRequestsForEntries':
    "Reads only organizations from the caller's current memberships, with the role in each.",
  'lib/time-corrections/actions.ts#withdrawTimeCorrection':
    "withdraw_time_correction accepts only the request's author and changes only that request.",
};

type Reach = { context: boolean; identity: boolean };

function listApplicationSources(): string[] {
  const found: string[] = [];
  function visit(relative: string): void {
    for (const entry of readdirSync(resolve(repositoryRoot, relative), { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const path = `${relative}/${entry.name}`;
      if (entry.isDirectory()) visit(path);
      else if (/\.[cm]?[jt]sx?$/.test(entry.name) && !/\.test\.[cm]?[jt]sx?$/.test(entry.name)) {
        found.push(path);
      }
    }
  }
  for (const root of ['lib', 'app', 'components', 'hooks']) visit(root);
  return found.sort();
}

function calledIdentifiers(node: ts.Node, collected: Set<string>): void {
  if (ts.isCallExpression(node)) {
    const callee = node.expression;
    if (ts.isIdentifier(callee)) collected.add(callee.text);
    else if (ts.isPropertyAccessExpression(callee)) collected.add(callee.name.text);
  }
  ts.forEachChild(node, (child) => {
    // Defining a nested callback does not execute its identity check.
    if (!ts.isFunctionLike(child)) calledIdentifiers(child, collected);
  });
}

type ExportedAction = { name: string; body: ts.ConciseBody | undefined };

function hasServerDirective(statements: readonly ts.Statement[]): boolean {
  for (const statement of statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression)) return false;
    if (statement.expression.text === 'use server') return true;
  }
  return false;
}

function hasExportModifier(statement: ts.Statement): boolean {
  return (
    !!ts.canHaveModifiers(statement) &&
    !!ts.getModifiers(statement)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
  );
}

// Every export shape that can become a Server Action: function declarations,
// exported arrow or function expressions, and default exports. Re-exports are
// rejected outright because their targets cannot be checked here.
function exportedActions(file: string, source: ts.SourceFile): ExportedAction[] {
  const actions: ExportedAction[] = [];
  if (hasServerDirective(source.statements))
    for (const statement of source.statements) {
      if (ts.isExportDeclaration(statement)) {
        throw new Error(
          `${file} re-exports through 'use server'; move the export next to its authorization check`,
        );
      }
      if (ts.isFunctionDeclaration(statement) && hasExportModifier(statement)) {
        actions.push({ name: statement.name?.text ?? 'default', body: statement.body });
        continue;
      }
      if (ts.isVariableStatement(statement) && hasExportModifier(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          const initializer = declaration.initializer;
          if (initializer && (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer))) {
            actions.push({ name: declaration.name.getText(source), body: initializer.body });
          } else {
            throw new Error(
              `${file} exports an unresolved action alias ${declaration.name.getText(source)}; export the function beside its identity check`,
            );
          }
        }
        continue;
      }
      if (ts.isExportAssignment(statement)) {
        if (!ts.isArrowFunction(statement.expression) && !ts.isFunctionExpression(statement.expression)) {
          throw new Error(
            `${file} exports an unresolved default action alias; export the function beside its identity check`,
          );
        }
        actions.push({ name: 'default', body: statement.expression.body });
      }
    }
  function visitInline(node: ts.Node): void {
    if (
      (ts.isFunctionDeclaration(node) ||
        ts.isFunctionExpression(node) ||
        ts.isArrowFunction(node) ||
        ts.isMethodDeclaration(node)) &&
      node.body &&
      ts.isBlock(node.body) &&
      hasServerDirective(node.body.statements) &&
      !actions.some((action) => action.body === node.body)
    ) {
      actions.push({
        name: `inline:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`,
        body: node.body,
      });
    }
    ts.forEachChild(node, visitInline);
  }
  visitInline(source);
  return actions;
}

/** For each module-local function: whether it reaches an accepted guard or the session identity. */
function localReach(source: ts.SourceFile, guards: ReadonlySet<string>): Map<string, Reach> {
  const callsByLocalFunction = new Map<string, Set<string>>();
  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name && statement.body) {
      const calls = new Set<string>();
      calledIdentifiers(statement.body, calls);
      callsByLocalFunction.set(statement.name.text, calls);
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        const initializer = declaration.initializer;
        if (
          !ts.isIdentifier(declaration.name) ||
          !initializer ||
          !(ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer))
        )
          continue;
        const calls = new Set<string>();
        calledIdentifiers(initializer.body, calls);
        callsByLocalFunction.set(declaration.name.text, calls);
      }
    }
  }
  const reach = new Map<string, Reach>();
  for (const name of callsByLocalFunction.keys()) reach.set(name, { context: false, identity: false });
  let changed = true;
  while (changed) {
    changed = false;
    for (const [name, calls] of callsByLocalFunction) {
      const current = reach.get(name) ?? { context: false, identity: false };
      const next = { ...current };
      for (const call of calls) {
        if (guards.has(call)) next.context = true;
        if (call === SESSION_IDENTITY) next.identity = true;
        const helper = call === name ? undefined : reach.get(call);
        if (helper?.context) next.context = true;
        if (helper?.identity) next.identity = true;
      }
      if (next.context !== current.context || next.identity !== current.identity) {
        reach.set(name, next);
        changed = true;
      }
    }
  }
  return reach;
}

const ACCEPTED_GUARDS = new Set([...CONTEXT_ROOTS, ...Object.keys(CONTEXT_WRAPPERS)]);

function actionReach(source: ts.SourceFile, action: ExportedAction): Reach {
  const local = localReach(source, ACCEPTED_GUARDS);
  const calls = new Set<string>();
  if (action.body) calledIdentifiers(action.body, calls);
  return {
    context: [...calls].some((call) => ACCEPTED_GUARDS.has(call) || local.get(call)?.context === true),
    identity: [...calls].some((call) => call === SESSION_IDENTITY || local.get(call)?.identity === true),
  };
}

// Order (B1 of the 2026-10 review): reaching a guard is not enough. The guard
// runs unconditionally in the action's own statement list, its failure branch
// returns or throws, and both happen before the first privileged call: the
// admin client, a database function, a write, or a module-local helper that
// makes one of these without its own guard.
const ADMIN_CLIENT_FACTORY = 'createSupabaseAdminClient';
const PRIVILEGED_METHODS = new Set(['rpc', 'insert', 'update', 'upsert', 'delete']);
// Next.js navigation helpers throw, so a failure branch that calls one exits.
const EXITING_CALLS = new Set(['redirect', 'notFound', 'forbidden', 'unauthorized']);
// Guards that throw on failure instead of returning it; their result needs no check.
const THROWING_GUARDS = new Set(['requireAuth']);

type GuardSet = { names: ReadonlySet<string>; throwing: ReadonlySet<string> };
/**
 * What a module's actions may call. `identity` holds the session-identity
 * checks: after one of them, an action may create the admin client and read
 * the row whose organization it then resolves with resolveActionContextFor,
 * but makes no rpc or write before that. `adminHelpers` create the admin
 * client or read through it; `writeHelpers` call an rpc or write.
 */
type ModuleGuards = {
  guards: GuardSet;
  identity: ReadonlySet<string>;
  adminHelpers: ReadonlySet<string>;
  writeHelpers: ReadonlySet<string>;
};
type GuardOrder = { problem: string } | { problem: undefined; throws: boolean };
type ExitKind = 'return' | 'throw';
type PrivilegedCall = { label: string; kind: 'admin' | 'write' };

function unwrapExpression(node: ts.Expression): ts.Expression {
  let current = node;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAwaitExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isNonNullExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function calleeName(call: ts.CallExpression): string | undefined {
  const callee = call.expression;
  if (ts.isIdentifier(callee)) return callee.text;
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text;
  return undefined;
}

/**
 * The most privileged call inside `node`, nested callbacks included because
 * they may run before the guard: the first write or rpc, else the first admin
 * client creation or admin helper.
 */
function privilegedCall(
  node: ts.Node,
  module: Pick<ModuleGuards, 'adminHelpers' | 'writeHelpers'>,
): PrivilegedCall | undefined {
  let admin: PrivilegedCall | undefined;
  let write: PrivilegedCall | undefined;
  function visit(current: ts.Node): void {
    if (write) return;
    if (ts.isCallExpression(current)) {
      const callee = current.expression;
      if (ts.isIdentifier(callee) && module.writeHelpers.has(callee.text)) {
        write = { label: `${callee.text}()`, kind: 'write' };
        return;
      }
      if (ts.isPropertyAccessExpression(callee) && PRIVILEGED_METHODS.has(callee.name.text)) {
        write = { label: `.${callee.name.text}()`, kind: 'write' };
        return;
      }
      if (
        !admin &&
        ts.isIdentifier(callee) &&
        (callee.text === ADMIN_CLIENT_FACTORY || module.adminHelpers.has(callee.text))
      ) {
        admin = { label: `${callee.text}()`, kind: 'admin' };
      }
    }
    ts.forEachChild(current, visit);
  }
  visit(node);
  return write ?? admin;
}

/** A guard call statement; `siblings` are the calls that run beside it in a `Promise.all`. */
type GuardCall = {
  name: string;
  binding: string | undefined;
  returned: boolean;
  siblings: readonly ts.Expression[];
};

/** A guard called as the whole statement: `const auth = await guard()`, `await guard()` or `return guard()`. */
function directGuardCall(statement: ts.Statement, guards: ReadonlySet<string>): GuardCall | undefined {
  const guardName = (expression: ts.Expression | undefined): string | undefined => {
    if (!expression) return undefined;
    const node = unwrapExpression(expression);
    if (!ts.isCallExpression(node)) return undefined;
    const name = calleeName(node);
    return name !== undefined && guards.has(name) ? name : undefined;
  };
  if (ts.isReturnStatement(statement) || ts.isExpressionStatement(statement)) {
    const name = guardName(statement.expression);
    if (!name) return undefined;
    return { name, binding: undefined, returned: ts.isReturnStatement(statement), siblings: [] };
  }
  if (!ts.isVariableStatement(statement)) return undefined;
  const [declaration, ...others] = statement.declarationList.declarations;
  if (!declaration?.initializer || others.length > 0) return undefined;
  const name = guardName(declaration.initializer);
  if (name) {
    const binding = ts.isIdentifier(declaration.name) ? declaration.name.text : undefined;
    return { name, binding, returned: false, siblings: [] };
  }
  return parallelGuardCall(declaration.name, declaration.initializer, guardName);
}

/** `const [auth, rows] = await Promise.all([guard(), read()])`: the guard and the calls beside it. */
function parallelGuardCall(
  target: ts.BindingName,
  initializer: ts.Expression,
  guardName: (expression: ts.Expression | undefined) => string | undefined,
): GuardCall | undefined {
  const call = unwrapExpression(initializer);
  if (
    !ts.isArrayBindingPattern(target) ||
    !ts.isCallExpression(call) ||
    call.expression.getText() !== 'Promise.all'
  )
    return undefined;
  const [list] = call.arguments;
  if (!list || !ts.isArrayLiteralExpression(list)) return undefined;
  const index = list.elements.findIndex((element) => guardName(element) !== undefined);
  const name = guardName(list.elements[index]);
  if (!name) return undefined;
  const element = target.elements[index];
  const binding =
    element && ts.isBindingElement(element) && ts.isIdentifier(element.name) ? element.name.text : undefined;
  return { name, binding, returned: false, siblings: list.elements.filter((_, other) => other !== index) };
}

function exitKind(statement: ts.Statement): ExitKind | undefined {
  if (ts.isReturnStatement(statement)) return 'return';
  if (ts.isThrowStatement(statement)) return 'throw';
  if (ts.isBlock(statement)) {
    for (const inner of statement.statements) {
      const kind = exitKind(inner);
      if (kind) return kind;
    }
    return undefined;
  }
  if (!ts.isExpressionStatement(statement)) return undefined;
  const call = unwrapExpression(statement.expression);
  if (!ts.isCallExpression(call) || !ts.isIdentifier(call.expression)) return undefined;
  return EXITING_CALLS.has(call.expression.text) ? 'throw' : undefined;
}

function isBinding(node: ts.Expression, binding: string): boolean {
  const inner = unwrapExpression(node);
  return ts.isIdentifier(inner) && inner.text === binding;
}

/** `!auth.success`, `!user`, `'success' in context`, `auth.success === false`, or an `||` that holds one. */
function testsFailure(condition: ts.Expression, binding: string): boolean {
  const node = unwrapExpression(condition);
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.ExclamationToken) {
    const operand = unwrapExpression(node.operand);
    return (
      isBinding(operand, binding) ||
      (ts.isPropertyAccessExpression(operand) &&
        isBinding(operand.expression, binding) &&
        operand.name.text === 'success')
    );
  }
  if (!ts.isBinaryExpression(node)) return false;
  const operator = node.operatorToken.kind;
  if (operator === ts.SyntaxKind.BarBarToken) {
    return testsFailure(node.left, binding) || testsFailure(node.right, binding);
  }
  if (operator === ts.SyntaxKind.InKeyword) {
    return (
      isBinding(node.right, binding) &&
      ts.isStringLiteral(node.left) &&
      (node.left.text === 'success' || node.left.text === 'error')
    );
  }
  if (operator === ts.SyntaxKind.EqualsEqualsEqualsToken) {
    return (
      ts.isPropertyAccessExpression(node.left) &&
      isBinding(node.left.expression, binding) &&
      node.left.name.text === 'success' &&
      node.right.kind === ts.SyntaxKind.FalseKeyword
    );
  }
  return false;
}

/** How a statement leaves on the guard's failure, when it is `if (<failure of binding>) <exit>`. */
function failureCheck(statement: ts.Statement, binding: string): ExitKind | undefined {
  if (!ts.isIfStatement(statement) || !testsFailure(statement.expression, binding)) return undefined;
  return exitKind(statement.thenStatement);
}

function callsGuard(node: ts.Node, guards: GuardSet): string | undefined {
  const calls = new Set<string>();
  calledIdentifiers(node, calls);
  return [...calls].find((call) => guards.names.has(call));
}

/** Whether the body runs a guard unconditionally and checks it before its first privileged call. */
function guardOrder(body: ts.ConciseBody, module: ModuleGuards): GuardOrder {
  if (!ts.isBlock(body)) {
    const node = unwrapExpression(body);
    const name = ts.isCallExpression(node) ? calleeName(node) : undefined;
    if (name !== undefined && module.guards.names.has(name)) {
      return { problem: undefined, throws: module.guards.throwing.has(name) };
    }
    return { problem: privilegedCall(body, module)?.label ?? 'calls no guard' };
  }
  const walked = walkStatements(body.statements, { kind: 'open', identified: false }, module);
  if (walked.problem !== undefined) return walked;
  const { state } = walked;
  if (state.kind === 'done') return { problem: undefined, throws: state.throws };
  return {
    problem: state.kind === 'pending' ? `ignores the result of ${state.guard.name}` : 'calls no guard',
  };
}

type OrderState =
  | { kind: 'open'; identified: boolean }
  | { kind: 'pending'; guard: GuardCall; identity: boolean }
  | { kind: 'done'; throws: boolean };

type Walked = { problem: string } | { problem: undefined; state: OrderState };

/** Whether `node` reads the identifier `binding` anywhere. */
function mentions(node: ts.Node, binding: string): boolean {
  if (ts.isIdentifier(node) && node.text === binding) return true;
  return ts.forEachChild(node, (child) => mentions(child, binding) || undefined) === true;
}

/** The state after `statement` while a guard's result waits for its failure check. */
function afterPending(
  statement: ts.Statement,
  state: Extract<OrderState, { kind: 'pending' }>,
  module: ModuleGuards,
): Walked {
  const { guard, identity } = state;
  const settled: OrderState = identity ? { kind: 'open', identified: true } : { kind: 'done', throws: false };
  const exit = guard.binding === undefined ? undefined : failureCheck(statement, guard.binding);
  if (exit)
    return { problem: undefined, state: identity ? settled : { kind: 'done', throws: exit === 'throw' } };
  // Returning the result hands the check to the caller, which treats this
  // function as a guard in turn.
  if (ts.isReturnStatement(statement) && guard.binding !== undefined && mentions(statement, guard.binding)) {
    return { problem: undefined, state: settled };
  }
  const operation = privilegedCall(statement, module);
  if (operation) return { problem: `${operation.label} before checking the result of ${guard.name}` };
  return { problem: undefined, state };
}

/**
 * Walks one statement list in order. A `try` block continues the list; its
 * catch and finally blocks may run before the guard, so they make no
 * privileged call while the guard is open, and a catch that falls through
 * leaves the guard open after the statement.
 */
function walkStatements(
  statements: readonly ts.Statement[],
  start: OrderState,
  module: ModuleGuards,
): Walked {
  let state = start;
  for (const statement of statements) {
    if (state.kind === 'done') break;
    if (ts.isTryStatement(statement)) {
      const inner = walkStatements(statement.tryBlock.statements, state, module);
      if (inner.problem !== undefined) return inner;
      for (const handler of [statement.catchClause?.block, statement.finallyBlock]) {
        const operation = handler && privilegedCall(handler, module);
        if (operation) return { problem: `${operation.label} in a catch or finally block before the guard` };
      }
      const catchExits = !statement.catchClause || exitKind(statement.catchClause.block) !== undefined;
      if (catchExits) state = inner.state;
      continue;
    }
    // A second guard after a pending one replaces it: `if (manager.success)
    // return …; const self = await guard();` falls back to another check.
    if (state.kind === 'pending' && directGuardCall(statement, module.guards.names)) {
      state = { kind: 'open', identified: false };
    }
    if (state.kind === 'pending') {
      const next = afterPending(statement, state, module);
      if (next.problem !== undefined) return next;
      state = next.state;
      continue;
    }
    const guard = directGuardCall(statement, module.guards.names);
    const identityGuard =
      !guard && !state.identified ? directGuardCall(statement, module.identity) : undefined;
    const called = guard ?? identityGuard;
    if (called) {
      // Calls beside the guard in a Promise.all run before its check.
      for (const sibling of called.siblings) {
        const operation = privilegedCall(sibling, module);
        if (operation && !(operation.kind === 'admin' && state.identified)) {
          return { problem: `${operation.label} beside ${called.name} before its check` };
        }
      }
      const throwing = module.guards.throwing.has(called.name);
      if (guard && (guard.returned || throwing)) {
        state = { kind: 'done', throws: throwing };
        continue;
      }
      if (called.binding === undefined) return { problem: `ignores the result of ${called.name}` };
      state = { kind: 'pending', guard: called, identity: called === identityGuard };
      continue;
    }
    const operation = privilegedCall(statement, module);
    if (operation && !(operation.kind === 'admin' && state.identified)) {
      return { problem: `${operation.label} before the guard` };
    }
    const nested = callsGuard(statement, module.guards);
    if (nested) return { problem: `calls ${nested} conditionally or nested in an expression` };
  }
  return { problem: undefined, state };
}

type LocalFunction = { name: string; body: ts.ConciseBody };

function localFunctions(source: ts.SourceFile): LocalFunction[] {
  const functions: LocalFunction[] = [];
  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name && statement.body) {
      functions.push({ name: statement.name.text, body: statement.body });
    }
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      const initializer = declaration.initializer;
      if (
        ts.isIdentifier(declaration.name) &&
        initializer &&
        (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer))
      ) {
        functions.push({ name: declaration.name.text, body: initializer.body });
      }
    }
  }
  return functions;
}

/**
 * The module's guards: the accepted roots and wrappers plus every local helper
 * that itself passes the order rule, and the local helpers that make a
 * privileged call without one. Iterates to a fixed point over helper calls.
 */
function moduleGuards(
  source: ts.SourceFile,
  roots: ReadonlySet<string>,
  identity: ReadonlySet<string>,
): ModuleGuards {
  const functions = localFunctions(source);
  const rootThrowing = [...THROWING_GUARDS].filter((name) => roots.has(name));
  let current: ModuleGuards = {
    guards: { names: new Set(roots), throwing: new Set(rootThrowing) },
    identity,
    adminHelpers: new Set(),
    writeHelpers: new Set(),
  };
  const signature = (module: ModuleGuards): string =>
    [module.guards.names, module.guards.throwing, module.adminHelpers, module.writeHelpers]
      .map((names) => [...names].sort().join(','))
      .join('|');
  for (let round = 0; round <= functions.length; round += 1) {
    const names = new Set(roots);
    const throwing = new Set(rootThrowing);
    const adminHelpers = new Set<string>();
    const writeHelpers = new Set<string>();
    for (const { name, body } of functions) {
      const order = guardOrder(body, current);
      if (order.problem === undefined) {
        names.add(name);
        if (order.throws) throwing.add(name);
        continue;
      }
      const operation = privilegedCall(body, current);
      if (operation?.kind === 'write') writeHelpers.add(name);
      else if (operation) adminHelpers.add(name);
    }
    const next: ModuleGuards = { guards: { names, throwing }, identity, adminHelpers, writeHelpers };
    const stable = signature(next) === signature(current);
    current = next;
    if (stable) break;
  }
  return current;
}

function unguardedActions(
  file: string,
  source: ts.SourceFile,
  actions = exportedActions(file, source),
): string[] {
  const unguarded: string[] = [];
  // In identity-only mode the session identity is itself the guard; its
  // local helpers then serve as the identity checks of the context mode.
  const identityGuards = moduleGuards(source, new Set([...ACCEPTED_GUARDS, SESSION_IDENTITY]), new Set());
  const contextGuards = moduleGuards(source, ACCEPTED_GUARDS, identityGuards.guards.names);
  for (const action of actions) {
    const key = `${file}#${action.name}`;
    const guards = key in IDENTITY_ONLY_ACTIONS ? identityGuards : contextGuards;
    const order = action.body ? guardOrder(action.body, guards) : { problem: 'has no body' };
    if (order.problem === undefined) continue;
    unguarded.push(`${key}: ${order.problem}`);
  }
  return unguarded;
}

test('module and inline Server Actions establish organization context or are reviewed identity-only actions', () => {
  const unguarded: string[] = [];
  const existing = new Set<string>();
  const contextGuarded = new Set<string>();
  for (const file of listApplicationSources()) {
    const text = readFileSync(resolve(repositoryRoot, file), 'utf8');
    // Most files contain no directive. Keep escaped spellings eligible for AST
    // inspection without parsing huge generated types on every unit run.
    if (!couldContainServerDirective(text)) continue;
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const actions = exportedActions(file, source);
    for (const action of actions) {
      existing.add(`${file}#${action.name}`);
      if (actionReach(source, action).context) contextGuarded.add(`${file}#${action.name}`);
    }
    unguarded.push(...unguardedActions(file, source, actions));
  }
  expect(
    unguarded,
    'call resolveActionContext or resolveActionContextFor (lib/org/action-context.ts) or a named wrapper unconditionally, and return or throw on its failure before the first admin client, rpc or write',
  ).toEqual([]);
  expect(
    Object.keys(IDENTITY_ONLY_ACTIONS).filter((key) => !existing.has(key) || contextGuarded.has(key)),
    'stale identity-only entries: the action is gone or now has an organization check',
  ).toEqual([]);
});

test('every named wrapper is built on the owner module', () => {
  const unbuilt: string[] = [];
  for (const [name, file] of Object.entries(CONTEXT_WRAPPERS)) {
    const text = readFileSync(resolve(repositoryRoot, file), 'utf8');
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const others = new Set([
      ...CONTEXT_ROOTS,
      ...Object.keys(CONTEXT_WRAPPERS).filter((other) => other !== name),
    ]);
    if (localReach(source, others).get(name)?.context !== true) unbuilt.push(`${file}#${name}`);
    // A wrapper keeps the order rule itself: the admin client only after its own check.
    const wrapper = localFunctions(source).find((local) => local.name === name);
    const order = wrapper && guardOrder(wrapper.body, moduleGuards(source, others, new Set()));
    if (order?.problem !== undefined) unbuilt.push(`${file}#${name}: ${order.problem}`);
  }
  expect(unbuilt, `a wrapper must call a root of ${OWNER_MODULE} or another wrapper`).toEqual([]);
  for (const [root, file] of Object.entries(ROOT_OWNERS)) {
    expect(readFileSync(resolve(repositoryRoot, file), 'utf8')).toContain(`export async function ${root}(`);
  }
});

function couldContainServerDirective(text: string): boolean {
  return text.includes('use server') || text.includes('\\');
}

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

// Step 3 (2026-09-13) found 27 exported Server Actions with no caller in the
// application: each one was a reachable public POST endpoint that no page,
// component or hook used. An action must be imported by product code or not
// exist; test-only use does not keep a public endpoint alive.
function normalizeModulePath(fromFile: string, specifier: string): string | null {
  let target: string;
  if (specifier.startsWith('@/')) target = specifier.slice(2);
  else if (specifier.startsWith('.')) {
    const parts = fromFile.split('/');
    parts.pop();
    for (const segment of specifier.split('/')) {
      if (segment === '.') continue;
      if (segment === '..') parts.pop();
      else parts.push(segment);
    }
    target = parts.join('/');
  } else return null;
  return target.replace(/\.[cm]?[jt]sx?$/, '');
}

function importedNamesByModule(): Map<string, Set<string>> {
  const imported = new Map<string, Set<string>>();
  const record = (modulePath: string, name: string): void => {
    const names = imported.get(modulePath) ?? new Set<string>();
    names.add(name);
    imported.set(modulePath, names);
  };
  // A text scan keeps this under the unit timeout: import and re-export statements in
  // this repository are plain `import ... from '...'` / `export { ... } from '...'` forms.
  const statement = /^(import|export)\s+(type\s+)?([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/gm;
  for (const file of listApplicationSources()) {
    const text = readFileSync(resolve(repositoryRoot, file), 'utf8');
    for (const match of text.matchAll(statement)) {
      const [, , typeOnly, clause, specifier] = match;
      if (typeOnly || clause === undefined || specifier === undefined) continue;
      const modulePath = normalizeModulePath(file, specifier);
      if (!modulePath) continue;
      const bindings = clause.trim();
      if (bindings.startsWith('*')) {
        record(modulePath, '*');
        continue;
      }
      const braces = /\{([^}]*)\}/.exec(bindings);
      const defaultImport = bindings
        .replace(/\{[^}]*\}/, '')
        .replace(/,/g, '')
        .trim();
      if (defaultImport && !defaultImport.startsWith('type')) record(modulePath, 'default');
      for (const entry of braces?.[1]?.split(',') ?? []) {
        // split() always yields a first element; the fallback only satisfies the index type.
        const name = (
          entry
            .trim()
            .replace(/^type\s+/, '')
            .split(/\s+as\s+/)[0] ?? ''
        ).trim();
        if (name) record(modulePath, name);
      }
    }
  }
  return imported;
}

test('every exported Server Action is imported by product code', () => {
  const imported = importedNamesByModule();
  const dead: string[] = [];
  for (const file of listApplicationSources()) {
    const text = readFileSync(resolve(repositoryRoot, file), 'utf8');
    if (!couldContainServerDirective(text)) continue;
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    if (!hasServerDirective(source.statements)) continue;
    const modulePath = file.replace(/\.[cm]?[jt]sx?$/, '');
    const names = imported.get(modulePath) ?? new Set<string>();
    for (const action of exportedActions(file, source)) {
      if (action.name.startsWith('inline:')) continue;
      if (names.has('*') || names.has(action.name)) continue;
      dead.push(`${file}#${action.name}`);
    }
  }
  expect(
    dead,
    'exported Server Actions with no product caller (delete them or wire them: an unused export is still a public POST endpoint)',
  ).toEqual([]);
});
