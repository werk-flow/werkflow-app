import { resolve } from 'node:path';
import { BROAD_LINT_FILES, eslintTargets, lintedFileCount } from '../lib/testing/runner/heavy-command';
import { runInHeavySlot } from '../lib/testing/runner/heavy-slot';

// `bun run lint [paths...]`: eslint with no warnings allowed. A lint of more
// than BROAD_LINT_FILES files, the whole repository by default, takes a heavy
// slot (lib/testing/runner/heavy-slot.ts); a lint of a few files runs at once.
const args = process.argv.slice(2);
const files = lintedFileCount(eslintTargets(args), process.cwd());
process.exit(
  await runInHeavySlot(
    [resolve(import.meta.dir, '../node_modules/.bin/eslint'), '--max-warnings', '0', ...args],
    files > BROAD_LINT_FILES,
  ),
);
