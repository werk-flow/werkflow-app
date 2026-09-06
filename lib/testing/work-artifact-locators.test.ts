import { expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

const SECTION_OWNERS: Record<string, { path: string; helper: string }> = {
  'work-artifacts-section': { path: 'tests/golden/support/spec-helpers/work-artifact-dialog.ts', helper: 'workArtifactsSection' },
  'work-handover-section': { path: 'tests/golden/support/steps.ts', helper: 'workHandoverSection' },
  'job-dispatch-section': { path: 'tests/golden/support/steps.ts', helper: 'jobDispatchSection' },
  'work-lifecycle-card': { path: 'tests/golden/support/steps.ts', helper: 'workLifecycleCard' },
};
const ROOT = join(import.meta.dir, '../..');

function methodName(expression: ts.Expression): string | null {
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  if (ts.isElementAccessExpression(expression) && ts.isStringLiteral(expression.argumentExpression)) return expression.argumentExpression.text;
  return null;
}

function sectionId(call: ts.CallExpression): string | null {
  if (methodName(call.expression) !== 'getByTestId' || call.arguments.length !== 1 ||
      !ts.isStringLiteral(call.arguments[0])) return null;
  return SECTION_OWNERS[call.arguments[0].text] ? call.arguments[0].text : null;
}

function owningFunction(node: ts.Node): string | null {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (ts.isFunctionDeclaration(parent)) return parent.name?.text ?? null;
  }
  return null;
}

function isOwnedFieldPack(call: ts.CallExpression): boolean {
  if (!ts.isPropertyAccessExpression(call.expression)) return false;
  const receiver = call.expression.expression;
  if (!ts.isIdentifier(receiver)) return false;
  for (let scope: ts.Node | undefined = call.parent; scope; scope = scope.parent) {
    if (!ts.isBlock(scope)) continue;
    for (const statement of scope.statements) {
      if (!ts.isVariableStatement(statement)) continue;
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || declaration.name.text !== receiver.text) continue;
        const initializer = declaration.initializer;
        return Boolean((statement.declarationList.flags & ts.NodeFlags.Const) && initializer &&
          ts.isAwaitExpression(initializer) && ts.isCallExpression(initializer.expression) &&
          ts.isIdentifier(initializer.expression.expression) && initializer.expression.expression.text === 'openFieldWorkPack');
      }
    }
  }
  return false;
}

type LocatorScope = 'page' | 'narrowed-page' | 'owned' | 'unknown';

function isUnownedScope(scope: LocatorScope): boolean {
  return scope === 'page' || scope === 'narrowed-page';
}

function pageName(name: string): boolean {
  return /^(?:page|\w+Page)$/.test(name);
}

