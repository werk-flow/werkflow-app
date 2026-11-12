import { resolve } from 'node:path';
import { writeDependencyStamp } from '../lib/testing/runner/dependency-stamp';

// The `postinstall` of package.json: every `bun install` records the lockfile it installed from
// (lib/testing/runner/dependency-stamp.ts).
writeDependencyStamp(resolve(import.meta.dir, '..'));
