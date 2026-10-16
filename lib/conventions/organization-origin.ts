import ts from 'typescript';

// Where an organization value comes from, traced inside its source file
// (lib/conventions/tenant-scope.test.ts). A value is trusted when it derives
// from a resolved caller context, from the same binding that a verifier
// received as its first argument earlier in the same or an enclosing
// function, or from a read scoped to a trusted organization or to a trusted
// user id. A parameter of a Server Action is the client's raw value. A
// parameter of a module-local, unexported function takes the origin of what
// every call in the file passes. A parameter of an exported or callback
// function is its caller's value; the scan cannot follow it across files and
// reports it as `parameter`.

/** The resolvers whose result, or whose first argument, names a verified organization. */
const CONTEXT_RESOLVERS = new Set([
  'resolveActionContext',
  'resolveActionContextFor',
  'resolveSelfServiceContext',
  'resolveSelfServiceContextFor',
  'authenticateAndAuthorize',
  'getAuthorizedDocumentContext',
  'requireServiceManager',
  'requireAuth',
  'requireManagerAndClient',
  'requireManagedInvite',
  // lib/org/cookies.ts: the cookie's organization only when the user is a current member.
  'resolveActiveOrgId',
  // lib/org/page-context.ts: the same membership choice, with its role, for a page.
  'resolvePageMembership',
  // lib/time-tracking/action-access.ts: the time actions' shared steps over
  // resolveActionContextFor and resolveActiveOrgId.
  'verifyCurrentMembership',
  'getCurrentOrgId',
]);

/** The resolvers that verify their first argument as an organization the caller belongs to. */
const ORGANIZATION_VERIFIERS = new Set([
  'resolveActionContextFor',
  'resolveSelfServiceContextFor',
  // lib/time-tracking/action-access.ts: answers the role only for a current member.
  'verifyCurrentMembership',
]);

/** Calls whose result is the signed-in user, so its id is a trusted `user_id` filter. */
const USER_RESOLVERS = ['getAuthenticatedUser'];

/**
 * Reads whose rows count as loaded inside a verified scope: a database
 * function receives its organization argument under this same check, the
 * batch readers take their scope from a callback the scan does not follow,
 * and the membership readers return the caller's own memberships.
 */
const ROW_READS = new Set([
  'rpc',
  'readInBatches',
  'readAllRows',
  'readCompleteRows',
  'getCachedMemberships',
  'getCachedPrestartMemberships',
]);

const ORIGIN_PRESERVING_METHODS = new Set(['map', 'flatMap', 'filter', 'slice', 'concat', 'keys', 'values']);
const PARSE_METHODS = new Set(['safeParse', 'parse']);
const MAXIMUM_DEPTH = 24;

export type Origin =
  | { kind: 'trusted' }
  | { kind: 'action-parameter'; name: string }
  | { kind: 'parameter'; name: string }
  | { kind: 'unknown'; text: string };

/**
 * `resolvers` return a verified context; `verifiers` verify their first
 * argument (ORGANIZATION_VERIFIERS plus the module helpers that pass their
 * own first parameter to one).
 */
export type OriginScope = {
  actions: ReadonlySet<ts.Node>;
  resolvers: ReadonlySet<string>;
  verifiers: ReadonlySet<string>;
};

type FunctionNode = ts.SignatureDeclaration & { body?: ts.Node | undefined };

/** Where a name gets its value, and the property path from there: `const { orgId } = auth.context` reads `orgId`. */
type Declaration =
  | { kind: 'parameter'; owner: FunctionNode; index: number; path: string[] }
  | { kind: 'variable'; source: ts.Expression | undefined; path: string[] };

function enclosingFunctions(node: ts.Node): FunctionNode[] {
  const functions: FunctionNode[] = [];
  for (let current = node.parent; current; current = current.parent) {
    if (ts.isFunctionLike(current)) functions.push(current);
  }
  return functions;
}

/** The property path a binding pattern reads to reach `text`, or undefined when it does not bind it. */
function bindingPath(name: ts.BindingName, text: string): string[] | undefined {
  if (ts.isIdentifier(name)) return name.text === text ? [] : undefined;
  for (const element of name.elements) {
    if (ts.isOmittedExpression(element)) continue;
    const inner = bindingPath(element.name, text);
    if (!inner) continue;
    if (ts.isArrayBindingPattern(name)) return inner;
    const property = element.propertyName ?? element.name;
    return ts.isIdentifier(property) || ts.isStringLiteralLike(property) ? [property.text, ...inner] : inner;
  }
  return undefined;
}

