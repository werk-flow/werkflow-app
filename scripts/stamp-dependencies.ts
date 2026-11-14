import { resolve } from 'node:path';
import { writeDependencyStamp } from '../lib/testing/runner/dependency-stamp';

// The last step of `postinstall` (package.json): every `bun install` records the lockfile and the
// wholesaler-reader pin it installed from (lib/testing/runner/dependency-stamp.ts).
writeDependencyStamp(resolve(import.meta.dir, '..'));
