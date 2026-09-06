import { existsSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { withWorkspaceTestLock } from '../lib/testing/workspace-test-lock';

// Every file argument runs, in order, each in its own psql session. The group
// registry may therefore declare several files for one SQL group; a file that
// is declared but never executed cannot masquerade as proof.
const assertionFiles = (process.argv.length > 2
  ? process.argv.slice(2)
  : ['supabase/tests/p1_21_time_segments.sql']
).map((file) => resolve(process.cwd(), file));

for (const assertionFile of assertionFiles) {
  if (!existsSync(assertionFile)) {
    throw new Error(`SQL assertion file does not exist: ${assertionFile}`);
  }
}

const dockerCommand = [
  'docker',
  'exec',
  '-i',
  'supabase_db_werkflow-app',
  'psql',
  '-U',
  'postgres',
  '-d',
  'postgres',
  '-v',
  'ON_ERROR_STOP=1',
];
const command =
  process.platform === 'win32' ? ['wsl', ...dockerCommand] : dockerCommand;

export async function runSqlAssertionFile(assertionFile: string): Promise<void> {
  const child = Bun.spawn(command, {
    stdin: Bun.file(assertionFile),
    stdout: 'inherit',
    stderr: 'inherit',
  });
  const exitCode = await child.exited;
  if (exitCode !== 0) {
    throw new Error(`SQL assertions failed with exit code ${exitCode}: ${basename(assertionFile)}`);
  }
  console.log(`[test:sql:${basename(assertionFile, '.sql')}] passed — ${assertionFile}`);
}

await withWorkspaceTestLock(
  { operation: `SQL assertions ${assertionFiles.map((file) => basename(file)).join(', ')}` },
  async () => {
    for (const assertionFile of assertionFiles) {
      await runSqlAssertionFile(assertionFile);
    }
  }
);
