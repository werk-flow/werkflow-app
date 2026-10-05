import { expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// A primitive's checked, open or active fill comes from a token that flips by
// itself in dark mode. A `dark:data-[state=…]` copy of that fill outranks the
// caller's `data-[state=…]` override in dark mode only: the calendar's purple
// „Termine“ checkbox turned orange in dark mode (rendered review of 2026-10-02).

const directory = resolve(import.meta.dir, '../../components/ui');

test('primitives style their states once for both themes', () => {
  const offenders = readdirSync(directory)
    .filter((name) => name.endsWith('.tsx'))
    .flatMap((name) =>
      [
        ...readFileSync(resolve(directory, name), 'utf8').matchAll(/dark:data-\[state=[^\]]+\]:[^\s'"`]+/g),
      ].map((match) => `components/ui/${name}: ${match[0]}`),
    );
  expect(offenders).toEqual([]);
});
