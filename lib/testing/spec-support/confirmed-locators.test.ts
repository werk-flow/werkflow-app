// Rule test: an outcome locator of the area modules reads the confirmed record only.
import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

import { MEASUREMENT_DIGEST_SUPPORT_FILES } from '../../../eslint-rules/playwright-spec-rules.mjs';

// A browser assertion about a saved result reads the saved result
// (testing.md, "Spec checklist"). Optimistic layers show a record before any
// authoritative read confirms it, and between the server's answer and that
// read the screen can still disagree with what the server stored (A1-23: a
// drop the server did not plan for that person). The product marks such
// content with `data-unconfirmed` (lib/ui/unconfirmed.ts); `confirmed` in
// tests/golden/support/steps/shared.ts excludes it. This test makes the
// primitive unskippable:
//
//   1. A record locator in the support modules lies inside a `confirmed(...)`
//      call: a row, list item or article role; a test id or a data attribute
//      that names a record; a `tr` or `li` element.
//   2. A locator function whose name names a record (`...Row`, `...Card`,
//      `...Entry`, ...) returns through `confirmed`, through another record
//      function, or is a pending-state locator by purpose
//      (PENDING_STATE_LOCATORS).
//   3. A spec or support module asserts the absence of a record through
//      `expectGone`, never `toHaveCount(0)`, `toBeHidden()` or
//      `not.toBeVisible()`: a confirmed locator finds nothing while its record
//      is unconfirmed, and an optimistic removal leaves nothing to mark.

const ROOT = join(import.meta.dir, '../../..');
const SUPPORT_FOLDERS = ['tests/golden/support', 'tests/audit/support'];
const SPEC_FOLDERS = ['tests/golden', 'tests/audit'];
/** Support files that own no record locator: the database layer and the settle step. */
const NOT_LOCATOR_OWNERS = ['tests/golden/support/db/', 'tests/golden/support/steps/interaction.ts'];

/** Locators that find unconfirmed content by purpose. Shrink-only: an entry leaves when its function goes. */
export const PENDING_STATE_LOCATORS: readonly { file: string; name: string; reason: string }[] = [
  {
    file: 'tests/golden/support/steps/shared.ts',
    name: 'pendingRow',
    reason: 'the optimistic row of a record that is still being saved',
  },
  {
    file: 'tests/golden/support/plantafel.ts',
    name: 'boardCardAsShown',
    reason: 'a board card with its optimistic placement, for the first frame after a drop',
  },
  {
    file: 'tests/golden/support/steps/work.ts',
    name: 'jobInstructionRowAsShown',
    reason: 'a checklist row while a move or toggle on it is pending, for the first-frame feedback',
  },
];

const RECORD_ROLES = new Set(['row', 'listitem', 'article']);
const RECORD_TEST_ID = /(^|-)(row|card|item|line|entry|record)s?$/;
const RECORD_SELECTOR =
  /\[data-(calendar-card|parkplatz-card|row-id|slot="list-row"|pending-row|dispatch-occurrence|dispatch-job|follow-up-id|timeline-key|notification-source|unread|task-source|own-request-source|vacation-request|sickness-report|calendar-bar|calendar-holiday|join-request)\b|(^|[\s>])(tr|li)(\b|:)/;
const RECORD_NAME = /(Row|Rows|Card|Cards|Entry|Entries|Item|Items|Line|Lines|Pill|Event|Events|TaskLink)$/;
/** A menu item, option or tab is a control that happens to end in `Item`, not a record. */
const CONTROL_ROLE = /getByRole\('(menuitem|option|tab)'/;
const ABSENCE_MATCHERS = new Set(['toBeHidden']);
const NEGATED_PRESENCE_MATCHERS = new Set(['toBeVisible', 'toBeAttached']);

export type Finding = { file: string; line: number; name: string; problem: string };

function listTs(folder: string, filter: (name: string) => boolean): string[] {
  return readdirSync(join(ROOT, folder), { recursive: true, encoding: 'utf8' })
    .map((name) => `${folder}/${name.replaceAll('\\', '/')}`)
    .filter(filter);
}

function supportFiles(): string[] {
  return SUPPORT_FOLDERS.flatMap((folder) => listTs(folder, (name) => name.endsWith('.ts'))).filter(
    (file) =>
      !MEASUREMENT_DIGEST_SUPPORT_FILES.includes(file) &&
      !NOT_LOCATOR_OWNERS.some((owner) => file.startsWith(owner)),
  );
}

function specFiles(): string[] {
  return SPEC_FOLDERS.flatMap((folder) => listTs(folder, (name) => name.endsWith('.spec.ts'))).filter(
    (file) => !file.startsWith('tests/audit/performance/'),
  );
}

function stringText(node: ts.Node | undefined): string | null {
  if (!node) return null;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node))
    return [node.head.text, ...node.templateSpans.map((span) => span.literal.text)].join('*');
  return null;
}