/** Local binding resolution avoids a full application typecheck in the unit suite. */
function locatorScopeResolver(syntax: ts.SourceFile): (expression: ts.Expression) => LocatorScope {
  type Binding = { name: string; scope: ts.Node; position: number; source?: ts.Expression; kind?: LocatorScope };
  const bindings: Binding[] = [];
  const pageTypes = new Set(['Page']);
  for (const statement of syntax.statements) {
    if (!ts.isImportDeclaration(statement) || !statement.importClause?.namedBindings ||
        !ts.isNamedImports(statement.importClause.namedBindings)) continue;
    for (const imported of statement.importClause.namedBindings.elements) {
      if ((imported.propertyName ?? imported.name).text === 'Page') pageTypes.add(imported.name.text);
    }
  }
  function scopeOf(node: ts.Node): ts.Node {
    for (let parent = node.parent; parent; parent = parent.parent) {
      if (ts.isBlock(parent) || ts.isSourceFile(parent) || ts.isFunctionLike(parent)) return parent;
    }
    return syntax;
  }
  function typeScope(type: ts.TypeNode | undefined): LocatorScope | undefined {
    if (!type) return undefined;
    if (ts.isParenthesizedTypeNode(type)) return typeScope(type.type);
    if (ts.isUnionTypeNode(type)) {
      const members = type.types.map(typeScope);
      if (members.includes('page')) return 'page';
      return members.every((member) => member === 'owned') ? 'owned' : undefined;
    }
    if (!ts.isTypeReferenceNode(type)) return undefined;
    const name = ts.isIdentifier(type.typeName) ? type.typeName.text : type.typeName.right.text;
    if (pageTypes.has(name)) return 'page';
    return name === 'Locator' ? 'owned' : undefined;
  }
  function collect(node: ts.Node): void {
    if (ts.isVariableDeclaration(node) || ts.isParameter(node)) {
      const scope = scopeOf(node);
      if (ts.isIdentifier(node.name)) {
        bindings.push({ name: node.name.text, scope, position: ts.isParameter(node) ? -1 : node.pos,
          source: node.initializer, kind: typeScope(node.type) });
      } else if (ts.isObjectBindingPattern(node.name)) {
        for (const element of node.name.elements) {
          if (!ts.isIdentifier(element.name)) continue;
          const original = element.propertyName ?? element.name;
          bindings.push({ name: element.name.text, scope, position: ts.isParameter(node) ? -1 : node.pos,
            kind: ts.isIdentifier(original) && pageName(original.text) ? 'page' : undefined });
        }
      }
    }
    ts.forEachChild(node, collect);
  }
  collect(syntax);
  const resolving = new Set<ts.Node>();
  function resolve(expression: ts.Expression): LocatorScope {
    if (resolving.has(expression)) return 'unknown';
    resolving.add(expression);
    try {
      if (ts.isParenthesizedExpression(expression) || ts.isAwaitExpression(expression) ||
          ts.isAsExpression(expression) || ts.isNonNullExpression(expression)) return resolve(expression.expression);
      if (ts.isIdentifier(expression)) {
        for (let scope: ts.Node | undefined = expression; scope; scope = scope.parent) {
          const binding = bindings.filter((entry) => entry.scope === scope && entry.name === expression.text &&
            entry.position < expression.pos).at(-1);
          if (!binding) continue;
          const sourceScope = binding.source ? resolve(binding.source) : 'unknown';
          if (sourceScope !== 'unknown') return sourceScope;
          return binding.kind ?? (pageName(binding.name) ? 'page' : 'unknown');
        }
        return pageName(expression.text) ? 'page' : 'unknown';
      }
      if (ts.isConditionalExpression(expression)) {
        const branches = [resolve(expression.whenTrue), resolve(expression.whenFalse)];
        return branches.includes('narrowed-page') ? 'narrowed-page' : branches.includes('page') ? 'page' : branches.every((branch) => branch === 'owned') ? 'owned' : 'unknown';
      }
      if (ts.isBinaryExpression(expression) && [ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken].includes(expression.operatorToken.kind)) {
        const branches = [resolve(expression.left), resolve(expression.right)];
        return branches.includes('narrowed-page') ? 'narrowed-page' : branches.includes('page') ? 'page' : branches.every((branch) => branch === 'owned') ? 'owned' : 'unknown';
      }
      if (!ts.isCallExpression(expression)) return 'unknown';
      const method = methodName(expression.expression);
      if (method === 'newPage') return 'page';
      if (!ts.isPropertyAccessExpression(expression.expression) && !ts.isElementAccessExpression(expression.expression)) return 'unknown';
      const parentScope = resolve(expression.expression.expression);
      if (parentScope !== 'page') return parentScope;
      if (privacyNarrowing(expression)) return 'narrowed-page';
      if (method === 'getByRole' && expression.arguments[0] && ts.isStringLiteral(expression.arguments[0]) &&
          ['main', 'dialog', 'alertdialog', 'navigation', 'banner', 'complementary', 'region', 'tabpanel'].includes(expression.arguments[0].text)) return 'owned';
      // A body selector, visibility filter or positional choice does not establish an owner.
      return 'page';
    } finally {
      resolving.delete(expression);
    }
  }
  return resolve;
}

function privacyNarrowing(call: ts.CallExpression): boolean {
  const method = methodName(call.expression);
  if (['first', 'last', 'nth'].includes(method ?? '')) return true;
  let narrowed = false;
  function visit(node: ts.Node): void {
    if (ts.isPropertyAssignment(node) &&
        ((ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) && node.name.text === 'visible')) narrowed = true;
    if (ts.isStringLiteralLike(node) && /:(?:visible|hidden)\b/.test(node.text)) narrowed = true;
    ts.forEachChild(node, visit);
  }
  for (const argument of call.arguments) visit(argument);
  return narrowed;
}

/** Absence chains may identify a record, but must not hide matching DOM copies. */
function isPageWidePrivacyAbsence(call: ts.CallExpression, resolveScope: (expression: ts.Expression) => LocatorScope): boolean {
  if (!ts.isPropertyAccessExpression(call.expression) && !ts.isElementAccessExpression(call.expression)) return false;
  if (resolveScope(call.expression.expression) !== 'page') return false;
  let receiver: ts.Expression = call.expression.expression;
  while (ts.isCallExpression(receiver) &&
      (ts.isPropertyAccessExpression(receiver.expression) || ts.isElementAccessExpression(receiver.expression))) {
    if (privacyNarrowing(receiver)) return false;
    receiver = receiver.expression.expression;
  }
  let current: ts.Node = call;
  while ((ts.isPropertyAccessExpression(current.parent) || ts.isElementAccessExpression(current.parent)) &&
      current.parent.expression === current && ts.isCallExpression(current.parent.parent)) {
    const chained = current.parent.parent;
    if (privacyNarrowing(chained)) return false;
    current = chained;
  }
  const assertion = current.parent;
  if (!ts.isCallExpression(assertion) || !ts.isIdentifier(assertion.expression) ||
      assertion.expression.text !== 'expect' || assertion.arguments[0] !== current) return false;
  const matcher = assertion.parent;
  if (!ts.isPropertyAccessExpression(matcher) || matcher.name.text !== 'toHaveCount') return false;
  const result = matcher.parent;
  return ts.isCallExpression(result) && result.expression === matcher &&
    result.arguments.length >= 1 && ts.isNumericLiteral(result.arguments[0]) && result.arguments[0].text === '0';
}

