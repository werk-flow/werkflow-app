import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { repositoryRoot } from '../conventions/product-sources';

// Tier 2 beside the ESLint ban (B2): the AI SDK is reached only from lib/ai/,
// in every source file of the repository and every import form: a static or
// type import, a re-export, an import type, a dynamic import and a require,
// each also spread over several lines.
const SDK_SPECIFIER = /^(ai|ai\/.*|@ai-sdk\/.*)$/;

function specifierOf(node: ts.Node): ts.Expression | ts.TypeNode | undefined {
  if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return node.moduleSpecifier;
  if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
    return node.moduleReference.expression;
  }
  if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) return node.argument.literal;
  if (!ts.isCallExpression(node)) return undefined;
  const callee = node.expression;
  const isLoader =
    callee.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(callee) && callee.text === 'require');
  return isLoader ? node.arguments[0] : undefined;
}

/** The lines that load the AI SDK in one source text. */
function sdkImportLines(fileName: string, text: string): number[] {
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
  const lines: number[] = [];
  const visit = (node: ts.Node): void => {
    const specifier = specifierOf(node);
    if (
      specifier &&
      (ts.isStringLiteral(specifier) || ts.isNoSubstitutionTemplateLiteral(specifier)) &&
      SDK_SPECIFIER.test(specifier.text)
    ) {
      lines.push(source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return lines;
}

test('no source file outside lib/ai/ loads the AI SDK, in any form', () => {
  // Every file that names an SDK specifier in quotes at all; the parser then decides.
  const search = Bun.spawnSync(
    [
      'git',
      'grep',
      '--untracked',
      '-l',
      '-E',
      '[\'"`](ai|ai/[^\'"`]*|@ai-sdk/[^\'"`]*)[\'"`]',
      '--',
      '*.ts',
      '*.tsx',
      '*.js',
      '*.jsx',
      '*.mjs',
      '*.cjs',
      '*.mts',
      '*.cts',
      ':!lib/ai/**',
      ':!node_modules/**',
    ],
    { cwd: repositoryRoot },
  );
  expect(search.exitCode === 0 || search.exitCode === 1, search.stderr.toString()).toBe(true);
  const found = search.stdout
    .toString()
    .split('\n')
    .filter(Boolean)
    .flatMap((file) =>
      sdkImportLines(file, readFileSync(join(repositoryRoot, file), 'utf8')).map((line) => `${file}:${line}`),
    );
  expect(found).toEqual([]);
});

test('every import form of the SDK is caught, over several lines too, and lookalikes are not', () => {
  const caught = [
    "import { streamText } from 'ai';",
    "import type { LanguageModel } from 'ai';",
    "export { createAnthropic } from '@ai-sdk/anthropic';",
    "const sdk = await import('ai');",
    'const sdk = await import(`@ai-sdk/react`);',
    "const sdk = require('ai/test');",
    "import 'ai';",
    "type Model = import('ai').LanguageModel;",
    "import sdk = require('ai');",
    "const sdk = await import(\n  'ai'\n);",
    "const sdk = require(\n  '@ai-sdk/anthropic',\n);",
    "import {\n  streamText,\n} from 'ai';",
  ];
  for (const text of caught) expect(sdkImportLines('probe.ts', text), text).toHaveLength(1);
  const allowed = [
    "import { startAiTurn } from '@/lib/ai/turn';",
    "const label = 'ai';",
    "import x from './ai';",
    'const sdk = await import(name);',
  ];
  for (const text of allowed) expect(sdkImportLines('probe.ts', text), text).toEqual([]);
});
