import { execFileSync, spawn } from 'node:child_process';
import { lstatSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

// T3 Code runs this in the background after it creates a worktree (t3.json).
// It installs the locked dependencies, links the main checkout's env backups
// and Supabase CLI state, and points the worktree's own .env.local at the
// local stack. Only Node built-ins: it runs before the install.
// docs/technical/environments.md, "Work in a worktree", owns the rule that an
// agent waits for `.t3/setup-done` before it runs anything.

const worktree = resolve(import.meta.dir, '..');
const markers = join(worktree, '.t3');
const running = join(markers, 'setup-running');
const done = join(markers, 'setup-done');
const failed = join(markers, 'setup-failed');
rmSync(done, { force: true });
rmSync(failed, { force: true });
mkdirSync(markers, { recursive: true });
writeFileSync(running, `${process.pid}\n`);

let failure = '';
process.on('uncaughtExceptionMonitor', (error) => {
  failure = error.stack ?? String(error);
});
process.on('exit', (code) => {
  if (code === 0) writeFileSync(done, '');
  else writeFileSync(failed, `Setup exited with code ${code}.\n${failure}\n`);
  rmSync(running, { force: true });
});
// A cancelled setup still leaves a marker, or agents would wait forever.
let active: ReturnType<typeof spawn> | undefined;
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const)
  process.on(signal, () => {
    failure = `Cancelled by ${signal}.`;
    if (active) active.kill(signal);
    else process.exit(1);
  });

/** The main checkout: T3 names it; outside T3 it is the directory that holds the shared git directory. */
const projectRoot =
  process.env.T3CODE_PROJECT_ROOT ??
  dirname(
    execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
      cwd: worktree,
      encoding: 'utf8',
    }).trim(),
  );
if (resolve(projectRoot) === worktree)
  throw new Error('Run this in a linked worktree, not the main checkout.');

async function run(command: string, args: readonly string[]): Promise<void> {
  const child = spawn(command, args, { cwd: worktree, stdio: ['ignore', 'pipe', 'pipe'] });
  active = child;
  let output = '';
  for (const [source, target] of [
    [child.stdout, process.stdout],
    [child.stderr, process.stderr],
  ] as const)
    source.on('data', (chunk: Buffer) => {
      target.write(chunk);
      output = `${output}${chunk.toString()}`.slice(-8_000);
    });
  const code = await new Promise<number | null>((resolveExit) => child.once('close', resolveExit));
  active = undefined;
  if (code !== 0) {
    failure ||= output.trimEnd().split('\n').slice(-30).join('\n');
    process.exit(code || 1);
  }
}

await run(process.execPath, ['install', '--frozen-lockfile']);

// Links replace only links, so a real file the worktree owns always survives.
function link(path: string, kind: 'file' | 'directory'): void {
  const source = join(projectRoot, path);
  const sourceStat = lstatSync(source, { throwIfNoEntry: false });
  if (!sourceStat) return;
  if (kind === 'file' ? !sourceStat.isFile() : !sourceStat.isDirectory()) {
    process.stderr.write(`Skipping ${path}: ${source} is not a regular ${kind}.\n`);
    return;
  }
  const target = join(worktree, path);
  const existing = lstatSync(target, { throwIfNoEntry: false });
  if (existing && !existing.isSymbolicLink()) return;
  if (existing) rmSync(target);
  mkdirSync(dirname(target), { recursive: true });
  symlinkSync(source, target, kind === 'file' ? 'file' : 'dir');
}
for (const file of ['.env.local-stack-backup', '.env.dev-backup', '.env.live-backup']) link(file, 'file');
// The Supabase CLI keeps the linked DEV project there.
link('supabase/.temp', 'directory');

// The worktree's own .env.local: the local stack, with this worktree's test server as the site URL.
await run(process.execPath, ['run', 'env:local']);