function calledName(call: ts.CallExpression): string | null {
  const callee = call.expression;
  if (ts.isIdentifier(callee)) return callee.text;
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text;
  return null;
}

/** True when the call locates a record by its role, test id or selector. */
export function isRecordLocatorCall(call: ts.CallExpression): boolean {
  const method = calledName(call);
  const first = stringText(call.arguments[0]);
  if (!ts.isPropertyAccessExpression(call.expression) || first === null) return false;
  if (method === 'getByRole') return RECORD_ROLES.has(first);
  if (method === 'getByTestId') return RECORD_TEST_ID.test(first);
  if (method === 'locator') return RECORD_SELECTOR.test(first);
  return false;
}

function insideConfirmed(node: ts.Node): boolean {
  for (let current: ts.Node = node; current.parent; current = current.parent) {
    const parent = current.parent;
    if (
      ts.isCallExpression(parent) &&
      calledName(parent) === 'confirmed' &&
      parent.arguments.includes(current as ts.Expression)
    )
      return true;
    if (ts.isFunctionLike(parent)) return false;
  }
  return false;
}

/** The name of the function a node sits in: a declaration or a `const` holding an arrow or function. */
function owningFunctionName(node: ts.Node): string | null {
  for (let current: ts.Node | undefined = node.parent; current; current = current.parent) {
    if (ts.isFunctionDeclaration(current) && current.name) return current.name.text;
    if (
      (ts.isArrowFunction(current) || ts.isFunctionExpression(current)) &&
      ts.isVariableDeclaration(current.parent)
    )
      return current.parent.name.getText();
  }
  return null;
}

/** The innermost call a returned locator chain starts from (`a(page).filter(...).first()` gives `a(page)`). */
function chainRoot(expression: ts.Expression): ts.Expression {
  let current = expression;
  for (;;) {
    if (ts.isCallExpression(current) && ts.isPropertyAccessExpression(current.expression)) {
      current = current.expression.expression;
      continue;
    }
    if (ts.isParenthesizedExpression(current) || ts.isAwaitExpression(current)) {
      current = current.expression;
      continue;
    }
    return current;
  }
}

type LocatorFunction = {
  name: string;
  line: number;
  returns: ts.Expression[];
  /** Local `const` names with the call their locator chain starts from. */
  locals: Map<string, string | null>;
};

