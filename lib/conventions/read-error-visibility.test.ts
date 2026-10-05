import { expect, test } from 'bun:test';
import ts from 'typescript';
import { listProductSources, parseProductSource } from './product-sources';

// Tier 2 for "a read error is a failure the caller shows" (AGENTS.md "4. Code
// quality and maintainability"; docs/technical/code-quality.md). A reader that
// logs a failed Supabase read and continues with `[]`, `{}` or a missing row
// makes the screen say "nothing there": no assignees, no actor names, no
// origin request, a personnel document that looks unprotected.
//
// The scan covers every raw Supabase read under app/ and lib/: a `.from()`,
// `.rpc()`, `readInBatches`, `readAllRows` or `readCompleteRows` call that is
// awaited into `{ data, error }`, into a held result (`result.data`), or into
// an element of `await Promise.all([...])`. Writes (`insert`, `update`,
// `delete`, `upsert`, storage calls) and reads continued by `.then(require…)`
// are out of scope. `loggedRead(...)` is out of scope too: its sites treat a
// missing row as a refusal or as absence on purpose (the backlog row "Read
// errors that are only logged" tracks them).
//
// A read is a finding when its error is not turned into a failure (only
// logged, or not read at all) and
// - the error branch returns an empty value (`[]`, `{}`, `new Map()`, `0`,
//   `''`), or
// - the data is used without a refusing null check (`if (!data) return
//   failure`).
// An error counts as turned into a failure when a branch it guards throws,
// returns a non-empty value or calls something other than a logger, or when
// the error or the whole result is handed on.

