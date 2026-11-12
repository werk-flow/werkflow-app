import { resolve } from 'node:path';
import { dependencyStampProblem } from '../lib/testing/runner/dependency-stamp';

// Preloaded by `check:changed`, `test:verify` and `test:plan` (package.json): it runs before
// their modules import a package, so a dependency `main` added and this worktree lacks stops the
// command with its cause instead of a missing-module error (lib/testing/runner/dependency-stamp.ts).
// It imports Node built-ins only. It refuses rather than installs: an install inside a check would
// change node_modules under another process of this checkout, such as a test server.
const problem = dependencyStampProblem(resolve(import.meta.dir, '..'));
if (problem) {
  console.error(`[dependencies] ${problem}`);
  process.exit(1);
}
