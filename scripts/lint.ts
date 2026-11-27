import { resolve } from 'node:path';
import {
  BROAD_LINT_FILES,
  eslintTargets,
  lintedFileCount,
  lintRuns,
  withHeavyNodeHeap,
} from '../lib/testing/runner/heavy-command';
import { runInHeavySlot } from '../lib/testing/runner/heavy-slot';

// `bun run lint [paths...]`: eslint with no warnings allowed. A lint of more
// than BROAD_LINT_FILES files, the whole repository by default, takes a heavy
// slot (lib/testing/runner/heavy-slot.ts); a lint of a few files runs at once.
// The whole repository lints in parts, one eslint process each (lintRuns).
const args = process.argv.slice(2);
const { runs, heapMb } = lintRuns(args);
// ESLint inherits this process's environment: the same heap on every machine.
process.env.NODE_OPTIONS = withHeavyNodeHeap(process.env.NODE_OPTIONS, heapMb);
if (runs.length > 1)
  console.log(
    `[lint] ${runs.length} parts, ${heapMb} MiB heap each. A part out of heap is split in lib/testing/runner/heavy-command.ts.`,
  );
const eslint = resolve(import.meta.dir, '../node_modules/.bin/eslint');
const files = lintedFileCount(eslintTargets(args), process.cwd());
process.exit(
  await runInHeavySlot(
    runs.map((run) => [eslint, '--max-warnings', '0', ...run]),
    files > BROAD_LINT_FILES,
  ),
);
