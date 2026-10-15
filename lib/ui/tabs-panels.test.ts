// Rule test: a tab set without TabsContent panels declares panels={false}, so its tabs point at no missing panel.
import { expect, test } from 'bun:test';
import { resolve } from 'node:path';
import ts from 'typescript';
import { readProductSources } from './dialog-discovery';

/** Files under app/ and components/ (registry excluded) whose Tabs root renders no panel and lacks panels={false}. */
function panelLessTabSets(files: ReadonlyMap<string, string>): string[] {
  const problems: string[] = [];
  for (const [file, text] of files) {
    if (file.startsWith('components/ui/') || !file.endsWith('.tsx') || !text.includes('<Tabs')) continue;
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const roots: (ts.JsxOpeningElement | ts.JsxSelfClosingElement)[] = [];
    let panels = 0;
    function visit(node: ts.Node): void {
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const name = node.tagName.getText();
        if (name === 'Tabs') roots.push(node);
        if (name === 'TabsContent') panels += 1;
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
    if (panels > 0) continue;
    for (const root of roots) {
      const declared = root.attributes.properties.some(
        (property) =>
          ts.isJsxAttribute(property) &&
          property.name.getText() === 'panels' &&
          property.initializer !== undefined &&
          ts.isJsxExpression(property.initializer) &&
          property.initializer.expression?.kind === ts.SyntaxKind.FalseKeyword,
      );
      if (!declared) problems.push(`${file}: a Tabs root without TabsContent panels declares panels={false}`);
    }
  }
  return problems;
}

test('every tab set that renders no panel says so', () => {
  expect(panelLessTabSets(readProductSources(resolve(import.meta.dir, '../..')))).toEqual([]);
});

// Planted defect: a filter tab set without panels and without the prop is reported; with it, or with panels, it passes.
test('a panel-less tab set without panels={false} is reported', () => {
  const source = (prop: string, body = '') =>
    `export const P = () => <Tabs ${prop} value="a"><TabsList><TabsTrigger value="a">A</TabsTrigger></TabsList>${body}</Tabs>;`;
  expect(panelLessTabSets(new Map([['components/kunden/probe.tsx', source('')]]))).toEqual([
    'components/kunden/probe.tsx: a Tabs root without TabsContent panels declares panels={false}',
  ]);
  expect(panelLessTabSets(new Map([['components/kunden/probe.tsx', source('panels={false}')]]))).toEqual([]);
  expect(
    panelLessTabSets(new Map([['components/kunden/probe.tsx', source('', '<TabsContent value="a"/>')]])),
  ).toEqual([]);
});
