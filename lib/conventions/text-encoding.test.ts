import { expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dir, '../..');

test('UI and browser locators retain valid UTF-8 and German characters', () => {
  const problems: string[] = [];
  const decoder = new TextDecoder('utf-8', { fatal: true });
  // UTF-8 bytes decoded as Windows-1252 corrupt umlauts and punctuation.
  const mojibake = /\u00c3[\u00a4\u00b6\u00bc\u0178]|\u00e2\u20ac|\ufffd/u;
  for (const directory of ['app', 'components', 'tests']) {
    for (const name of readdirSync(resolve(root, directory), { recursive: true, encoding: 'utf8' })) {
      if (!/\.tsx?$/.test(name)) continue;
      const file = `${directory}/${name}`;
      try {
        if (mojibake.test(decoder.decode(readFileSync(resolve(root, file))))) problems.push(file);
      } catch {
        problems.push(`${file}: invalid UTF-8`);
      }
    }
  }
  expect(problems, 'Save source as UTF-8; broken German labels also break exact browser locators.').toEqual(
    [],
  );
});
