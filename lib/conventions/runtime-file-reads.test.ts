import { expect, test } from 'bun:test';
import { createProbeLinter } from '../../eslint-rules/probe-linter.mjs';

// Rule test: Tier 2 prevention of fs reads that fail only after Turbopack bundles a Server Action.
const eslint = createProbeLinter();
const ruleId = 'quality/no-import-meta-file-read';

const unsafeReads = [
  `import { readFile } from 'node:fs/promises'; readFile(new URL('./font.ttf', import.meta.url));`,
  `import { readFileSync as read } from 'fs'; const path = new URL('./font.ttf', import.meta.url); read(path);`,
  `import * as fs from 'node:fs'; fs.createReadStream(new URL('./font.ttf', import.meta.url));`,
  `import fs from 'fs'; let path; path = new URL('./font.ttf', import.meta.url); fs.promises.readFile(path);`,
  `import { readFile } from 'fs/promises'; const path = new URL('./font.ttf', import.meta.url); const alias = path; readFile(alias);`,
];

for (const filePath of ['app/probe.ts', 'lib/probe.ts', 'components/probe.ts']) {
  test(`bundled fs reads reject import.meta.url at ${filePath}`, async () => {
    for (const source of unsafeReads) {
      const results = await eslint.lintText(source, { filePath });
      expect(
        results.flatMap((result) => result.messages).filter((message) => message.ruleId === ruleId),
      ).toHaveLength(1);
    }
  });
}

for (const filePath of ['lib/probe.test.ts', 'scripts/probe.ts', 'lib/invoicing/rules/compile.ts']) {
  test(`unbundled fs reads may use import.meta.url at ${filePath}`, async () => {
    const results = await eslint.lintText(unsafeReads[0] ?? '', { filePath });
    expect(
      results.flatMap((result) => result.messages).filter((message) => message.ruleId === ruleId),
    ).toHaveLength(0);
  });
}

test('app-root paths, ordinary URLs and unrelated readFile functions remain valid', async () => {
  for (const source of [
    `import { readFile } from 'node:fs/promises'; import { join } from 'node:path'; readFile(join(process.cwd(), 'font.ttf'));`,
    `import { readFileSync } from 'node:fs'; readFileSync(new URL('file:///font.ttf'));`,
    `function readFile(path: URL) { return path; } readFile(new URL('./font.ttf', import.meta.url));`,
    `import { readFile } from 'node:fs/promises'; function read(readFile: (path: URL) => void) { readFile(new URL('./font.ttf', import.meta.url)); }`,
  ]) {
    const results = await eslint.lintText(source, { filePath: 'lib/probe.ts' });
    expect(
      results.flatMap((result) => result.messages).filter((message) => message.ruleId === ruleId),
    ).toHaveLength(0);
  }
});
