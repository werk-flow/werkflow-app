import { expect, test } from 'bun:test';
import ts from 'typescript';
import { listProductSources, parseProductSource } from './product-sources';

// Tier 2 for "a failed section read shows its failure, never an empty section"
// (AGENTS.md "4. Code quality and maintainability"; docs/technical/code-quality.md).
// A page reads its sections in parallel and marks a failed one with `null`, a
// `…LoadFailed` prop or a `RegionLoadError`. A fallback such as
// `result.success ? result.items : []` or `result.data ?? []` turns a failure
// into "no documents", "no events", "no material" unless the failure also
// reaches the screen another way. Leaving the page on a failed read is the same
// mistake one level up: `notFound()`, `redirect()` or `<RouteRedirect>` says
// "this record does not exist" when the database did not answer.
//
// The scan covers the server pages and the loaders they render: every `.tsx`
// under `app/`, and the server modules under `components/` (no 'use client';
// a `.tsx` file or one with an async function). Two findings, keyed `file::function::binding`:
// - Empty fallback. The failure branch of a test on a read result
//   (`x.success`, `x.error`) is empty (`[]`, `{}`, `0`, `''`, `new Map()`,
//   `new Set()`, or nothing rendered where the success branch is JSX), or the
//   site is `x.data ?? <empty>` or `.catch(() => <empty>)`, and the function
//   hands the failure on nowhere else: no other test of `x.success` or
//   `x.error` outside a log call and outside such a fallback, and `x` itself
//   is not passed on.
// - Exit on failure. A `notFound()`, `redirect()` or `<RouteRedirect>` sits
//   under a failure test of a read result (`!x.success`, a destructured read
//   `error`), no guard narrows it to named codes (`x.error === '…_not_found'`),
//   and no earlier statement of the function tested `x.error` (as the job
//   detail page does for `fetch_failed` before it leaves for a missing job).

// Reviewed sites, keyed `file::function::binding`, with the reason the empty
// value or the exit is right for a failure. A stale entry fails the test.
const ALLOWED: Readonly<Record<string, string>> = {};

type Finding = { key: string; line: number; message: string };
type FailureTest = { holder: string; failsWhenTrue: boolean };
type EmptyFallback = { holder: string; node: ts.Node; form: string };
type Guard = { condition: ts.Expression; whenTrue: boolean; statement: ts.Node };

const LEAVE_CALL = /^(notFound|redirect|permanentRedirect)$/;
const LOG_CALL = /^(logError|logReadFailure|logReadErrors|console\.\w+)$/;
const COMPARISON = new Set([
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsEqualsToken,
  ts.SyntaxKind.EqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsToken,
]);

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

/** `[]`, `{}`, `0`, `''`, an empty `Map` or `Set`: a value that reads as "none". */
function isEmptyValue(node: ts.Expression): boolean {
  const value = unwrap(node);
  if (ts.isArrayLiteralExpression(value)) return value.elements.length === 0;
  if (ts.isObjectLiteralExpression(value)) return value.properties.length === 0;
  if (ts.isNewExpression(value))
    return /^(Map|Set)$/.test(value.expression.getText()) && (value.arguments?.length ?? 0) === 0;
  if (ts.isNumericLiteral(value)) return value.text === '0';
  if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) return value.text === '';
  return false;
}

function rendersNothing(node: ts.Expression): boolean {
  const value = unwrap(node);
  return (
    value.kind === ts.SyntaxKind.NullKeyword ||
    value.kind === ts.SyntaxKind.FalseKeyword ||
    (ts.isIdentifier(value) && value.text === 'undefined')
  );
}

function isJsx(node: ts.Expression): boolean {
  const value = unwrap(node);
  return ts.isJsxElement(value) || ts.isJsxSelfClosingElement(value) || ts.isJsxFragment(value);
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

/** The nearest named function: a JSX or `.then` callback belongs to the function that holds the result. */
function namedScope(node: ts.Node): ts.Node {
  let scope = enclosingFunction(node);
  while (!ts.isSourceFile(scope) && functionName(scope) === '<anonymous>') scope = enclosingFunction(scope);
  return scope;
}

function lineOf(node: ts.Node): number {
  const source = node.getSourceFile();
  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
}

/** `x.success`, `x?.success`, `x.error`, their negations, and an `&&` chain that holds `x.success`. */
function failureTest(condition: ts.Expression): FailureTest | null {
  const node = unwrap(condition);
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.ExclamationToken) {
    const inner = failureTest(node.operand);
    return inner ? { holder: inner.holder, failsWhenTrue: !inner.failsWhenTrue } : null;
  }
  if (
    ts.isPropertyAccessExpression(node) &&
    ts.isIdentifier(node.expression) &&
    (node.name.text === 'success' || node.name.text === 'error')
  )
    return { holder: node.expression.text, failsWhenTrue: node.name.text === 'error' };
  // `x.success && other` is false on failure, so the failure branch is the false one.
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
    for (const side of [node.left, node.right]) {
      const test = failureTest(side);
      if (test && !test.failsWhenTrue) return test;
    }
  }
  return null;
}

