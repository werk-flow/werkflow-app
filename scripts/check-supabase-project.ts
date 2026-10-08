import { loadEnvLocal, requireEnv } from '../tests/golden/support/env';
import {
  advisorProblems,
  advisorResponseSchema,
  authConfigProblems,
} from '../lib/security/supabase-project-checks';

/**
 * `bun run auth:check` compares DEV's Auth configuration with the reviewed
 * posture. `bun run advisors:check` runs DEV's security and performance
 * advisors against the reviewed exceptions. Both only read, both read DEV
 * only, and neither prints a configuration value outside the reviewed keys.
 * A request that fails leaves the check unverified, never passed.
 */
const DEV_PROJECT_REF = 'mbkkzuqjbdvzelqvuzcn';
const API = `https://api.supabase.com/v1/projects/${DEV_PROJECT_REF}`;

async function readDev(path: string): Promise<unknown> {
  const response = await fetch(`${API}/${path}`, {
    headers: { Authorization: `Bearer ${requireEnv('SUPABASE_ACCESS_TOKEN')}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`GET ${path} returned HTTP ${response.status}.`);
  return response.json();
}

async function problemsFor(mode: string): Promise<string[]> {
  if (mode === 'auth') {
    const config = await readDev('config/auth');
    if (!config || typeof config !== 'object') throw new Error('The Auth configuration is not an object.');
    return authConfigProblems(config as Record<string, unknown>);
  }
  if (mode === 'advisors') {
    const [security, performance] = await Promise.all([
      readDev('advisors/security'),
      readDev('advisors/performance'),
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