/** The variable declaration of `text` in `scope`, nested functions excluded. */
function variableDeclaration(scope: ts.Node, text: string): ts.VariableDeclaration | undefined {
  let found: ts.VariableDeclaration | undefined;
  ts.forEachChild(scope, function visit(node) {
    if (found || ts.isFunctionLike(node)) return;
    if (ts.isVariableDeclaration(node) && bindingPath(node.name, text)) {
      found = node;
      return;
    }
    ts.forEachChild(node, visit);
  });
  return found;
}

/**
 * The source of a declared name: the initializer, the matching element of
 * `const [a, b] = await Promise.all([x, y])`, or the iterated collection of
 * `for (const row of rows)`.
 */
function variableSource(declaration: ts.VariableDeclaration, text: string): Declaration {
  const path = bindingPath(declaration.name, text) ?? [];
  const statement = declaration.parent.parent;
  if (ts.isForOfStatement(statement)) return { kind: 'variable', source: statement.expression, path };
  const initializer = declaration.initializer;
  if (!initializer || !ts.isArrayBindingPattern(declaration.name)) {
    return { kind: 'variable', source: initializer, path };
  }
  const call = unwrapValue(initializer);
  const list =
    ts.isCallExpression(call) && call.expression.getText() === 'Promise.all' ? call.arguments[0] : undefined;
  const index = declaration.name.elements.findIndex(
    (element) => !ts.isOmittedExpression(element) && bindingPath(element.name, text),
  );
  const element = list && ts.isArrayLiteralExpression(list) ? list.elements[index] : undefined;
  return { kind: 'variable', source: element ?? initializer, path };
}

function findDeclaration(identifier: ts.Identifier): Declaration | undefined {
  for (const owner of enclosingFunctions(identifier)) {
    const index = owner.parameters.findIndex((parameter) => bindingPath(parameter.name, identifier.text));
    const parameter = owner.parameters[index];
    if (parameter) {
      return { kind: 'parameter', owner, index, path: bindingPath(parameter.name, identifier.text) ?? [] };
    }
    const declaration = owner.body && variableDeclaration(owner.body, identifier.text);
    if (declaration) return variableSource(declaration, identifier.text);
  }
  const moduleDeclaration = variableDeclaration(identifier.getSourceFile(), identifier.text);
  return moduleDeclaration ? variableSource(moduleDeclaration, identifier.text) : undefined;
}

function calleeName(call: ts.CallExpression): string | undefined {
  const callee = call.expression;
  if (ts.isIdentifier(callee)) return callee.text;
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text;
  return undefined;
}

const checkers = new WeakMap<ts.SourceFile, ts.TypeChecker>();

/** A checker over this one file: enough to bind every local name to its declaration. */
function checkerFor(source: ts.SourceFile): ts.TypeChecker {
  const cached = checkers.get(source);
  if (cached) return cached;
  const host: ts.CompilerHost = {
    getSourceFile: (fileName) => (fileName === source.fileName ? source : undefined),
    getDefaultLibFileName: () => 'lib.d.ts',
    writeFile: () => undefined,
    getCurrentDirectory: () => '',
    getCanonicalFileName: (fileName) => fileName,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => '\n',
    fileExists: (fileName) => fileName === source.fileName,
    readFile: () => undefined,
  };
  const options: ts.CompilerOptions = { noLib: true, noResolve: true, types: [] };
  const checker = ts.createProgram({ rootNames: [source.fileName], options, host }).getTypeChecker();
  checkers.set(source, checker);
  return checker;
}

/** A binding and the property path read from it: `parsed.data.organizationId`. */
type Reference = { symbol: ts.Symbol; path: string[] };

function referenceOf(node: ts.Expression, checker: ts.TypeChecker): Reference | undefined {
  const value = unwrapValue(node);
  if (ts.isPropertyAccessExpression(value)) {
    const base = referenceOf(value.expression, checker);
    return base && { symbol: base.symbol, path: [...base.path, value.name.text] };
  }
  if (!ts.isIdentifier(value)) return undefined;
  const parent = value.parent;
  const symbol =
    parent && ts.isShorthandPropertyAssignment(parent) && parent.name === value
      ? checker.getShorthandAssignmentValueSymbol(parent)
      : checker.getSymbolAtLocation(value);
  return symbol && { symbol, path: [] };
}