function unownedArtifactLocators(source: string, path = 'fixture.ts'): number[] {
  const syntax = ts.createSourceFile('fixture.ts', source, ts.ScriptTarget.Latest, true);
  const resolveScope = locatorScopeResolver(syntax);
  const violations: number[] = [];
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node)) {
      const id = sectionId(node);
      const owner = id ? SECTION_OWNERS[id] : null;
      const isOwner = owner?.path === path && owningFunction(node) === owner.helper;
      if (owner && !isOwner && !isPageWidePrivacyAbsence(node, resolveScope) && !isOwnedFieldPack(node)) {
        violations.push(syntax.getLineAndCharacterOfPosition(node.getStart(syntax)).line + 1);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(syntax);
  return violations;
}

function unownedPageTestIds(source: string): number[] {
  const syntax = ts.createSourceFile('fixture.ts', source, ts.ScriptTarget.Latest, true);
  const resolveScope = locatorScopeResolver(syntax);
  const violations: number[] = [];
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node) && methodName(node.expression) === 'getByTestId' &&
        (ts.isPropertyAccessExpression(node.expression) || ts.isElementAccessExpression(node.expression)) &&
        isUnownedScope(resolveScope(node.expression.expression)) && !isPageWidePrivacyAbsence(node, resolveScope)) {
      violations.push(syntax.getLineAndCharacterOfPosition(node.getStart(syntax)).line + 1);
    }
    ts.forEachChild(node, visit);
  }
  visit(syntax);
  return violations;
}

test('artifact locator guard rejects positive raw selectors and filtered privacy assertions', () => {
  for (const source of [
    `await expect(page.getByTestId('work-artifacts-section')).toBeVisible();`,
    `await employeePage.getByTestId('work-artifacts-section').getByRole('button').click();`,
    `await page['getByTestId']('work-artifacts-section').click();`,
    `await expect(outsiderPage.getByTestId('work-artifacts-section').filter({visible:true})).toHaveCount(0);`,
    `await expect(page.getByRole('main').getByTestId('work-artifacts-section')).toHaveCount(0);`,
    `{ const pack = page.getByTestId('field-work-pack'); pack.getByTestId('work-artifacts-section'); }`,
    `await page.getByTestId('work-handover-section').getByRole('button').click();`,
    `await expect(page.getByTestId('job-dispatch-section')).toBeVisible();`,
  ]) expect(unownedArtifactLocators(source)).toEqual([1]);
});

test('artifact locator guard preserves explicit whole-DOM privacy absence and shared positive ownership', () => {
  expect(unownedArtifactLocators(`
    await expect(outsiderPage.getByTestId('work-artifacts-section')).toHaveCount(0);
    await expect(outsiderPage.getByTestId('work-handover-section')).toHaveCount(0);
    await expect(outsiderPage.getByTestId('job-dispatch-section')).toHaveCount(0);
    await workArtifactsSection(employeePage).getByRole('button', {name:'Neu'}).click();
    {
      const pack = await openFieldWorkPack(employeePage, 'job-number');
      const readOnlyArtifacts = pack.getByTestId('work-artifacts-section');
    }
  `)).toEqual([]);
});

test('page test-id ownership follows Page parameters, fixture aliases and local page aliases', () => {
  for (const source of [
    `function inspect(browser: Page) { browser.getByTestId('new-section').click(); }`,
    `import type { Page as BrowserSurface } from '@playwright/test'; function inspect(browser: BrowserSurface) { browser.getByTestId(/row-/).click(); }`,
    `test('flow', async ({ adminPage: browser }) => { const alias = browser; alias['getByTestId'](rowId).click(); });`,
    `const browser = await context.newPage(); const alias = browser; alias.getByTestId(\`row-\${identity}\`).click();`,
    `function inspect(browser: Page) { const scope = enclosingDialog ?? browser; scope.getByTestId('documents').click(); }`,
    `function inspect(browser: Page) { const scope = condition ? dialog : browser; scope.getByTestId('documents').click(); }`,
    `function inspect(browser: Page) { browser.locator('body').getByTestId('row').click(); }`,
    `function inspect(browser: Page) { browser.locator(':visible').getByTestId('row').click(); }`,
    `function inspect(browser: Page) { const scope: Locator = browser.locator('body'); scope.getByTestId('row').click(); }`,
    `function inspect(scope: Page | Locator) { scope.getByTestId('row').click(); }`,
    `function inspect(scope: (Page | Locator)) { scope.getByTestId('row').click(); }`,
  ]) expect(unownedPageTestIds(source)).toEqual([1]);
});