const READ = /\.from\(|\.rpc\(|\breadInBatches\(|\breadAllRows\(|\breadCompleteRows\(/;
const NOT_A_READ = /\.(insert|update|delete|upsert|remove|upload)\(|\.then\(|^\s*loggedRead\(/;
const LOG_CALL = /^(logError|logReadFailure|logReadErrors|console\.\w+)$/;

// Reviewed reads, keyed `file::function::binding`, with the reason a failure
// may continue. A pre-check read inside a write action returns the module's
// load-failure code instead; it has no entry here. A stale entry fails the test.
const ALLOWED_BEST_EFFORT: Readonly<Record<string, string>> = {
  'lib/documents/write-support.ts::getAvailableDisplayName::data':
    'Best effort: the suffix only avoids a duplicate display name; a duplicate is legal and visible.',
  'lib/documents/write-support.ts::getAvailableFolderName::data':
    'Best effort: the suffix only avoids a duplicate folder name; a duplicate is legal and visible.',
  'lib/time-tracking/open-session-orgs.ts::getOpenSessionOrgsForUserOnDay::orgs':
    'The open sessions themselves are read strictly; only their organization names fall back to „Unbekannte Organisation“.',
  'lib/time-tracking/picker-actions.ts::getJobIdsPlannedTodayForUser::record':
    'Ordering hint only: a failure yields no "planned today" highlight rather than a failed picker (documented on the function).',
  'lib/time-tracking/picker-actions.ts::getJobIdsPlannedTodayForUser::data':
    'Ordering hint only: a failure yields no "planned today" highlight rather than a failed picker (documented on the function).',
  'lib/time-tracking/actions.ts::getClockJobInfo::projectData':
    'Label of the running clock card: the job row fails closed; a failed project name shows the job without it.',
  'lib/time-tracking/actions.ts::getClockJobInfo::clientData':
    'Label of the running clock card: the job row fails closed; a failed customer name shows the job without it.',
  'lib/org/delete-action.ts::deleteOrganization::remainingMemberships':
    'Write action, after the committed delete: a failed read leaves no active organization, and the next request resolves one.',
};

type Accessor = { name: string; property: 'data' | 'error' | null; declaration: ts.Node };
type Read = { node: ts.Node; binding: string; query: string; error: Accessor | null; data: Accessor | null };

function unwrap(node: ts.Expression): ts.Expression {
  let current = node;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isNonNullExpression(current)
  )
    current = current.expression;
  return current;
}

function isEmptyValue(node: ts.Expression | undefined): boolean {
  if (!node) return true;
  const value = unwrap(node);
  if (ts.isArrayLiteralExpression(value)) return value.elements.length === 0;
  if (ts.isObjectLiteralExpression(value)) {
    if (/success:\s*false|failed:\s*true|\berror\b/.test(value.getText())) return false;
    return value.properties.every(
      (property) => ts.isPropertyAssignment(property) && isEmptyValue(property.initializer),
    );
  }
  if (ts.isNewExpression(value))
    return /^(Map|Set)$/.test(value.expression.getText()) && (value.arguments?.length ?? 0) === 0;
  if (ts.isNumericLiteral(value)) return value.text === '0';
  if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) return value.text === '';
  return false;
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

/** `name` itself, or `name.property` when the result is held whole; aliases (`const x = name.data`) are followed. */
function references(scope: ts.Node, accessor: Accessor): ts.Expression[] {
  const found: ts.Expression[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && node.text === accessor.name && node !== accessor.declaration) {
      const parent = node.parent;
      const isName =
        (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
        (ts.isPropertyAssignment(parent) && parent.name === node) ||
        (ts.isBindingElement(parent) && parent.propertyName === node);
      const use =
        isName || accessor.property === null
          ? isName
            ? null
            : node
          : ts.isPropertyAccessExpression(parent) &&
              parent.expression === node &&
              parent.name.text === accessor.property
            ? parent
            : null;
      if (use) {
        const alias = use.parent;
        if (ts.isVariableDeclaration(alias) && alias.initializer === use && ts.isIdentifier(alias.name))
          found.push(
            ...references(scope, { name: alias.name.text, property: null, declaration: alias.name }),
          );
        else found.push(use);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(scope);
  return found;
}

/** A held result used other than through `.data` / `.error` hands its error on. */
function holderHandedOn(scope: ts.Node, accessor: Accessor | null): boolean {
  if (!accessor || accessor.property === null) return false;
  let handed = false;
  const visit = (node: ts.Node): void => {
    if (handed) return;
    if (ts.isIdentifier(node) && node.text === accessor.name && node !== accessor.declaration) {
      const parent = node.parent;
      if (!ts.isPropertyAccessExpression(parent)) handed = true;
    }
    ts.forEachChild(node, visit);
  };
  visit(scope);
  return handed;
}

function insideLogCall(node: ts.Node, stop: ts.Node): boolean {
  for (let current: ts.Node = node.parent; current !== stop; current = current.parent) {
    if (ts.isCallExpression(current) && LOG_CALL.test(current.expression.getText())) return true;
    if (ts.isStatement(current)) return false;
  }
  return false;
}

function isNegated(node: ts.Node): boolean {
  return ts.isPrefixUnaryExpression(node.parent) && node.parent.operator === ts.SyntaxKind.ExclamationToken;
}

/** The branch an `if` or a conditional expression takes when the tested value is truthy. */
function conditionBranch(reference: ts.Node, stop: ts.Node): ts.Node | null {
  for (let current: ts.Node = reference; current !== stop; current = current.parent) {
    const parent = current.parent;
    if (ts.isIfStatement(parent) && parent.expression === current) return parent.thenStatement;
    if (ts.isConditionalExpression(parent) && parent.condition === current) return parent.whenTrue;
    if (ts.isStatement(parent) || ts.isCallExpression(parent)) return null;
  }
  return null;
}

function surfacesFailure(branch: ts.Node): boolean {
  if (ts.isExpression(branch)) return !isEmptyValue(branch);
  let surfaces = false;
  const visit = (node: ts.Node): void => {
    if (surfaces || (ts.isFunctionLike(node) && node !== branch)) return;
    if (ts.isThrowStatement(node)) surfaces = true;
    else if (ts.isReturnStatement(node) && !isEmptyValue(node.expression)) surfaces = true;
    else if (
      ts.isExpressionStatement(node) &&
      ts.isCallExpression(node.expression) &&
      !LOG_CALL.test(node.expression.expression.getText())
    )
      surfaces = true;
    else if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken)
      surfaces = true;
    ts.forEachChild(node, visit);
  };
  visit(branch);
  return surfaces;
}

function returnsEmpty(branch: ts.Node): boolean {
  if (ts.isExpression(branch)) return isEmptyValue(branch);
  let empty = false;
  const visit = (node: ts.Node): void => {
    if (empty || (ts.isFunctionLike(node) && node !== branch)) return;
    if (ts.isReturnStatement(node) && node.expression && isEmptyValue(node.expression)) empty = true;
    ts.forEachChild(node, visit);
  };
  visit(branch);
  return empty;
}

/** `if (!data) return failure` (also `!data?.length`, `data === null`, `|| …`) refuses a missing row. */
function isRefusingNullGuard(reference: ts.Node): boolean {
  let node: ts.Node = reference;
  let negated = false;
  for (;;) {
    const parent = node.parent;
    if (
      ts.isPropertyAccessExpression(parent) ||
      ts.isNonNullExpression(parent) ||
      ts.isParenthesizedExpression(parent)
    ) {
      node = parent;
    } else if (ts.isPrefixUnaryExpression(parent) && parent.operator === ts.SyntaxKind.ExclamationToken) {
      negated = !negated;
      node = parent;
    } else if (ts.isBinaryExpression(parent) && parent.operatorToken.kind === ts.SyntaxKind.BarBarToken) {
      node = parent;
    } else if (
      ts.isBinaryExpression(parent) &&
      (parent.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken ||
        parent.operatorToken.kind === ts.SyntaxKind.EqualsEqualsToken) &&
      /^(null|undefined|0)$/.test((parent.left === node ? parent.right : parent.left).getText())
    ) {
      negated = !negated;
      node = parent;
    } else break;
  }
  const statement = node.parent;
  return (
    negated &&
    ts.isIfStatement(statement) &&
    statement.expression === node &&
    surfacesFailure(statement.thenStatement)
  );
}

function readsOf(declaration: ts.VariableDeclaration): Read[] {
  let initializer = declaration.initializer ? unwrap(declaration.initializer) : undefined;
  // `condition ? await read : { data: null }` reads on one branch.
  if (initializer && ts.isConditionalExpression(initializer)) {
    const awaited = [initializer.whenTrue, initializer.whenFalse].map(unwrap).find(ts.isAwaitExpression);
    if (awaited) initializer = awaited;
  }
  if (!initializer || !ts.isAwaitExpression(initializer)) return [];
  const awaited = unwrap(initializer.expression);
  const isRead = (text: string) => READ.test(text) && !NOT_A_READ.test(text);
  const held = (name: ts.Identifier, node: ts.Node, query: string): Read => ({
    node,
    binding: name.text,
    query,
    error: { name: name.text, property: 'error', declaration: name },
    data: { name: name.text, property: 'data', declaration: name },
  });

  if (
    ts.isArrayBindingPattern(declaration.name) &&
    ts.isCallExpression(awaited) &&
    awaited.expression.getText() === 'Promise.all' &&
    awaited.arguments[0] &&
    ts.isArrayLiteralExpression(awaited.arguments[0])
  ) {
    const queries = awaited.arguments[0].elements;
    return declaration.name.elements.flatMap((element, index) => {
      const query = queries[index];
      if (!query || ts.isOmittedExpression(element) || !ts.isIdentifier(element.name)) return [];
      return isRead(query.getText()) ? [held(element.name, element, query.getText())] : [];
    });
  }
  const query = awaited.getText();
  if (!isRead(query)) return [];
  if (ts.isIdentifier(declaration.name)) return [held(declaration.name, declaration, query)];
  if (!ts.isObjectBindingPattern(declaration.name)) return [];
  let error: Accessor | null = null;
  let data: Accessor | null = null;
  for (const element of declaration.name.elements) {
    const key = (element.propertyName ?? element.name).getText();
    if (!ts.isIdentifier(element.name)) continue;
    if (key === 'error') error = { name: element.name.text, property: null, declaration: element.name };
    if (key === 'data' || key === 'count')
      data = { name: element.name.text, property: null, declaration: element.name };
  }
  if (!data) return [];
  return [{ node: declaration, binding: data.name, query, error, data }];
}

function findingsIn(file: string): string[] {
  const source = parseProductSource(file);
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node)) {
      for (const read of readsOf(node)) {
        const scope = enclosingFunction(read.node);
        const errorRefs = read.error ? references(scope, read.error) : [];
        const errorSurfaced = errorRefs.some((reference) => {
          if (insideLogCall(reference, scope)) return false;
          const branch = conditionBranch(reference, scope);
          if (!branch) return true;
          return !isNegated(reference) && surfacesFailure(branch);
        });
        if (errorSurfaced || holderHandedOn(scope, read.error)) continue;
        const errorToEmpty = errorRefs.some((reference) => {
          const branch = conditionBranch(reference, scope);
          return branch !== null && !isNegated(reference) && returnsEmpty(branch);
        });
        // A data use under `!error` in the same condition runs after a successful read only.
        const guardedByNoError = (reference: ts.Node) => {
          let condition: ts.Node = reference;
          while (!ts.isStatement(condition.parent) && condition.parent !== scope)
            condition = condition.parent;
          return errorRefs.some(
            (errorRef) =>
              isNegated(errorRef) && errorRef.pos >= condition.pos && errorRef.end <= condition.end,
          );
        };
        const dataRefs = (read.data ? references(scope, read.data) : []).filter(
          (ref) => !guardedByNoError(ref),
        );
        const usedUnguarded = dataRefs.length > 0 && !dataRefs.some(isRefusingNullGuard);
        if (errorToEmpty || usedUnguarded) found.push(`${file}::${functionName(scope)}::${read.binding}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

test('a failed read is a failure the caller shows, never empty data', () => {
  const findings = listProductSources(['app', 'lib']).flatMap(findingsIn);
  expect(
    findings.filter((key) => !(key in ALLOWED_BEST_EFFORT)),
    'Turn the read error into a failure (ActionResult or the module load-failure code) that the page shows with RegionLoadError/SectionError, or add the read to ALLOWED_BEST_EFFORT with the reason a failure may continue.',
  ).toEqual([]);
  expect(
    Object.keys(ALLOWED_BEST_EFFORT).filter((key) => !findings.includes(key)),
    'These allowlisted reads are no longer findings; remove them from ALLOWED_BEST_EFFORT.',
  ).toEqual([]);
});
