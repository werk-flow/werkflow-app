import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { z } from '@/lib/zod';
import { parseProductSource, repositoryRoot } from './product-sources';

// The ratchet of `@typescript-eslint/consistent-type-assertions` (eslint.config.mjs):
// the rule bans every type assertion except `as const`; the files listed in
// eslint-rules/type-assertion-ratchet.json keep their recorded count until
// they are brought in line. lib/conventions/type-assertions.test.ts holds the
// list to the code.

export const TYPE_ASSERTION_RATCHET_FILE = 'eslint-rules/type-assertion-ratchet.json';

/** Repository-relative path to the number of type assertions the file may still carry. */
export type TypeAssertionRatchet = Readonly<Record<string, number>>;

function isConstAssertion(type: ts.TypeNode): boolean {
  return ts.isTypeReferenceNode(type) && ts.isIdentifier(type.typeName) && type.typeName.text === 'const';
}

/** The type assertions (`value as T`, `<T>value`) in a source, `as const` excluded, as the lint rule counts them. */
export function countTypeAssertions(file: string, text: string): number {
  let count = 0;
  const visit = (node: ts.Node): void => {
    if ((ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) && !isConstAssertion(node.type))
      count += 1;
    ts.forEachChild(node, visit);
  };
  visit(parseProductSource(file, text));
  return count;
}

/** Every TypeScript file ESLint lints: tracked or new, not ignored by git, still on disk. */
export function listLintedTypeScriptFiles(): string[] {
  const listed = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', '*.ts', '*.tsx'],
    { cwd: repositoryRoot, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
  );
  return [...new Set(listed.split('\0'))]
    .filter((file) => file && file !== 'next-env.d.ts' && existsSync(resolve(repositoryRoot, file)))
    .sort();
}

const ratchetSchema = z.record(z.string().min(1), z.number().int().positive());

export function readTypeAssertionRatchet(): TypeAssertionRatchet {
  return ratchetSchema.parse(
    JSON.parse(readFileSync(resolve(repositoryRoot, TYPE_ASSERTION_RATCHET_FILE), 'utf8')),
  );
}

/**
 * What keeps the ratchet from matching the code. `counts` holds each listed
 * file's current count, or undefined for a listed file that no longer exists.
 */
export function typeAssertionRatchetProblems(
  ratchet: TypeAssertionRatchet,
  counts: ReadonlyMap<string, number | undefined>,
): string[] {
  return Object.entries(ratchet).flatMap(([file, recorded]) => {
    const current = counts.get(file);
    if (current === undefined) return [`${file}: listed but gone; remove the entry.`];
    if (current === 0) return [`${file}: no type assertion left; remove the entry.`];
    if (current > recorded) {
      return [
        `${file}: ${current} type assertions, ${recorded} recorded; parse, narrow or type the value instead.`,
      ];
    }
    if (current < recorded)
      return [`${file}: ${current} type assertions, ${recorded} recorded; lower the entry.`];
    return [];
  });
}