function sameReference(first: Reference | undefined, second: Reference): boolean {
  return (
    first !== undefined &&
    first.symbol === second.symbol &&
    first.path.length === second.path.length &&
    first.path.every((part, index) => part === second.path[index])
  );
}

/** Calls in `owner` itself, nested functions excluded, that start before `position`. */
function callsBefore(owner: ts.Node, position: number): ts.CallExpression[] {
  const calls: ts.CallExpression[] = [];
  ts.forEachChild(owner, function visit(node) {
    if (ts.isFunctionLike(node) || node.getStart() >= position) return;
    if (ts.isCallExpression(node)) calls.push(node);
    ts.forEachChild(node, visit);
  });
  return calls;
}

/**
 * Whether the binding `value` reads was the first argument of a verifier that
 * starts before this use, in one of its enclosing functions:
 * `resolveActionContextFor(organizationId)` verifies `organizationId` there,
 * and the order rule of lib/security/server-action-authorization.test.ts
 * checks that call's result first. A shadowing or rebound name is a
 * different symbol and does not count.
 */
function wasResolved(value: ts.Expression, verifiers: ReadonlySet<string>): boolean {
  const checker = checkerFor(value.getSourceFile());
  const reference = referenceOf(value, checker);
  if (!reference) return false;
  const position = value.getStart();
  return enclosingFunctions(value).some((owner) =>
    callsBefore(owner, position).some((call) => {
      const [argument] = call.arguments;
      return (
        call.getEnd() <= position &&
        ts.isIdentifier(call.expression) &&
        verifiers.has(call.expression.text) &&
        argument !== undefined &&
        sameReference(referenceOf(argument, checker), reference)
      );
    }),
  );
}

function unwrapValue(node: ts.Expression): ts.Expression {
  let current = node;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isAwaitExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isSpreadElement(current)
  ) {
    current = current.expression;
  }
  return current;
}

/** The weaker of two origins: trusted only when both are. */
function both(first: Origin, second: Origin): Origin {
  return first.kind === 'trusted' ? second : first;
}

/** The origin of an organization value. */
export function organizationOrigin(value: ts.Expression, scope: OriginScope): Origin {
  return pathOrigin(value, [], scope, 0);
}

/** The origin of reading `path` from `value`: `pathOrigin(input, ['context', 'orgId'])` for `input.context.orgId`. */
function pathOrigin(
  value: ts.Expression,
  path: readonly string[],
  scope: OriginScope,
  depth: number,
): Origin {
  const node = unwrapValue(value);
  if (depth > MAXIMUM_DEPTH) return { kind: 'unknown', text: node.getText() };
  if (path.length === 0 && wasResolved(node, scope.verifiers)) return { kind: 'trusted' };
  const next = (expression: ts.Expression, nextPath: readonly string[] = path): Origin =>
    pathOrigin(expression, nextPath, scope, depth + 1);
  if (ts.isIdentifier(node)) return identifierOrigin(node, path, scope, depth);
  if (ts.isPropertyAccessExpression(node)) {
    if (wasResolved(node, scope.verifiers)) return { kind: 'trusted' };
    return next(node.expression, [node.name.text, ...path]);
  }
  if (ts.isElementAccessExpression(node)) return next(node.expression);
  if (ts.isObjectLiteralExpression(node)) return objectOrigin(node, path, scope, depth);
  if (ts.isConditionalExpression(node)) return both(next(node.whenTrue), next(node.whenFalse));
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) {
    return both(next(node.left), next(node.right));
  }
  if (ts.isArrayLiteralExpression(node)) {
    return node.elements.reduce<Origin>((origin, element) => both(origin, next(element)), {
      kind: 'trusted',
    });
  }
  if (ts.isNewExpression(node) && node.arguments?.[0]) return next(node.arguments[0]);
  if (ts.isCallExpression(node)) {
    const name = calleeName(node);
    if (name !== undefined && scope.resolvers.has(name)) return { kind: 'trusted' };
    return localReturnOrigin(node, path, scope, depth) ?? callOrigin(node, scope, depth);
  }
  return { kind: 'unknown', text: node.getText() };
}

