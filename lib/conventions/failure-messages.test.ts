import { expect, test } from 'bun:test';
import ts from 'typescript';
import { listProductSources, parseProductSource } from './product-sources';

// Tier 2 for "a shared failure code needs one sentence, not N edits"
// (docs/technical/code-quality.md). A surface turns a failure code into German
// through `describeFailure` (lib/action-messages.ts), which falls back to the
// shared sentences for the codes every area can return. A direct lookup such
// as `ERROR_MESSAGES[result.error]` skips them, so a new shared code would show
// the surface's generic fallback.

/** Lines of `<...MESSAGE...>[<expression naming an error>]` lookups. */
function directLookupLines(file: string): number[] {
  const source = parseProductSource(file);
  const lines: number[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isElementAccessExpression(node) &&
      /MESSAGE/i.test(node.expression.getText(source)) &&
      /error/i.test(node.argumentExpression.getText(source))
    ) {
      lines.push(source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return lines;
}

test('a surface describes a failure code through describeFailure', () => {
  const offending = new Map<string, number[]>();
  for (const file of listProductSources(['app', 'components', 'hooks'])) {
    const lines = directLookupLines(file);
    if (lines.length > 0) offending.set(file, lines);
  }
  expect(
    [...offending].map(([file, lines]) => `${file}:${lines.join(',')}`),
    'Use describeFailure(code, areaMessages, fallback) from lib/action-messages.ts; list only the codes the area owns.',
  ).toEqual([]);
}, 60_000);
