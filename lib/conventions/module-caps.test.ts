import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { listProductSources, repositoryRoot } from './product-sources';

// Tier 2 for "size limits have no exception" (AGENTS.md "4. Code quality and
// maintainability"). The limits in eslint-rules/size-caps.mjs apply to every
// product file through max-lines and max-lines-per-function. A suppression
// with a reason would pass the lint gate, so this test refuses any directive
// that names a size rule: an oversized file or function is split instead.

const SIZE_RULE_DIRECTIVE = /eslint-disable(?:-next-line|-line)?\b[^\n]*\bmax-lines(?:-per-function)?\b/;

test('no product file switches a size limit off', () => {
  const offenders = listProductSources().filter((file) =>
    SIZE_RULE_DIRECTIVE.test(readFileSync(resolve(repositoryRoot, file), 'utf8')),
  );
  expect(offenders, 'Split the file or function instead of disabling max-lines.').toEqual([]);
});