/** The body of the module-level function a call names, when the file declares it. */
function localFunctionBody(call: ts.CallExpression): ts.ConciseBody | undefined {
  if (!ts.isIdentifier(call.expression)) return undefined;
  const name = call.expression.text;
  for (const statement of call.getSourceFile().statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name?.text === name) return statement.body;
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      const initializer = declaration.initializer;
      if (
        ts.isIdentifier(declaration.name) &&
        declaration.name.text === name &&
        initializer &&
        (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer))
      )
        return initializer.body;
    }
  }
  return undefined;
}

/**
 * `(await loadWorkspace(...)).organizationId`: the origin of that member in
 * every value the module-local function returns. A returned object without
 * the member is a failure shape and is skipped.
 */
function localReturnOrigin(
  call: ts.CallExpression,
  path: readonly string[],
  scope: OriginScope,
  depth: number,
): Origin | undefined {
  const [member] = path;
  const body = member === undefined ? undefined : localFunctionBody(call);
  if (!body) return undefined;
  const returned: ts.Expression[] = [];
  if (ts.isBlock(body)) {
    ts.forEachChild(body, function visit(node) {
      if (ts.isFunctionLike(node)) return;
      if (ts.isReturnStatement(node) && node.expression) returned.push(node.expression);
      ts.forEachChild(node, visit);
    });
  } else returned.push(body);
  const carrying = returned.filter((expression) => {
    const value = unwrapValue(expression);
    return (
      !ts.isObjectLiteralExpression(value) ||
      value.properties.some(
        (property) =>
          ts.isSpreadAssignment(property) ||
          ((ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) &&
            ts.isIdentifier(property.name) &&
            property.name.text === member),
      )
    );
  });
  if (carrying.length === 0) return undefined;
  return carrying.reduce<Origin>(
    (origin, expression) => both(origin, pathOrigin(expression, path, scope, depth + 1)),
    { kind: 'trusted' },
  );
}

function identifierOrigin(
  node: ts.Identifier,
  path: readonly string[],
  scope: OriginScope,
  depth: number,
): Origin {
  const declaration = findDeclaration(node);
  if (!declaration) return { kind: 'unknown', text: node.text };
  if (declaration.kind === 'variable') {
    if (!declaration.source) return { kind: 'unknown', text: node.text };
    return pathOrigin(declaration.source, [...declaration.path, ...path], scope, depth + 1);
  }
  if (scope.actions.has(declaration.owner)) return { kind: 'action-parameter', name: node.text };
  return callSiteOrigin(declaration.owner, declaration.index, node.text, (argument) =>
    pathOrigin(argument, [...declaration.path, ...path], scope, depth + 1),
  );
}

/** The origin of `path` read from an object literal; a later property or spread wins over an earlier one. */
function objectOrigin(
  node: ts.ObjectLiteralExpression,
  path: readonly string[],
  scope: OriginScope,
  depth: number,
): Origin {
  const [member, ...rest] = path;
  if (member === undefined) return { kind: 'unknown', text: 'an object literal' };
  for (const property of [...node.properties].reverse()) {
    if (ts.isShorthandPropertyAssignment(property) && property.name.text === member) {
      return pathOrigin(property.name, rest, scope, depth + 1);
    }
    if (
      ts.isPropertyAssignment(property) &&
      (ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name)) &&
      property.name.text === member
    ) {
      return pathOrigin(property.initializer, rest, scope, depth + 1);
    }
    if (ts.isSpreadAssignment(property)) return pathOrigin(property.expression, path, scope, depth + 1);
  }
  return { kind: 'unknown', text: `${member} of an object literal` };
}

/** The name of a module-level function that is not exported, so every caller is in this file. */
function localFunctionName(owner: FunctionNode): string | undefined {
  const declaration = ts.isFunctionDeclaration(owner) ? owner : owner.parent;
  const statement = ts.isFunctionDeclaration(declaration) ? declaration : declaration.parent?.parent;
  if (!statement || statement.parent !== owner.getSourceFile() || !ts.canHaveModifiers(statement))
    return undefined;
  if (ts.getModifiers(statement)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword))
    return undefined;
  if (ts.isFunctionDeclaration(declaration)) return declaration.name?.text;
  return ts.isVariableDeclaration(declaration) && ts.isIdentifier(declaration.name)
    ? declaration.name.text
    : undefined;
}

