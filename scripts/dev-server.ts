import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { workspacePorts } from '../lib/testing/runner/app-port';

// `bun run dev`: next dev on this checkout's dev port, so parallel worktrees serve side by side.
const repositoryRoot = resolve(import.meta.dir, '..');
const child = spawn(
  'node',
  [
    resolve(repositoryRoot, 'node_modules/next/dist/bin/next'),
    'dev',
    '--port',
    String(workspacePorts(repositoryRoot).dev),
    ...process.argv.slice(2),
  ],
  { cwd: repositoryRoot, stdio: 'inherit' },
);
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => child.kill(signal));
child.once('exit', (code) => process.exit(code ?? 1));
