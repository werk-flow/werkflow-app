// Rule test: every in-page tab set on an inventoried page is in the tab inventory.
import { expect, test } from 'bun:test';
import { resolve } from 'node:path';
import ts from 'typescript';
import { readProductSources } from '../../ui/dialog-discovery';
import { DIALOG_INVENTORY, type DialogInventoryEntry } from './dialog-inventory';
import { DYNAMIC_PHONE_ROUTES, EMPLOYEE_PHONE_ROUTES, MANAGER_PHONE_ROUTES } from './mobile-route-inventory';
import { PAGE_TAB_SETS, type PageTabSet } from './page-tab-inventory';

/**
 * The `value` of every registry `TabsTrigger` per file outside components/ui.
 * A literal is read directly; `value={tab.value}` inside a `.map` over a
 * module-level array literal of `{ value: '…' }` objects is resolved. Anything
 * else is reported, because the audit can only open a tab it can name.
 */
function scanTabTriggers(files: ReadonlyMap<string, string>): {
  values: Map<string, string[]>;
  unresolved: string[];
} {
  const values = new Map<string, string[]>();
  const unresolved: string[] = [];
  for (const [file, text] of files) {
    if (file.startsWith('components/ui/') || !file.endsWith('.tsx') || !text.includes('TabsTrigger'))
      continue;
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const arrays = new Map<string, string[]>();
    for (const statement of source.statements) {
      if (!ts.isVariableStatement(statement)) continue;
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
        if (!ts.isArrayLiteralExpression(declaration.initializer)) continue;
        const literal = declaration.initializer.elements.map((element) => {
          if (!ts.isObjectLiteralExpression(element)) return undefined;
          const property = element.properties.find(
            (candidate): candidate is ts.PropertyAssignment =>
              ts.isPropertyAssignment(candidate) && candidate.name.getText() === 'value',
          );
          return property && ts.isStringLiteral(property.initializer) ? property.initializer.text : undefined;
        });
        if (literal.every((value): value is string => value !== undefined))
          arrays.set(declaration.name.text, literal);
      }
    }
    const found: string[] = [];
    function mappedArray(node: ts.Node): string[] | undefined {
      for (let parent = node.parent; parent; parent = parent.parent) {
        if (
          ts.isCallExpression(parent) &&
          ts.isPropertyAccessExpression(parent.expression) &&
          parent.expression.name.text === 'map' &&
          ts.isIdentifier(parent.expression.expression)
        )
          return arrays.get(parent.expression.expression.text);
      }
      return undefined;
    }
    function visit(node: ts.Node): void {
      if (
        (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
        node.tagName.getText() === 'TabsTrigger'
      ) {
        const attribute = node.attributes.properties.find(
          (part): part is ts.JsxAttribute => ts.isJsxAttribute(part) && part.name.getText() === 'value',
        );
        const initializer = attribute?.initializer;
        if (initializer && ts.isStringLiteral(initializer)) found.push(initializer.text);
        else {
          const mapped =
            initializer &&
            ts.isJsxExpression(initializer) &&
            initializer.expression &&
            ts.isPropertyAccessExpression(initializer.expression) &&
            initializer.expression.name.text === 'value'
              ? mappedArray(node)
              : undefined;
          if (mapped) found.push(...mapped);
          else unresolved.push(`${file}: make the TabsTrigger value literal so the audit can open the tab`);
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
    if (found.length) values.set(file, found);
  }
  return { values, unresolved };
}

/** The tab values the inventories name per component: page tab sets and dialog tab sets. */
function inventoriedTabs(
  pageSets: readonly PageTabSet[],
  dialogs: Readonly<Record<string, DialogInventoryEntry>>,
): Map<string, Set<string>> {
  const tabs = new Map<string, Set<string>>();
  const add = (file: string, values: readonly string[]): void => {
    const set = tabs.get(file) ?? new Set<string>();
    for (const value of values) set.add(value);
    tabs.set(file, set);
  };
  for (const set of pageSets) add(set.component, set.tabs);
  for (const [key, entry] of Object.entries(dialogs)) {
    if (!('audits' in entry)) continue;
    for (const audit of entry.audits) if (audit.tabs) add(key.slice(0, key.indexOf('#')), audit.tabs);
  }
  return tabs;
}

function tabInventoryProblems(
  scanned: Map<string, string[]>,
  inventoried: Map<string, Set<string>>,
): string[] {
  const problems: string[] = [];
  for (const [file, values] of scanned) {
    const known = inventoried.get(file) ?? new Set<string>();
    for (const value of new Set(values))
      if (!known.has(value)) problems.push(`${file}: tab "${value}" is missing from the tab inventory`);
  }
  for (const [file, values] of inventoried) {
    const present = new Set(scanned.get(file) ?? []);
    for (const value of values)
      if (!present.has(value)) problems.push(`${file}: inventoried tab "${value}" no longer exists`);
  }
  return problems;
}

test('every in-page tab set is inventoried with each of its values', () => {
  const { values, unresolved } = scanTabTriggers(readProductSources(resolve(import.meta.dir, '../../..')));
  expect(unresolved).toEqual([]);
  expect(values.size).toBeGreaterThan(5);
  expect(tabInventoryProblems(values, inventoriedTabs(PAGE_TAB_SETS, DIALOG_INVENTORY))).toEqual([]);
});

test('every page tab set sits on an inventoried page of its role', () => {
  const admin = new Set<string>([...MANAGER_PHONE_ROUTES, ...DYNAMIC_PHONE_ROUTES]);
  const employee = new Set<string>(EMPLOYEE_PHONE_ROUTES);
  for (const set of PAGE_TAB_SETS)
    expect((set.role === 'admin' ? admin : employee).has(set.route)).toBe(true);
});

// Planted defect: a new tab on the maintenance page and an unresolvable value are reported.
test('a new tab value and a computed value are reported', () => {
  const { values, unresolved } = scanTabTriggers(
    new Map([
      [
        'components/service/maintenance-content.tsx',
        'const T = [{ value: "due" }, { value: "plans" }]; function M(){ return <><TabsTrigger value="archiv"/>{T.map((tab) => <TabsTrigger key={tab.value} value={tab.value}/>)}<TabsTrigger value={current}/></> }',
      ],
    ]),
  );
  expect(unresolved).toEqual([
    'components/service/maintenance-content.tsx: make the TabsTrigger value literal so the audit can open the tab',
  ]);
  expect(
    tabInventoryProblems(
      values,
      new Map([['components/service/maintenance-content.tsx', new Set(['due', 'plans', 'coverages'])]]),
    ),
  ).toEqual([
    'components/service/maintenance-content.tsx: tab "archiv" is missing from the tab inventory',
    'components/service/maintenance-content.tsx: inventoried tab "coverages" no longer exists',
  ]);
});