/**
 * The origin of a parameter of a module-local, unexported function: every
 * direct call in the file must pass a trusted value. A function that is
 * exported, only passed as a callback, or never called stays `parameter`.
 */
function callSiteOrigin(
  owner: FunctionNode,
  index: number,
  name: string,
  originOf: (argument: ts.Expression) => Origin,
): Origin {
  const functionName = localFunctionName(owner);
  if (!functionName) return { kind: 'parameter', name };
  const calls: ts.CallExpression[] = [];
  ts.forEachChild(owner.getSourceFile(), function visit(node) {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === functionName
    ) {
      calls.push(node);
    }
    ts.forEachChild(node, visit);
  });
  if (calls.length === 0) return { kind: 'parameter', name };
  return calls.reduce<Origin>(
    (origin, call) => {
      if (origin.kind !== 'trusted') return origin;
      const argument = call.arguments[index];
      return argument
        ? originOf(argument)
        : { kind: 'unknown', text: `${functionName}(…) passes no ${name}` };
    },
    { kind: 'trusted' },
  );
}

/** The `.from(...)` call a query chain starts with, when `call` ends one. */
function chainStart(call: ts.CallExpression): ts.CallExpression | undefined {
  for (let current: ts.Expression = call; ts.isCallExpression(current); ) {
    const callee = current.expression;
    if (!ts.isPropertyAccessExpression(callee)) return undefined;
    if (callee.name.text === 'from') return current;
    current = callee.expression;
  }
  return undefined;
}

/** The value of the first `.eq|.in(column, value)` in the chain that `start` begins. */
function chainFilterValue(start: ts.CallExpression, column: string): ts.Expression | undefined {
  for (let current: ts.Expression = start; ; ) {
    const access = current.parent;
    if (!access || !ts.isPropertyAccessExpression(access) || access.expression !== current) return undefined;
    const call = access.parent;
    if (!call || !ts.isCallExpression(call) || call.expression !== access) return undefined;
    const [first, second] = call.arguments;
    const filters = access.name.text === 'eq' || access.name.text === 'in';
    if (filters && first && ts.isStringLiteralLike(first) && first.text === column) return second;
    current = call;
  }
}

/**
 * The origin of a row's organization: a read filtered by a trusted
 * organization, or by a trusted user id, returns rows of that scope. A user id
 * is trusted when it derives from a resolved context or from
 * `getAuthenticatedUser()`; no verifier argument vouches for a user id. An
 * unscoped read by id returns whatever organization the id names, which
 * counts only after a verifier received it (see `wasResolved`).
 */
function readOrigin(start: ts.CallExpression, scope: OriginScope, depth: number): Origin {
  const organization = chainFilterValue(start, 'organization_id');
  if (organization) return pathOrigin(organization, [], scope, depth + 1);
  const user = chainFilterValue(start, 'user_id');
  if (user) {
    const userScope: OriginScope = {
      actions: scope.actions,
      resolvers: new Set([...scope.resolvers, ...USER_RESOLVERS]),
      verifiers: new Set(),
    };
    return pathOrigin(user, [], userScope, depth + 1);
  }
  return { kind: 'unknown', text: `an unscoped read of ${start.arguments[0]?.getText() ?? 'a table'}` };
}

function callOrigin(call: ts.CallExpression, scope: OriginScope, depth: number): Origin {
  const name = calleeName(call);
  if (name !== undefined && scope.resolvers.has(name)) return { kind: 'trusted' };
  const start = chainStart(call);
  if (start) return readOrigin(start, scope, depth);
  if (name === 'loggedRead' && call.arguments[1]) return pathOrigin(call.arguments[1], [], scope, depth + 1);
  if (name !== undefined && ROW_READS.has(name)) return { kind: 'trusted' };
  const callee = call.expression;
  if (!ts.isPropertyAccessExpression(callee)) return { kind: 'unknown', text: call.getText() };
  // `rows.map(...)` and `[...ids].filter(...)` keep the origin of their receiver.
  if (ORIGIN_PRESERVING_METHODS.has(callee.name.text))
    return pathOrigin(callee.expression, [], scope, depth + 1);
  // A parse keeps the origin of what it parsed.
  const [parsed] = call.arguments;
  if (PARSE_METHODS.has(callee.name.text) && parsed) return pathOrigin(parsed, [], scope, depth + 1);
  return { kind: 'unknown', text: call.getText() };
}

