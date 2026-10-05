import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { SHARED_FAILURE_CODES } from '@/lib/action-result';
import { SHARED_FAILURE_MESSAGES, describeFailure } from '@/lib/action-messages';
import { listProductSources, parseProductSource, repositoryRoot } from '@/lib/conventions/product-sources';

test('every shared failure code has one German sentence', () => {
  for (const code of SHARED_FAILURE_CODES) {
    const message = SHARED_FAILURE_MESSAGES[code];
    expect(message, code).toMatch(/^\p{Lu}.*[.!?]$/u);
    expect(message, `${code} must not echo the code`).not.toContain(code);
  }
  expect(Object.keys(SHARED_FAILURE_MESSAGES).sort()).toEqual([...SHARED_FAILURE_CODES].sort());
});

test('the area wording wins, then the shared sentence, then the fallback', () => {
  const areaMessages = { invalid_input: 'Bitte gib einen Namen ein.', name_taken: 'Der Name ist vergeben.' };
  expect(describeFailure('invalid_input', areaMessages, 'Fehler.')).toBe('Bitte gib einen Namen ein.');
  expect(describeFailure('name_taken', areaMessages, 'Fehler.')).toBe('Der Name ist vergeben.');
  expect(describeFailure('period_closed', areaMessages, 'Fehler.')).toBe(
    SHARED_FAILURE_MESSAGES.period_closed,
  );
  expect(describeFailure('insert_failed', areaMessages, 'Fehler.')).toBe('Fehler.');
  // An inherited object key is not a message.
  expect(describeFailure('toString', {}, 'Fehler.')).toBe('Fehler.');
});

// Tier 2 against dead failure mappings: a code that a message map translates
// must be named somewhere outside the message maps, by an action, a client
// check or a database function. A code that only the maps name can no longer
// reach the user, and its sentence misleads the next reader.
const MESSAGE_MAP_NAME = /messages|labels/i;
const CODE_KEY = /^[a-z]+(?:_[a-z0-9]+)+$/;

function messageMapKeys(file: string, text: string): string[] {
  const source = parseProductSource(file, text);
  const keys: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      node.initializer &&
      MESSAGE_MAP_NAME.test(node.name.getText(source))
    ) {
      let initializer: ts.Expression = node.initializer;
      while (
        ts.isSatisfiesExpression(initializer) ||
        ts.isAsExpression(initializer) ||
        ts.isParenthesizedExpression(initializer)
      ) {
        initializer = initializer.expression;
      }
      if (ts.isObjectLiteralExpression(initializer)) {
        for (const property of initializer.properties) {
          if (!ts.isPropertyAssignment(property)) continue;
          const key = property.name.getText(source).replace(/['"]/g, '');
          if (CODE_KEY.test(key)) keys.push(key);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return keys;
}

/** Git searches the working tree, untracked files included; reading every file is several times slower. */
function gitGrep(args: readonly string[]): string[] {
  const search = Bun.spawnSync(
    ['git', 'grep', '--untracked', ...args, '--', 'app', 'components', 'hooks', 'lib', 'supabase/migrations'],
    { cwd: repositoryRoot },
  );
  // Exit code 1 means no match; anything else is a failed search, never an empty result.
  if (search.exitCode !== 0 && search.exitCode !== 1)
    throw new Error(`git grep failed: ${search.stderr.toString()}`);
  return search.stdout.toString().split(/\r?\n/).filter(Boolean);
}

test('every code a message map translates is still named outside the message maps', () => {
  const productSources = new Set(listProductSources());
  const inScope = (file: string): boolean =>
    productSources.has(file) || file.startsWith('supabase/migrations/');

  // Every snake_case word with the files that name it.
  const namedIn = new Map<string, Set<string>>();
  for (const line of gitGrep(['-o', '-w', '-E', '[a-z]+(_[a-z0-9]+)+'])) {
    const separator = line.lastIndexOf(':');
    const file = line.slice(0, separator);
    if (!inScope(file)) continue;
    const word = line.slice(separator + 1);
    namedIn.set(word, (namedIn.get(word) ?? new Set()).add(file));
  }

  const homes = new Map<string, Set<string>>();
  const mapFiles = gitGrep(['-l', '-i', '-E', '(const|let) +[a-z_]*(messages|labels)[a-z_]* *[:=]']);
  for (const file of mapFiles.filter((path) => productSources.has(path))) {
    const text = readFileSync(resolve(repositoryRoot, file), 'utf8');
    for (const key of messageMapKeys(file, text)) homes.set(key, (homes.get(key) ?? new Set()).add(file));
  }

  const unnamed = [...homes]
    .filter(([code, files]) => [...(namedIn.get(code) ?? [])].every((file) => files.has(file)))
    .map(([code, files]) => `${code} (${[...files].join(', ')})`)
    .sort();
  expect(unnamed, 'No action returns these codes any more; remove them from the message map.').toEqual([]);
}, 20_000);
