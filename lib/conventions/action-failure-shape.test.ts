import { expect, test } from 'bun:test';
import ts from 'typescript';
import { listProductSources, parseProductSource } from './product-sources';

// Tier 2 for "one failure shape" (docs/technical/code-quality.md). Every
// Server Action and reader fails with `ActionFailure` from lib/action-result.ts.
// A hand-written `{ success: false; ... }` type literal is a second failure
// shape: a richer failure intersects `ActionFailure<Code>` with its extra
// fields instead.

const FAILURE_SHAPE_HOME = 'lib/action-result.ts';

/** Lines of type literals that declare `success: false`. */
function failureLiteralLines(file: string): number[] {
  const source = parseProductSource(file);
  const lines: number[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isTypeLiteralNode(node) &&
      node.members.some(
        (member) =>
          ts.isPropertySignature(member) &&
          member.name.getText(source) === 'success' &&
          member.type !== undefined &&
          ts.isLiteralTypeNode(member.type) &&
          member.type.literal.kind === ts.SyntaxKind.FalseKeyword,
      )
    ) {
      lines.push(source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return lines;
}

test('a failure result uses ActionFailure instead of a hand-written success: false literal', () => {
  const declaring: string[] = [];
  for (const file of listProductSources()) {
    if (file === FAILURE_SHAPE_HOME) continue;
    const lines = failureLiteralLines(file);
    if (lines.length > 0) declaring.push(`${file}:${lines.join(',')}`);
  }
  expect(
    declaring,
    'Type the failure as ActionFailure or ActionResult<Data> from lib/action-result.ts; a richer failure is `ActionFailure<Code> & { extra: T }`.',
  ).toEqual([]);
}, 60_000);