function insideLogCall(node: ts.Node, stop: ts.Node): boolean {
  for (let current: ts.Node = node.parent; current !== stop; current = current.parent) {
    if (ts.isCallExpression(current) && LOG_CALL.test(current.expression.getText())) return true;
    if (ts.isStatement(current)) return false;
  }
  return false;
}

/** An `if` whose branch only logs does not hand the failure on. */
function testsOnlyToLog(reference: ts.Node, stop: ts.Node): boolean {
  for (let current: ts.Node = reference; current !== stop; current = current.parent) {
    const parent = current.parent;
    if (ts.isIfStatement(parent) && parent.expression === current) {
      const branch = parent.thenStatement;
      const statements = ts.isBlock(branch) ? branch.statements : [branch];
      return statements.every(
        (statement) =>
          ts.isExpressionStatement(statement) &&
          ts.isCallExpression(statement.expression) &&
          LOG_CALL.test(statement.expression.expression.getText()),
      );
    }
    if (ts.isStatement(parent)) return false;
  }
  return false;
}

/**
 * `...(x.success ? { items } : {})` leaves the key out instead of setting it empty.
 * The receiver sees an unseeded optional key and reads it itself, as the calendar's
 * range owner does for its initial data.
 */
function omitsKeys(conditional: ts.ConditionalExpression, failureBranch: ts.Expression): boolean {
  let outer: ts.Node = conditional;
  while (ts.isParenthesizedExpression(outer.parent)) outer = outer.parent;
  const value = unwrap(failureBranch);
  return (
    ts.isSpreadAssignment(outer.parent) &&
    ts.isObjectLiteralExpression(value) &&
    value.properties.length === 0
  );
}

