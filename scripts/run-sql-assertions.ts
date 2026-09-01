import { existsSync } from 'node:fs';
import { basename, resolve } from 'node:path';

const assertionFile = resolve(
  process.cwd(),
  process.argv[2] ?? 'supabase/tests/p1_21_time_segments.sql',
);

if (!existsSync(assertionFile)) {
  throw new Error(`SQL assertion file does not exist: ${assertionFile}`);
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

const child = Bun.spawn(command, {
  stdin: Bun.file(assertionFile),
  stdout: 'inherit',
  stderr: 'inherit',
});
const exitCode = await child.exited;
if (exitCode !== 0) {
  throw new Error(`SQL assertions failed with exit code ${exitCode}.`);
}

console.log(`[test:sql:${basename(assertionFile, '.sql')}] passed — ${assertionFile}`);
