import { expect, test } from 'bun:test';
import { repositoryRoot } from '../conventions/product-sources';

// Tier 2 beside the ESLint ban (B2): the AI SDK is reached only from lib/ai/,
// in every source file of the repository and every import form: a static or
// type import, a re-export, a dynamic import and a require.
const SDK_SPECIFIER = String.raw`(ai|ai/[^'"\x60]*|@ai-sdk/[^'"\x60]*)`;
const SDK_IMPORT = new RegExp(
  String.raw`(\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+)['"\x60]${SDK_SPECIFIER}['"\x60]`,
  'm',
);

function sdkImportLines(text: string): number[] {
  return text.split('\n').flatMap((line, index) => (SDK_IMPORT.test(line) ? [index + 1] : []));
}

test('no source file outside lib/ai/ imports the AI SDK, in any form', () => {
  const search = Bun.spawnSync(
    [
      'git',
      'grep',
      '--untracked',
      '-n',
      '-E',
      String.raw`['"\x60](ai|ai/[^'"\x60]*|@ai-sdk/[^'"\x60]*)['"\x60]`,
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
    .filter((line) => {
      const text = line.replace(/^[^:]*:\d+:/, '');
      return sdkImportLines(text).length > 0;
    });
  expect(found).toEqual([]);
});

test('every import form of the SDK is caught, and lookalike specifiers are not', () => {
  const caught = [
    "import { streamText } from 'ai';",
    "import type { LanguageModel } from 'ai';",
    "export { createAnthropic } from '@ai-sdk/anthropic';",
    "const sdk = await import('ai');",
    'const sdk = await import(`@ai-sdk/react`);',
    "const sdk = require('ai/test');",
    "import 'ai';",
  ];
  for (const line of caught) expect(sdkImportLines(line), line).toEqual([1]);
  const allowed = [
    "import { startAiTurn } from '@/lib/ai/turn';",
    "const label = 'ai';",
    "import x from './ai';",
  ];
  for (const line of allowed) expect(sdkImportLines(line), line).toEqual([]);
});
