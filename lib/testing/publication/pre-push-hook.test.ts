// Rule test: git runs .githooks/pre-push on a push, which refuses unless the gate passes or the owner's override is logged.
import { afterAll, beforeAll, expect, test } from 'bun:test';
import {
  accessSync,
  chmodSync,
  constants,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';

// Every assertion on a child's exit code carries the child's output, so a
// failure names its cause (a refused gate, an unwritable log, a locked ref).

/**
 * Drives the real hook and scripts/pre-push.ts through a real `git push` into a bare repository,
 * with a stub in place of scripts/check-publication-gate.ts, so the hook's own exit codes and its
 * override log are proven (audit finding B11, 2026-10-16: changing an `exit 1` of the hook failed
 * no check).
 */
const repository = resolve(import.meta.dir, '../../..');
const hook = readFileSync(join(repository, '.githooks/pre-push'), 'utf8');
const hookScript = readFileSync(join(repository, 'scripts/pre-push.ts'), 'utf8');
let root = '';
let work = '';

interface RunOptions {
  cwd: string;
  env?: Record<string, string>;
  /** The child's whole PATH; the default puts the test's own Bun before the inherited one. */
  path?: string;
  stdin?: string;
}

function run(command: string[], options: RunOptions) {
  const environment: Record<string, string | undefined> = { ...process.env, ...options.env };
  if (!options.env?.WERKFLOW_PUSH_OVERRIDE) delete environment.WERKFLOW_PUSH_OVERRIDE;
  // The hook calls `bun`; the test's own Bun comes first on the path.
  environment.PATH = options.path ?? `${dirname(process.execPath)}${delimiter}${process.env.PATH ?? ''}`;
  const result = Bun.spawnSync({
    cmd: command,
    cwd: options.cwd,
    env: environment,
    stdin: options.stdin === undefined ? 'ignore' : new TextEncoder().encode(options.stdin),
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
  writeFileSync(join(work, 'scripts/pre-push.ts'), hookScript);
  writeFileSync(
    join(work, 'scripts/check-publication-gate.ts'),
    "const code = Number(await Bun.file('gate-exit').text());\nawait Bun.write('gate-refs', await Bun.stdin.text());\nconsole.log(code === 0 ? 'gate open' : 'gate closed');\nprocess.exit(code);\n",
  );
  writeFileSync(join(work, '.gitignore'), 'gate-exit\ngate-refs\n.agent-logs/\n');
  git('add', '.');
  git('commit', '-q', '-m', 'hook under test');
});

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

test('a push goes through only when the gate passes', () => {
  nextCommit('first');
  const refused = push(1);
  expect(refused.exitCode, refused.output).not.toBe(0);
  expect(refused.output).toContain('gate closed');
  const passed = push(0);
  expect(passed.exitCode, passed.output).toBe(0);
  // git's ref list reaches the gate unchanged.
  expect(readFileSync(join(work, 'gate-refs'), 'utf8')).toContain('refs/heads/partner-preview');
});

test('the owner override passes a refused push only with a log line naming the commit and the reason', () => {
  nextCommit('second');
  const overridden = push(1, { WERKFLOW_PUSH_OVERRIDE: 'owner release\tafter review' });
  expect(overridden.exitCode, overridden.output).toBe(0);
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
  expect(refused.exitCode, refused.output).not.toBe(0);
  expect(refused.output).toContain('Owner override refused');
  rmSync(join(work, '.agent-logs'), { force: true });
});

/**
 * The hook once called cat, tr, mkdir and date, which a shell with a minimal PATH does not reach,
 * so its override failed there. The hook runs here with a PATH of only Bun's and git's directories.
 */
test('the hook and its override need nothing on the path but bun and git', () => {
  nextCommit('fourth');
  const shell = '/bin/sh';
  writeFileSync(join(work, 'gate-exit'), '1');
  const overridden = run([shell, '.githooks/pre-push', 'origin', join(root, 'remote.git')], {
    cwd: work,
    env: { WERKFLOW_PUSH_OVERRIDE: 'owner release' },
    path: `${dirname(process.execPath)}${delimiter}${dirname(Bun.which('git') ?? 'git')}`,
    stdin: 'refs/heads/main 1 refs/heads/partner-preview 0\n',
  });
  expect(overridden.exitCode, overridden.output).toBe(0);
  const log = readFileSync(join(work, '.agent-logs/review/overrides.log'), 'utf8').trim().split('\n');
  const head = run(['git', 'rev-parse', 'HEAD'], { cwd: work }).output.trim();
  expect((log.at(-1) ?? '').split('\t').slice(1)).toEqual([head, 'owner release', 'gate closed']);
});

// Git skips a hook that lacks the executable bit and pushes anyway, with only a hint; the
// Windows checkout never recorded the bit, so the first Linux push ran without the gate.
test('the pre-push hook is committed executable, so git runs it', () => {
  const entry = run(['git', 'ls-files', '--stage', '.githooks/pre-push'], { cwd: repository }).output;
  expect(entry.startsWith('100755'), entry).toBe(true);
  expect(() => accessSync(join(repository, '.githooks/pre-push'), constants.X_OK)).not.toThrow();
});