function callsAny(body: ts.Node, names: ReadonlySet<string>): boolean {
  let found = false;
  ts.forEachChild(body, function visit(node) {
    if (found) return;
    if (ts.isCallExpression(node)) {
      const name = calleeName(node);
      if (name !== undefined && names.has(name)) {
        found = true;
        return;
      }
    }
    ts.forEachChild(node, visit);
  });
  return found;
}

type LocalFunction = {
  name: string;
  node: ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression;
  body: ts.ConciseBody;
};

/** The module-level functions of a file, declared or bound to a const. */
function localFunctions(source: ts.SourceFile): LocalFunction[] {
  const locals: LocalFunction[] = [];
  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name && statement.body) {
      locals.push({ name: statement.name.text, node: statement, body: statement.body });
    }
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      const initializer = declaration.initializer;
      if (
        ts.isIdentifier(declaration.name) &&
        initializer &&
        (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer))
      ) {
        locals.push({ name: declaration.name.text, node: initializer, body: initializer.body });
      }
    }
  }
  return locals;
}

/** Adds every local function that `qualifies` under the growing set, to a fixed point. */
function closeOver(
  base: ReadonlySet<string>,
  locals: readonly LocalFunction[],
  qualifies: (local: LocalFunction, names: ReadonlySet<string>) => boolean,
): Set<string> {
  const names = new Set(base);
  for (let changed = true; changed; ) {
    changed = false;
    for (const local of locals) {
      if (names.has(local.name) || !qualifies(local, names)) continue;
      names.add(local.name);
      changed = true;
    }
  }
  return names;
}

/** Whether `local` passes its own first parameter, unchanged, as the first argument of a verifier. */
function verifiesFirstParameter(local: LocalFunction, verifiers: ReadonlySet<string>): boolean {
  const parameter = local.node.parameters[0];
  if (!parameter || !ts.isIdentifier(parameter.name)) return false;
  const checker = checkerFor(local.node.getSourceFile());
  const symbol = checker.getSymbolAtLocation(parameter.name);
  if (!symbol) return false;
  let found = false;
  ts.forEachChild(local.body, function visit(node) {
    if (found) return;
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      verifiers.has(node.expression.text)
    ) {
      const [argument] = node.arguments;
      if (argument && sameReference(referenceOf(argument, checker), { symbol, path: [] })) {
        found = true;
        return;
      }
    }
    ts.forEachChild(node, visit);
  });
  return found;
}

/**
 * The scope a module's code may name an organization through: the shared
 * resolvers plus every module-local function that calls one, and the
 * verifiers plus every module-local function that passes its own first
 * parameter to one.
 */
export function originScope(source: ts.SourceFile): OriginScope {
  const locals = localFunctions(source);
  return {
    actions: serverActionNodes(source),
    resolvers: closeOver(CONTEXT_RESOLVERS, locals, (local, names) => callsAny(local.body, names)),
    verifiers: closeOver(ORGANIZATION_VERIFIERS, locals, verifiesFirstParameter),
  };
}

function hasServerDirective(statements: readonly ts.Statement[]): boolean {
  for (const statement of statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression)) return false;
    if (statement.expression.text === 'use server') return true;
  }
  return false;
}

function isExported(statement: ts.Statement): boolean {
  return (
    ts.canHaveModifiers(statement) &&
    (ts.getModifiers(statement) ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
  );
}

/** The Server Action function nodes of a file: exports of a 'use server' module and inline actions. */
function serverActionNodes(source: ts.SourceFile): Set<ts.Node> {
  const actions = new Set<ts.Node>();
  if (hasServerDirective(source.statements)) {
    for (const statement of source.statements) {
      if (!isExported(statement)) continue;
      if (ts.isFunctionDeclaration(statement)) actions.add(statement);
      if (!ts.isVariableStatement(statement)) continue;
      for (const declaration of statement.declarationList.declarations) {
        const initializer = declaration.initializer;
        if (initializer && (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer))) {
          actions.add(initializer);
        }
      }
    }
  }
  ts.forEachChild(source, function visit(node) {
    if (
      ts.isFunctionLike(node) &&
      'body' in node &&
      node.body &&
      ts.isBlock(node.body) &&
      hasServerDirective(node.body.statements)
    ) {
      actions.add(node);
    }
    ts.forEachChild(node, visit);
  });
  return actions;
}
