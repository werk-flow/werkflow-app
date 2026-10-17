import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { repositoryRoot } from './product-sources';
import {
  countTypeAssertions,
  listLintedTypeScriptFiles,
  readTypeAssertionRatchet,
  TYPE_ASSERTION_RATCHET_FILE,
  typeAssertionRatchetProblems,
} from './type-assertions';

// Tier 2 for the type-assertion ratchet: `@typescript-eslint/consistent-type-assertions`
// is off only for the files in eslint-rules/type-assertion-ratchet.json, so
// this test holds each listed count to the code. A count may only fall, and
// the entry falls with it.

describe('type-assertion ratchet', () => {
  test('every listed file carries exactly its recorded number of type assertions', () => {
    const ratchet = readTypeAssertionRatchet();
    const linted = new Set(listLintedTypeScriptFiles());
    const counts = new Map(
      Object.keys(ratchet).map((file) => [
        file,
        linted.has(file)
          ? countTypeAssertions(file, readFileSync(resolve(repositoryRoot, file), 'utf8'))
          : undefined,
      ]),
    );
    expect(
      typeAssertionRatchetProblems(ratchet, counts),
      `Bring ${TYPE_ASSERTION_RATCHET_FILE} in line with the code; the list only shrinks.`,
    ).toEqual([]);
  });

  test('the count matches the lint rule: every assertion but `as const`', () => {
    const source = [
      'const a = value as number;',
      'const b = <string>value;',
      'const c = (value as unknown) as Row;',
      "const d = ['x', 'y'] as const;",
      'const e = <const>{ kind: 1 };',
      'const f = value satisfies Row;',
    ].join('\n');
    expect(countTypeAssertions('probe.ts', source)).toBe(4);
    expect(countTypeAssertions('probe.tsx', 'export const P = () => <div>{value as string}</div>;')).toBe(1);
  });

  test('a grown, a shrunk, an emptied and a vanished entry each fail; a matching one passes', () => {
    const ratchet = {
      'lib/grown.ts': 2,
      'lib/shrunk.ts': 3,
      'lib/empty.ts': 1,
      'lib/gone.ts': 1,
      'lib/kept.ts': 2,
    };
    const counts = new Map<string, number | undefined>([
      ['lib/grown.ts', 3],
      ['lib/shrunk.ts', 1],
      ['lib/empty.ts', 0],
      ['lib/gone.ts', undefined],
      ['lib/kept.ts', 2],
    ]);
    expect(typeAssertionRatchetProblems(ratchet, counts)).toEqual([
      'lib/grown.ts: 3 type assertions, 2 recorded; parse, narrow or type the value instead.',
      'lib/shrunk.ts: 1 type assertions, 3 recorded; lower the entry.',
      'lib/empty.ts: no type assertion left; remove the entry.',
      'lib/gone.ts: listed but gone; remove the entry.',
    ]);
  });
});