function emptyFallbacks(source: ts.SourceFile): EmptyFallback[] {
  const found: EmptyFallback[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isConditionalExpression(node)) {
      const test = failureTest(node.condition);
      if (test) {
        const failureBranch = test.failsWhenTrue ? node.whenTrue : node.whenFalse;
        const successBranch = test.failsWhenTrue ? node.whenFalse : node.whenTrue;
        if (
          !omitsKeys(node, failureBranch) &&
          (isEmptyValue(failureBranch) || (rendersNothing(failureBranch) && isJsx(successBranch)))
        )
          found.push({
            holder: test.holder,
            node,
            form: `${node.condition.getText()} ? … : ${failureBranch.getText()}`,
          });
      }
    } else if (ts.isBinaryExpression(node)) {
      const operator = node.operatorToken.kind;
      if (operator === ts.SyntaxKind.AmpersandAmpersandToken && isJsx(node.right)) {
        const test = failureTest(node.left);
        if (test && !test.failsWhenTrue)
          found.push({ holder: test.holder, node, form: `${node.left.getText()} && <…>` });
      }
      const left = unwrap(node.left);
      if (
        operator === ts.SyntaxKind.QuestionQuestionToken &&
        isEmptyValue(node.right) &&
        ts.isPropertyAccessExpression(left) &&
        left.name.text === 'data' &&
        ts.isIdentifier(left.expression)
      )
        found.push({
          holder: left.expression.text,
          node,
          form: `${left.getText()} ?? ${node.right.getText()}`,
        });
    } else if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'catch'
    ) {
      const handler = node.arguments[0];
      if (
        handler &&
        ts.isArrowFunction(handler) &&
        ts.isExpression(handler.body) &&
        isEmptyValue(handler.body)
      )
        found.push({ holder: '<catch>', node, form: `.catch(() => ${handler.body.getText()})` });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/** Another test of the holder's failure in the scope, or the holder passed on whole. */
function failureHandedOn(scope: ts.Node, holder: string, fallbacks: readonly EmptyFallback[]): boolean {
  const insideFallback = (node: ts.Node) =>
    fallbacks.some((fallback) => node.pos >= fallback.node.pos && node.end <= fallback.node.end);
  let handed = false;
  const visit = (node: ts.Node): void => {
    if (handed) return;
    if (ts.isIdentifier(node) && node.text === holder && !insideFallback(node)) {
      const parent = node.parent;
      const isDeclaration =
        (ts.isBindingElement(parent) || ts.isVariableDeclaration(parent)) && parent.name === node;
      const isPropertyName =
        (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
        (ts.isPropertyAssignment(parent) && parent.name === node);
      if (ts.isPropertyAccessExpression(parent) && parent.expression === node) {
        const property = parent.name.text;
        if (
          (property === 'success' || property === 'error') &&
          !insideLogCall(parent, scope) &&
          !testsOnlyToLog(parent, scope)
        )
          handed = true;
      } else if (!isDeclaration && !isPropertyName && !insideLogCall(node, scope)) {
        // The whole result reaches a prop, a return value or a helper.
        handed = true;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(scope);
  return handed;
}

/** Names bound to the `error` of a destructured result: `const { data, error: readError } = await …`. */
function readErrorBindings(scope: ts.Node): Set<string> {
  const names = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isBindingElement(node) && ts.isIdentifier(node.name) && ts.isObjectBindingPattern(node.parent)) {
      if ((node.propertyName ?? node.name).getText() === 'error') names.add(node.name.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(scope);
  return names;
}

function isExit(node: ts.Node): boolean {
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression))
    return LEAVE_CALL.test(node.expression.text);
  if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node))
    return node.tagName.getText() === 'RouteRedirect';
  return false;
}

/** The conditions that guard `node` within `scope`, innermost first, with the branch taken. */
function guardsOf(node: ts.Node, scope: ts.Node): Guard[] {
  const found: Guard[] = [];
  for (let current: ts.Node = node; current !== scope && current.parent; current = current.parent) {
    const parent = current.parent;
    if (ts.isIfStatement(parent) && parent.expression !== current)
      found.push({
        condition: parent.expression,
        whenTrue: parent.thenStatement === current,
        statement: parent,
      });
    else if (ts.isConditionalExpression(parent) && parent.condition !== current)
      found.push({ condition: parent.condition, whenTrue: parent.whenTrue === current, statement: parent });
    else if (
      ts.isBinaryExpression(parent) &&
      parent.right === current &&
      parent.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
    )
      found.push({ condition: parent.left, whenTrue: true, statement: parent });
  }
  return found;
}

/** `x.error === '…'`, `CODES.has(x.error)`, `[…].includes(x.error)`: the exit names the codes it is for. */
function narrowsErrorCode(condition: ts.Expression, holder: string): boolean {
  let narrows = false;
  const visit = (node: ts.Node): void => {
    if (narrows) return;
    if (
      ts.isPropertyAccessExpression(node) &&
      node.name.text === 'error' &&
      node.expression.getText() === holder
    ) {
      const parent = node.parent;
      if (
        (ts.isBinaryExpression(parent) && COMPARISON.has(parent.operatorToken.kind)) ||
        ts.isCallExpression(parent)
      )
        narrows = true;
    }
    ts.forEachChild(node, visit);
  };
  visit(condition);
  return narrows;
}

/** The results whose failure takes this branch: the condition itself, or a term of a top-level `||`. */
function failingHolders(guard: Guard, errorBindings: ReadonlySet<string>): string[] {
  const terms: ts.Expression[] = [];
  const split = (expression: ts.Expression): void => {
    const value = unwrap(expression);
    if (
      guard.whenTrue &&
      ts.isBinaryExpression(value) &&
      value.operatorToken.kind === ts.SyntaxKind.BarBarToken
    ) {
      split(value.left);
      split(value.right);
    } else terms.push(value);
  };
  split(guard.condition);
  const holders = new Set<string>();
  for (const term of terms) {
    const test = failureTest(term);
    if (test && test.failsWhenTrue === guard.whenTrue) holders.add(test.holder);
    if (guard.whenTrue && ts.isIdentifier(term) && errorBindings.has(term.text)) holders.add(term.text);
  }
  return [...holders];
}

/** `x.error` tested before `statement`, outside a log call: the failure codes were handled first. */
function handledBefore(scope: ts.Node, holder: string, statement: ts.Node): boolean {
  let handled = false;
  const visit = (node: ts.Node): void => {
    if (handled || node.pos >= statement.pos) return;
    if (
      ts.isPropertyAccessExpression(node) &&
      node.name.text === 'error' &&
      node.expression.getText() === holder &&
      !insideLogCall(node, scope) &&
      !testsOnlyToLog(node, scope)
    )
      handled = true;
    ts.forEachChild(node, visit);
  };
  visit(scope);
  return handled;
}

function findingsIn(file: string, text?: string): Finding[] {
  const source = parseProductSource(file, text);
  const found: Finding[] = [];
  const fallbacks = emptyFallbacks(source);
  for (const fallback of fallbacks) {
    const scope = namedScope(fallback.node);
    if (fallback.holder !== '<catch>' && failureHandedOn(scope, fallback.holder, fallbacks)) continue;
    found.push({
      key: `${file}::${functionName(scope)}::${fallback.holder}`,
      line: lineOf(fallback.node),
      message: `\`${fallback.form}\` shows a failed read as empty, and the failure reaches no prop or region`,
    });
  }
  const visit = (node: ts.Node): void => {
    if (isExit(node)) {
      const scope = namedScope(node);
      const errorBindings = readErrorBindings(scope);
      const guards = guardsOf(node, scope);
      for (const guard of guards) {
        for (const holder of failingHolders(guard, errorBindings)) {
          if (guards.some((other) => narrowsErrorCode(other.condition, holder))) continue;
          if (handledBefore(scope, holder, guard.statement)) continue;
          found.push({
            key: `${file}::${functionName(scope)}::${holder}`,
            line: lineOf(node),
            message: `leaves the page when \`${holder}\` failed; a failed read is not a missing record`,
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

function scannedSources(): string[] {
  return listProductSources(['app', 'components']).filter((file) => {
    // Route handlers answer requests and own their status codes; pages, layouts and forms render.
    if (file.startsWith('app/')) return file.endsWith('.tsx');
    // Server modules only: a client component reads through a hook that owns its failure state.
    const text = parseProductSource(file).text;
    return !/^\s*['"]use client['"]/.test(text) && (file.endsWith('.tsx') || /\basync function\b/.test(text));
  });
}

const keysIn = (text: string): string[] =>
  findingsIn('app/planted/page.tsx', text)
    .map((finding) => finding.key)
    .sort();

const PLANTED_PAGE = `export default async function PlantedPage() {
  const [detail, documentsResult, eventsResult] = await Promise.all([readDetail(), readDocuments(), readEvents()]);
  if (!detail.success) notFound();
  const documents = documentsResult.success ? documentsResult.documents : [];
  const events = eventsResult.data ?? [];
  return <Detail documents={documents} events={events} />;
}`;

test('the scan catches planted empty sections and a planted exit on a failed read', () => {
  expect(keysIn(PLANTED_PAGE)).toEqual([
    'app/planted/page.tsx::PlantedPage::detail',
    'app/planted/page.tsx::PlantedPage::documentsResult',
    'app/planted/page.tsx::PlantedPage::eventsResult',
  ]);
  const repaired = PLANTED_PAGE.replace(
    '  if (!detail.success) notFound();',
    "  if (!detail.success) {\n    if (detail.error === 'not_found') notFound();\n    return <RegionLoadError>x</RegionLoadError>;\n  }",
  ).replace(
    'events={events} />',
    'events={events} documentsLoadFailed={!documentsResult.success} eventsFailed={Boolean(eventsResult.error)} />',
  );
  expect(keysIn(repaired)).toEqual([]);
});

test('a test that only logs hands nothing on, and rendering nothing hides a failure too', () => {
  const logged = PLANTED_PAGE.replace(
    '  const events',
    "  if (!documentsResult.success) logError('read failed', documentsResult.error);\n  const events",
  );
  expect(keysIn(logged)).toContain('app/planted/page.tsx::PlantedPage::documentsResult');
  const hidden = `export default async function Hidden() {
  const periods = await readPeriods();
  return <div>{periods.success ? <List periods={periods.data} /> : null}</div>;
}`;
  expect(keysIn(hidden)).toEqual(['app/planted/page.tsx::Hidden::periods']);
  const caught = `export default async function Caught() {
  const rows = await readRows().catch(() => []);
  return <List rows={rows} />;
}`;
  expect(keysIn(caught)).toEqual(['app/planted/page.tsx::Caught::<catch>']);
  const destructured = `export default async function Raw() {
  const { data: row, error: rowError } = await admin.from('t').select('*').maybeSingle();
  if (rowError || !row) notFound();
  return <Detail row={row} />;
}`;
  expect(keysIn(destructured)).toEqual(['app/planted/page.tsx::Raw::rowError']);
  // A spread of `{}` leaves the key unseeded for the receiver to read; it sets nothing empty.
  const seeded = `export default async function Seeded() {
  const entries = await readEntries();
  return <Calendar initial={{ ...(entries.success ? { entries: entries.items } : {}) }} />;
}`;
  expect(keysIn(seeded)).toEqual([]);
});

test('a failed section read reaches the page as a failure, never as an empty section or an exit', () => {
  const findings = scannedSources().flatMap((file) => findingsIn(file));
  expect(
    findings
      .filter((finding) => !(finding.key in ALLOWED))
      .map((finding) => `${finding.key} (line ${finding.line}): ${finding.message}`),
    'Hand the failure to its section (null, a …LoadFailed prop, RegionLoadError or SectionError with retry), narrow an exit to the absence codes, or add the site to ALLOWED with the reason.',
  ).toEqual([]);
  const keys = new Set(findings.map((finding) => finding.key));
  expect(
    Object.keys(ALLOWED).filter((key) => !keys.has(key)),
    'These allowed sites are no longer findings; remove them from ALLOWED.',
  ).toEqual([]);
});