function isAsyncOrTyped(node: ts.SignatureDeclaration): boolean {
  const isAsync = (ts.getModifiers(node as ts.HasModifiers) ?? []).some(
    (modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword,
  );
  return isAsync || (node.type !== undefined && node.type.getText() !== 'Locator');
}

function locatorFunctions(source: ts.SourceFile): LocatorFunction[] {
  const found: LocatorFunction[] = [];
  const collect = (
    name: string,
    node: ts.Node,
    signature: ts.SignatureDeclaration,
    body: ts.Node | undefined,
  ) => {
    if (!body || isAsyncOrTyped(signature)) return;
    const returns: ts.Expression[] = [];
    const locals = new Map<string, ts.Expression>();
    if (!ts.isBlock(body)) returns.push(body as ts.Expression);
    else {
      const visitReturns = (child: ts.Node): void => {
        if (ts.isFunctionLike(child)) return;
        if (ts.isReturnStatement(child) && child.expression) returns.push(child.expression);
        if (ts.isVariableDeclaration(child) && ts.isIdentifier(child.name) && child.initializer)
          locals.set(child.name.text, child.initializer);
        ts.forEachChild(child, visitReturns);
      };
      ts.forEachChild(body, visitReturns);
    }
    const localRoots = new Map<string, string | null>();
    for (const [local, initializer] of locals) {
      const root = chainRoot(initializer);
      localRoots.set(local, ts.isCallExpression(root) ? calledName(root) : null);
    }
    found.push({
      name,
      line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
      returns,
      locals: localRoots,
    });
  };
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name) collect(node.name.text, node, node, node.body);
    if (
      ts.isVariableDeclaration(node) &&
      node.initializer &&
      (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
    )
      collect(node.name.getText(), node, node.initializer, node.initializer.body);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

function isPendingState(file: string, name: string | null): boolean {
  return PENDING_STATE_LOCATORS.some((entry) => entry.file === file && entry.name === name);
}

/** Rules 1 and 2 for one support module; `recordFunctions` holds every compliant record function name. */
export function supportFindings(file: string, text: string, recordFunctions: ReadonlySet<string>): Finding[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const findings: Finding[] = [];
  const lineOf = (node: ts.Node) => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && isRecordLocatorCall(node) && !insideConfirmed(node)) {
      const name = owningFunctionName(node);
      if (!isPendingState(file, name))
        findings.push({
          file,
          line: lineOf(node),
          name: name ?? '<module>',
          problem: `record locator ${node.getText(source).slice(0, 80)} outside confirmed()`,
        });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  for (const fn of locatorFunctions(source)) {
    if (!RECORD_NAME.test(fn.name) || isPendingState(file, fn.name)) continue;
    const confirmedName = (name: string | null | undefined): boolean =>
      name === 'confirmed' || (name !== null && name !== undefined && recordFunctions.has(name));
    const readsConfirmed = (returned: ts.Expression): boolean => {
      if (ts.isConditionalExpression(returned))
        return readsConfirmed(returned.whenTrue) && readsConfirmed(returned.whenFalse);
      const root = chainRoot(returned);
      if (ts.isCallExpression(root)) return confirmedName(calledName(root));
      if (ts.isIdentifier(root)) return confirmedName(fn.locals.get(root.text));
      // Not a locator: an object, an array, a literal or a template.
      return !ts.isPropertyAccessExpression(root);
    };
    for (const returned of fn.returns) {
      if (readsConfirmed(returned) || CONTROL_ROLE.test(returned.getText(source))) continue;
      findings.push({
        file,
        line: fn.line,
        name: fn.name,
        problem: `record function returns ${returned.getText(source).slice(0, 80)} without confirmed()`,
      });
    }
  }
  return findings;
}

/** Rule 3: absence assertions on a record locator call, or on a const bound to one. */
export function absenceFindings(file: string, text: string, recordFunctions: ReadonlySet<string>): Finding[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const findings: Finding[] = [];
  const boundToRecord = new Set<string>();
  const isRecordExpression = (expression: ts.Expression): boolean => {
    const root = chainRoot(expression);
    if (ts.isIdentifier(root)) return boundToRecord.has(root.text);
    if (!ts.isCallExpression(root)) return false;
    const name = calledName(root);
    return name !== null && (name === 'confirmed' || recordFunctions.has(name));
  };
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && node.initializer && ts.isIdentifier(node.name)) {
      if (isRecordExpression(node.initializer)) boundToRecord.add(node.name.text);
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const matcher = node.expression.name.text;
      const target = node.expression.expression;
      const negated = ts.isPropertyAccessExpression(target) && target.name.text === 'not';
      const expectCall = negated ? (target as ts.PropertyAccessExpression).expression : target;
      const absence = negated
        ? NEGATED_PRESENCE_MATCHERS.has(matcher)
        : (matcher === 'toHaveCount' && node.arguments[0]?.getText(source) === '0') ||
          ABSENCE_MATCHERS.has(matcher);
      if (
        absence &&
        ts.isCallExpression(expectCall) &&
        calledName(expectCall) === 'expect' &&
        expectCall.arguments[0] &&
        isRecordExpression(expectCall.arguments[0])
      )
        findings.push({
          file,
          line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
          name: expectCall.arguments[0].getText(source).slice(0, 60),
          problem: `absence of a record asserted with ${matcher}; use expectGone`,
        });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return findings;
}

/** Every record function name in the support modules: the pending-state locators stay out. */
function recordFunctionNames(files: readonly string[]): Set<string> {
  const names = new Set<string>();
  for (const file of files) {
    const source = ts.createSourceFile(
      file,
      readFileSync(join(ROOT, file), 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    );
    for (const fn of locatorFunctions(source)) {
      if (isPendingState(file, fn.name)) continue;
      const confirmedReturn = fn.returns.some((returned) => {
        const root = chainRoot(returned);
        return (
          (ts.isCallExpression(returned) && calledName(returned) === 'confirmed') ||
          (ts.isCallExpression(root) && calledName(root) === 'confirmed')
        );
      });
      const control = fn.returns.some((returned) => CONTROL_ROLE.test(returned.getText(source)));
      if ((RECORD_NAME.test(fn.name) && !control) || confirmedReturn) names.add(fn.name);
    }
  }
  return names;
}

describe('confirmed outcome locators', () => {
  const support = supportFiles();
  const records = recordFunctionNames(support);

  test('found the support modules and their record functions', () => {
    expect(support.length).toBeGreaterThan(20);
    expect(records.has('dayCard')).toBe(true);
  });

  test('every record locator of the area modules reads the confirmed record', () => {
    const findings = support.flatMap((file) =>
      supportFindings(file, readFileSync(join(ROOT, file), 'utf8'), records),
    );
    expect(findings).toEqual([]);
  });

  test('the absence of a record is asserted through expectGone', () => {
    const findings = [...support, ...specFiles()].flatMap((file) =>
      absenceFindings(file, readFileSync(join(ROOT, file), 'utf8'), records),
    );
    expect(findings).toEqual([]);
  });

  test('every pending-state exception still names a function', () => {
    const stale = PENDING_STATE_LOCATORS.filter(
      (entry) => !readFileSync(join(ROOT, entry.file), 'utf8').includes(`function ${entry.name}(`),
    );
    expect(stale).toEqual([]);
  });

  test('planted probes: an unwrapped record locator, a record function and an absence are found', () => {
    const names = new Set(['dayCard']);
    const unwrapped = `export function dayCard(row: Locator, title: string): Locator {
  return row.locator('[data-calendar-card]').filter({ hasText: title });
}`;
    expect(supportFindings('probe.ts', unwrapped, names).map((finding) => finding.problem)).toHaveLength(2);
    const wrapped = unwrapped.replace(
      "row.locator('[data-calendar-card]').filter({ hasText: title })",
      "confirmed(row.locator('[data-calendar-card]').filter({ hasText: title }))",
    );
    expect(supportFindings('probe.ts', wrapped, names)).toEqual([]);
    const listRow = `export function memberRow(page: Page, name: string): Locator {
  return page.getByRole('row').filter({ hasText: name });
}`;
    expect(supportFindings('probe.ts', listRow, names)).toHaveLength(2);
    const absence = `const card = dayCard(row, title);
await expect(card).toHaveCount(0);
await expect(dayCard(row, title)).not.toBeVisible();
await expectGone(card);`;
    expect(absenceFindings('probe.spec.ts', absence, names).map((finding) => finding.line)).toEqual([2, 3]);
  });
});
