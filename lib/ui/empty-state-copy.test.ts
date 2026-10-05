import { expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';

// EmptyState has two titles (components/ui/empty-state.tsx): an empty source
// says „Noch keine …“, a search or filter without a match says „Keine …
// gefunden“. The Arbeitsvorlagen list opened with a call to action as its
// title instead (rendered review of 2026-10-02). A prompt that asks for an
// input before anything can show is a named exception.

const root = resolve(import.meta.dir, '../..');
const PROMPT_TITLES = new Set(['Zeitraum wählen']);
const CANON_TITLE = /^(Noch kein|Kein)/;

test('a literal EmptyState title follows the two canon patterns', () => {
  const offenders: string[] = [];
  for (const directory of ['app', 'components']) {
    for (const name of readdirSync(resolve(root, directory), { recursive: true, encoding: 'utf8' })) {
      const file = `${directory}/${name.replaceAll('\\', '/')}`;
      if (!file.endsWith('.tsx')) continue;
      const text = readFileSync(resolve(root, file), 'utf8');
      if (!text.includes('<EmptyState')) continue;
      const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const visit = (node: ts.Node): void => {
        if (
          (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
          node.tagName.getText() === 'EmptyState'
        ) {
          for (const attribute of node.attributes.properties) {
            if (!ts.isJsxAttribute(attribute) || attribute.name.getText() !== 'title') continue;
            // `title={'…'}` is the same literal as `title="…"`.
            const initializer = attribute.initializer;
            const value =
              initializer && ts.isJsxExpression(initializer) ? initializer.expression : initializer;
            if (!value || !(ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value))) continue;
            if (!CANON_TITLE.test(value.text) && !PROMPT_TITLES.has(value.text))
              offenders.push(`${file}: ${value.text}`);
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
  }
  expect(offenders).toEqual([]);
});
