import { loadEnvLocal } from '../tests/golden/support/env';
import { readDevProject } from '../lib/security/dev-management-api';
import {
  advisorProblems,
  advisorResponseSchema,
  authConfigProblems,
} from '../lib/security/supabase-project-checks';
import { isJsonRecord } from '../lib/supabase/json';

/**
 * `bun run auth:check` compares DEV's Auth configuration with the reviewed
 * posture. `bun run advisors:check` runs DEV's security and performance
 * advisors against the reviewed exceptions. Both only read, both read DEV
 * only, and neither prints a configuration value outside the reviewed keys.
 * A request that fails leaves the check unverified, never passed.
 */
async function problemsFor(mode: string): Promise<string[]> {
  if (mode === 'auth') {
    const config = await readDevProject('config/auth');
    if (!isJsonRecord(config)) throw new Error('The Auth configuration is not an object.');
    return authConfigProblems(config);
  }
  if (mode === 'advisors') {
    const [security, performance] = await Promise.all([
      readDevProject('advisors/security'),
      readDevProject('advisors/performance'),
    ]);
    return advisorProblems([
      ...advisorResponseSchema.parse(security).lints,
      ...advisorResponseSchema.parse(performance).lints,
    ]);
  }
  throw new Error(`Unknown mode "${mode}". Use auth or advisors.`);
}

async function main(): Promise<void> {
  const mode = process.argv[2] ?? '';
  const label = `[${mode}:check]`;
  try {
    loadEnvLocal();
    const problems = await problemsFor(mode);
    for (const problem of problems) console.error(`${label} ${problem}`);
    console.log(`${label} DEV ${problems.length === 0 ? 'matches the reviewed state' : 'differs'}.`);
    process.exitCode = problems.length === 0 ? 0 : 1;
  } catch (error) {
    console.error(`${label} unverified: ${error instanceof Error ? error.message : 'request failed'}`);
    process.exitCode = 1;
  }
}

if (import.meta.main) void main();