test('page test-id ownership accepts semantic owners and respects lexical shadowing', () => {
  expect(unownedPageTestIds(`
    function inspect(browser: Page, dialog: Locator) {
      const main = browser.getByRole('main');
      const section = main.getByTestId('new-section');
      section.getByTestId('child-row').click();
      dialog.getByTestId('dialog-preview').click();
      browser.getByRole('dialog').getByTestId('dialog-preview').click();
      browser.getByRole('navigation').getByTestId('shell-action').click();
      { const browser = dialog; browser.getByTestId('preview').click(); }
    }
    function other(browser: Locator) { browser.getByTestId('row').click(); }
  `)).toEqual([]);
});

test('whole-DOM absence permits identity chains and timeouts but refuses visibility or positional narrowing', () => {
  expect(unownedPageTestIds(`
    test('denial', async ({ employeePage: browser }) => {
      await expect(browser.getByTestId('work-lifecycle-card')).toHaveCount(0);
      await expect(browser.getByTestId('team-card').filter({ hasText: teamName })).toHaveCount(0, { timeout: 30000 });
      await expect(browser.getByTestId('aufgaben-content').getByRole('button', {name:/genehmigen|ablehnen/})).toHaveCount(0);
      await expect(browser.getByTestId(/attention-/).getByText(jobNumber)).toHaveCount(0);
    });
  `)).toEqual([]);
  for (const source of [
    `await expect(page.getByTestId('private-row').filter({ visible: true })).toHaveCount(0);`,
    `await expect(page.getByTestId('private-row').locator(':visible')).toHaveCount(0);`,
    `await expect(page.getByTestId('private-row').first()).toHaveCount(0);`,
    `await expect(page.locator(':visible').getByTestId('private-row')).toHaveCount(0);`,
    `const narrowed = page.locator(':visible'); await expect(narrowed.getByTestId('private-row')).toHaveCount(0);`,
    `const narrowed: Locator = page.locator(':visible'); await expect(narrowed.getByTestId('private-row')).toHaveCount(0);`,
    `await expect(page.getByTestId('private-row').getByRole('button').nth(0)).toHaveCount(0);`,
  ]) expect(unownedPageTestIds(source)).toEqual([1]);
});

test('shared work section owners scope their sections to semantic main', () => {
  for (const [id, owner] of Object.entries(SECTION_OWNERS)) {
  const source = readFileSync(join(ROOT, owner.path), 'utf8');
  const syntax = ts.createSourceFile(owner.path, source, ts.ScriptTarget.Latest, true);
  const selectors: ts.CallExpression[] = [];
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node) && sectionId(node) === id && owningFunction(node) === owner.helper) selectors.push(node);
    ts.forEachChild(node, visit);
  }
  visit(syntax);
  expect(selectors).toHaveLength(1);
  const selector = selectors[0].expression;
  if (!ts.isPropertyAccessExpression(selector) || !ts.isCallExpression(selector.expression)) throw new Error('Artifact owner must select semantic main before the section.');
  const scope = selector.expression;
  expect(methodName(scope.expression)).toBe('getByRole');
  expect(scope.arguments).toHaveLength(1);
  expect(ts.isStringLiteral(scope.arguments[0]) && scope.arguments[0].text).toBe('main');
  }
});

test('browser suites use the artifact owner except for whole-DOM privacy absence', () => {
  const violations: string[] = [];
  for (const directory of ['tests/golden', 'tests/audit', 'tests/canary']) {
    for (const name of readdirSync(join(ROOT, directory), { recursive: true, encoding: 'utf8' })) {
      if (!name.endsWith('.ts')) continue;
      const path = `${directory}/${name.replaceAll('\\', '/')}`;
      for (const line of unownedArtifactLocators(readFileSync(join(ROOT, path), 'utf8'), path)) {
        violations.push(`${path}:${line}: use the shared semantic-main owner for positive work section checks`);
      }
      for (const line of unownedPageTestIds(readFileSync(join(ROOT, path), 'utf8'))) {
        violations.push(`${path}:${line}: scope positive test-id selection to its main, dialog or shell owner`);
      }
    }
  }
  expect(violations).toEqual([]);
});
