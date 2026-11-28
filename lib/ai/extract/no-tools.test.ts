import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';

import { listProductSources, repositoryRoot } from '@/lib/conventions/product-sources';

// Tier 2 for B9 of werk-flow/werkflow-planning#20: the quarantined extractor
// is a model call with no tools. No source of lib/ai/extract/ names a tool key
// of the AI SDK, and only its call module starts a model call. The replay
// suite (lib/testing/fixtures/ai-lieferschein.ts) proves the request itself.

const TOOL_KEYS = new Set(['tools', 'toolChoice', 'activeTools', 'prepareStep', 'experimental_toolCallers']);
const MODEL_CALLS = new Set(['streamText', 'generateText', 'generateObject', 'streamObject']);

/** Each tool key and model call one source names, as `<what> <name>`. */
function findings(fileName: string, text: string): string[] {
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) &&
      (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) &&
      TOOL_KEYS.has(node.name.text)
    ) {
      found.push(`tool key ${node.name.text}`);
    }
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      MODEL_CALLS.has(node.expression.text)
    ) {
      found.push(`model call ${node.expression.text}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

test('the extractor names no tool key, and only its call module starts a model call', () => {
  const sources = listProductSources(['lib']).filter((path) => path.startsWith('lib/ai/extract/'));
  expect(sources).toContain('lib/ai/extract/call.ts');
  const found = sources.flatMap((path) =>
    findings(path, readFileSync(resolve(repositoryRoot, path), 'utf8')).map((what) => `${path}: ${what}`),
  );
  expect(found).toEqual(['lib/ai/extract/call.ts: model call streamText']);
});

test('the walk finds a planted tool key in every spelling and a second model call', () => {
  const planted = [
    "streamText({ model, tools: {}, prompt: 'x' });",
    "generateText({ model, 'toolChoice': 'auto', prompt: 'x' });",
    'const activeTools = []; streamText({ model, activeTools });',
  ].join('\n');
  expect(findings('planted.ts', planted)).toEqual([
    'model call streamText',
    'tool key tools',
    'model call generateText',
    'tool key toolChoice',
    'model call streamText',
    'tool key activeTools',
  ]);
});
