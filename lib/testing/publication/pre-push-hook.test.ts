// Rule test: git runs .githooks/pre-push on a push, which refuses unless the gate passes or the owner's override is logged.
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';

/**
 * Drives the real hook through a real `git push` into a bare repository, with a stub in place of
 * scripts/check-publication-gate.ts, so the hook's own exit codes and its override log are proven
 * (audit finding B11, 2026-10-16: changing an `exit 1` of the hook failed no check).
 */
const hook = readFileSync(resolve(import.meta.dir, '../../../.githooks/pre-push'), 'utf8');
let root = '';
let work = '';

function run(command: string[], options: { cwd: string; env?: Record<string, string> }) {
  const environment: Record<string, string | undefined> = { ...process.env, ...options.env };
  if (!options.env?.WERKFLOW_PUSH_OVERRIDE) delete environment.WERKFLOW_PUSH_OVERRIDE;
  // The hook calls `bun`; the test's own Bun comes first on the path.
  environment.PATH = `${dirname(process.execPath)}${delimiter}${process.env.PATH ?? ''}`;
  const result = Bun.spawnSync({
    cmd: command,
    cwd: options.cwd,
    env: environment,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  return { exitCode: result.exitCode, output: `${result.stdout.toString()}${result.stderr.toString()}` };
}

function git(...args: string[]): void {
  const result = run(['git', ...args], { cwd: work });
  if (result.exitCode !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.output}`);
}

/** Commits one more change, so every push publishes something new. */
function nextCommit(label: string): void {
  writeFileSync(join(work, 'change.txt'), label);
  git('add', 'change.txt');
  git('commit', '-q', '-m', label);
}

function push(gateExit: number, env: Record<string, string> = {}) {
  writeFileSync(join(work, 'gate-exit'), String(gateExit));
  return run(['git', 'push', '-q', 'origin', 'HEAD:refs/heads/partner-preview'], { cwd: work, env });
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'pre-push-hook-'));
  work = join(root, 'work');
  mkdirSync(join(work, '.githooks'), { recursive: true });
  mkdirSync(join(work, 'scripts'), { recursive: true });
  run(['git', 'init', '-q', '--bare', join(root, 'remote.git')], { cwd: root });
  run(['git', 'init', '-q'], { cwd: work });
  git('config', 'user.email', 'hook-test@example.invalid');
  git('config', 'user.name', 'Hook test');
  git('config', 'core.hooksPath', '.githooks');
  git('remote', 'add', 'origin', join(root, 'remote.git'));
  writeFileSync(join(work, '.githooks/pre-push'), hook);
  chmodSync(join(work, '.githooks/pre-push'), 0o755);
  writeFileSync(
    join(work, 'scripts/check-publication-gate.ts'),
    "const code = Number(await Bun.file('gate-exit').text());\nawait Bun.stdin.text();\nconsole.log(code === 0 ? 'gate open' : 'gate closed');\nprocess.exit(code);\n",
  );
  writeFileSync(join(work, '.gitignore'), 'gate-exit\n.agent-logs/\n');
  git('add', '.');
  git('commit', '-q', '-m', 'hook under test');
});

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

test('a push goes through only when the gate passes', () => {
  nextCommit('first');
  const refused = push(1);
  expect(refused.exitCode).not.toBe(0);
  expect(refused.output).toContain('gate closed');
  const passed = push(0);
  expect(passed.exitCode).toBe(0);
});

test('the owner override passes a refused push only with a log line naming the commit and the reason', () => {
  nextCommit('second');
  const overridden = push(1, { WERKFLOW_PUSH_OVERRIDE: 'owner release\tafter review' });
  expect(overridden.exitCode).toBe(0);
  const log = readFileSync(join(work, '.agent-logs/review/overrides.log'), 'utf8').trim().split('\n');
  const head = run(['git', 'rev-parse', 'HEAD'], { cwd: work }).output.trim();
  const [, commit, reason, gateOutput] = (log.at(-1) ?? '').split('\t');
  expect(commit).toBe(head);
  expect(reason).toBe('owner release after review');
  expect(gateOutput).toContain('gate closed');
});

test('an override that cannot be logged is refused', () => {
  nextCommit('third');
  rmSync(join(work, '.agent-logs'), { recursive: true, force: true });
  // A file where the log folder belongs makes the log unwritable.
  writeFileSync(join(work, '.agent-logs'), 'not a folder');
  const refused = push(1, { WERKFLOW_PUSH_OVERRIDE: 'owner release' });
  expect(refused.exitCode).not.toBe(0);
  expect(refused.output).toContain('Owner override refused');
  rmSync(join(work, '.agent-logs'), { force: true });
});
