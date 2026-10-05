import { expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';

// `Card` brings its own vertical padding (py-6) and gap. A Card whose direct
// child pads itself on every side (p-4, p-5 …) stacks both: the handover card
// and others opened with a blank band above their title (rendered review of
// 2026-10-02). Such a card either drops its own padding (py-0 gap-0) or uses
// CardHeader / CardContent.

const root = resolve(import.meta.dir, '../..');

function classNameOf(element: ts.JsxOpeningElement | ts.JsxSelfClosingElement): string {
  for (const attribute of element.attributes.properties) {
    if (!ts.isJsxAttribute(attribute) || attribute.name.getText() !== 'className') continue;
    const initializer = attribute.initializer;
    if (!initializer) return '';
    if (ts.isStringLiteral(initializer)) return initializer.text;
    return initializer.getText();
  }
  return '';
}

function doublePaddedCards(file: string): string[] {
  const text = readFileSync(resolve(root, file), 'utf8');
  if (!text.includes('<Card')) return [];
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const offenders: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText() === 'Card') {
      const cardClass = classNameOf(node.openingElement);
      const cardKeepsPadding = !/(^|[\s'"`])(py-0|p-0)(?=[\s'"`]|$)/.test(cardClass);
      const firstChild = node.children.find(
        (child) => ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child),
      );
      if (cardKeepsPadding && firstChild) {
        const opening = ts.isJsxElement(firstChild)
          ? firstChild.openingElement
          : (firstChild as ts.JsxSelfClosingElement);
        const childClass = classNameOf(opening);
        if (opening.tagName.getText() === 'div' && /(^|[\s'"`])p-\d/.test(childClass))
          offenders.push(`${file}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return offenders;
}

test('a Card does not stack its own padding on a self-padded first child', () => {
  const files = ['app', 'components'].flatMap((directory) =>
    readdirSync(resolve(root, directory), { recursive: true, encoding: 'utf8' })
      .map((name) => `${directory}/${name.replaceAll('\\', '/')}`)
      .filter((file) => file.endsWith('.tsx') && !file.startsWith('components/ui/')),
  );
  expect(files.flatMap(doublePaddedCards)).toEqual([]);
});
