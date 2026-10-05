import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { listProductSources, repositoryRoot } from './product-sources';

// Tier 2 for cache-tag invalidation. `updateTag` and `revalidateTag` make
// Next.js re-render the route inside the action response. On 2026-10-01 about
// 105 of 132 calls named a tag that no cached reader carried (jobs, projects,
// personnel, ...): each paid that render and invalidated nothing. A tag exists
// in CACHE_TAGS only while a cross-request reader carries it (`unstable_cache`
// `tags` or `cacheTag`), and every invalidation names a CACHE_TAGS entry.
// A view that needs fresh data after its own write refreshes through its
// owner (realtime-and-caching.md, "Mutations refresh route-first"), not
// through a tag without a reader.

/** `CACHE_TAGS.<name>(...)` yields the name; anything else is not a registry tag. */
function registryTagName(node: ts.Node | undefined): string | null {
  if (!node || !ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return null;
  const { expression: owner, name } = node.expression;
  return ts.isIdentifier(owner) && owner.text === 'CACHE_TAGS' ? name.text : null;
}

type TagUse = { file: string; line: number; tag: string | null };

function collectTagUses(): { invalidated: TagUse[]; carried: Set<string>; registered: string[] } {
  const invalidated: TagUse[] = [];
  const carried = new Set<string>();
  let registered: string[] = [];
  for (const file of listProductSources()) {
    const text = readFileSync(resolve(repositoryRoot, file), 'utf8');
    if (!/updateTag|revalidateTag|cacheTag|unstable_cache|CACHE_TAGS\s*=/.test(text)) continue;
    const source = ts.createSourceFile(
      file,
      text,
      ts.ScriptTarget.Latest,
      true,
      file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const visit = (node: ts.Node): void => {
      ts.forEachChild(node, visit);
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.name.text === 'CACHE_TAGS' &&
        node.initializer
      ) {
        const literal = ts.isAsExpression(node.initializer) ? node.initializer.expression : node.initializer;
        if (ts.isObjectLiteralExpression(literal))
          registered = literal.properties.flatMap((property) =>
            property.name && ts.isIdentifier(property.name) ? [property.name.text] : [],
          );
      }
      if (
        ts.isPropertyAssignment(node) &&
        ts.isIdentifier(node.name) &&
        node.name.text === 'tags' &&
        ts.isArrayLiteralExpression(node.initializer)
      ) {
        for (const element of node.initializer.elements) {
          const tag = registryTagName(element);
          if (tag) carried.add(tag);
        }
      }
      if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression)) return;
      const tag = registryTagName(node.arguments[0]);
      if (node.expression.text === 'cacheTag' && tag) carried.add(tag);
      if (node.expression.text === 'updateTag' || node.expression.text === 'revalidateTag') {
        invalidated.push({ file, line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1, tag });
      }
    };
    visit(source);
  }
  return { invalidated, carried, registered };
}

test('every invalidated cache tag is carried by a cached reader', () => {
  const { invalidated, carried, registered } = collectTagUses();
  expect(registered.length, 'CACHE_TAGS was not found in lib/data/cached.ts').toBeGreaterThan(0);
  expect(carried.size, 'no cached reader was found').toBeGreaterThan(0);
  expect(
    invalidated.filter((use) => use.tag === null).map((use) => `${use.file}:${use.line}`),
    'Pass a CACHE_TAGS entry to updateTag and revalidateTag so the tag can be matched to its reader.',
  ).toEqual([]);
  expect(
    invalidated
      .filter((use) => use.tag !== null && !carried.has(use.tag))
      .map((use) => `${use.file}:${use.line} ${use.tag}`),
    'No cached reader carries this tag: the call only re-renders the route. Remove it and refresh the view through its owner, or add the cached reader first.',
  ).toEqual([]);
  expect(
    registered.filter((tag) => !carried.has(tag)),
    'These CACHE_TAGS entries have no cached reader; remove them.',
  ).toEqual([]);
});
