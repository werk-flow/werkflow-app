// Rule test: a machine runs one local Supabase stack. `supabase start` for any other project id is
// refused (lib/testing/runner/second-stack.ts); a start that reaches the shared stack passes.
import { afterAll, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { secondStackRefusal, stackProjectId } from './second-stack';

const repositoryRoot = resolve(import.meta.dir, '../../..');
const SHARED = 'werkflow-app';
const base = mkdtempSync(join(tmpdir(), 'werkflow-second-stack-'));
afterAll(() => rmSync(base, { recursive: true, force: true }));

/** A folder with a Supabase config; `projectId` undefined leaves the id out, as a hand-written config may. */
function stackFolder(name: string, projectId?: string): string {
  const folder = join(base, name);
  mkdirSync(join(folder, 'supabase', 'migrations'), { recursive: true });
  writeFileSync(
    join(folder, 'supabase', 'config.toml'),
    `# project_id = "commented-out"\n${projectId === undefined ? '' : `project_id = "${projectId}"\n`}[api]\nport = 54321\n`,
  );
  return folder;
}
const scratch = stackFolder('scratch-copy', 'scratch-types');
const worktree = stackFolder('worktree', SHARED);
const unnamed = stackFolder('unnamed-stack');
const empty = join(base, 'no-config');
mkdirSync(empty);

const refusal = (command: string, cwd: string, environment: Record<string, string> = {}) =>
  secondStackRefusal(command, cwd, SHARED, environment);

test('the repository starts the shared stack, and a stack is named by its config', () => {
  expect(stackProjectId(repositoryRoot)).toBe(SHARED);
  expect(stackProjectId(join(repositoryRoot, 'lib/testing'))).toBe(SHARED);
  expect(stackProjectId(scratch)).toBe('scratch-types');
  expect(stackProjectId(join(scratch, 'supabase', 'migrations'))).toBe('scratch-types');
  // The CLI names a stack without an id after its folder.
  expect(stackProjectId(unnamed)).toBe('unnamed-stack');
  expect(stackProjectId(empty)).toBeUndefined();
});

// 2026-11-11: a second stack held 2 GiB on the PC beside 18 agents and no gate saw it start.
test('a start of another stack is refused in every form an agent types', () => {
  const refused: [string, string][] = [
    ['supabase start', scratch],
    ['bunx supabase start', scratch],
    ['bunx supabase@2.48.3 start', scratch],
    ['bun x supabase start', scratch],
    ['npx -y supabase start --debug', scratch],
    ['./node_modules/.bin/supabase start -x studio,imgproxy', scratch],
    ['supabase db start', scratch],
    ['timeout 300 bunx supabase start', scratch],
    [`bunx supabase start --workdir ${scratch}`, repositoryRoot],
    [`bunx supabase --workdir ${scratch} start`, repositoryRoot],
    [`bunx supabase --workdir=${scratch} start`, repositoryRoot],
    [`bunx supabase start --workdir ${scratch}/supabase/migrations`, repositoryRoot],
    [`SUPABASE_WORKDIR=${scratch} bunx supabase start`, repositoryRoot],
    [`env SUPABASE_WORKDIR=${scratch} supabase start`, repositoryRoot],
    [`cd ${scratch} && bunx supabase start`, repositoryRoot],
    [`cd ${base} && cd scratch-copy && supabase start`, repositoryRoot],
    [`(cd ${scratch}; supabase start)`, repositoryRoot],
    [`bash -lc "cd ${scratch} && supabase start"`, repositoryRoot],
    // The variable set on a shell around the start, or exported before it, is in force for it.
    [`SUPABASE_WORKDIR=${scratch} bash -lc 'supabase start'`, repositoryRoot],
    [`env SUPABASE_WORKDIR=${scratch} sh -c "bunx supabase start"`, repositoryRoot],
    [`export SUPABASE_WORKDIR=${scratch}; bunx supabase start`, repositoryRoot],
    [`export SUPABASE_WORKDIR=${scratch} && bash -c 'supabase db start'`, repositoryRoot],
    [`SUPABASE_WORKDIR=${scratch}; export SUPABASE_WORKDIR; supabase start`, repositoryRoot],
    // A global flag's value is no subcommand: `json` does not hide `start`.
    [`supabase --output json start --workdir ${scratch}`, repositoryRoot],
    ['supabase -o json start', scratch],
    ['bunx supabase --profile supabase --debug start', scratch],
    ['supabase --network-id scratch-net db start', scratch],
    ['supabase --dns-resolver https db --output yaml start', scratch],
    ['git status && bunx supabase start', scratch],
    ['supabase start', unnamed],
  ];
  for (const [command, cwd] of refused) {
    const reason = refusal(command, cwd);
    expect([command, reason?.startsWith('Refused: this would start a second local Supabase stack')]).toEqual([
      command,
      true,
    ]);
  }
  const reason = refusal('bunx supabase start', scratch);
  expect(reason).toContain('`scratch-types`, beside the shared `werkflow-app` stack');
  expect(reason).toContain('bun run test:verify --group <id>');
});

test('the variable in the environment of the agent counts, and the flag wins over it', () => {
  expect(refusal('bunx supabase start', repositoryRoot, { SUPABASE_WORKDIR: scratch })).toBeDefined();
  expect(
    refusal(`bunx supabase start --workdir ${worktree}`, repositoryRoot, { SUPABASE_WORKDIR: scratch }),
  ).toBeUndefined();
  expect(
    refusal(`SUPABASE_WORKDIR=${worktree} bunx supabase start`, repositoryRoot, {
      SUPABASE_WORKDIR: scratch,
    }),
  ).toBeUndefined();
  // The assignment nearest the start wins over the ones around it.
  expect(
    refusal(
      `SUPABASE_WORKDIR=${scratch} bash -c 'SUPABASE_WORKDIR=${worktree} supabase start'`,
      repositoryRoot,
    ),
  ).toBeUndefined();
  expect(
    refusal(
      `export SUPABASE_WORKDIR=${worktree}; SUPABASE_WORKDIR=${scratch} supabase start`,
      repositoryRoot,
    ),
  ).toBeDefined();
});

test('a start that reaches the shared stack, and every other Supabase command, passes', () => {
  const passed: [string, string][] = [
    ['bunx supabase start', repositoryRoot],
    ['supabase start', join(repositoryRoot, 'supabase')],
    // A worktree and a copy with the shared id start the same containers.
    ['bunx supabase start', worktree],
    [`bunx supabase start --workdir ${worktree}`, scratch],
    [`cd ${worktree} && supabase start`, scratch],
    // No config: the CLI starts nothing.
    ['supabase start', empty],
    ['bunx supabase status', scratch],
    ['bunx supabase stop', scratch],
    ['bunx supabase migration up', scratch],
    ['bunx supabase db reset', scratch],
    ['bunx supabase functions serve start', scratch],
    ['supabase --output json status', scratch],
    ['supabase --profile start status', scratch],
    [`SUPABASE_WORKDIR=${worktree} bash -lc 'supabase start'`, scratch],
    ['echo "supabase start"', scratch],
    ['git commit -m "supabase start for the scratch stack"', scratch],
    ['rg "supabase start" docs', scratch],
    ['bun run test:verify --group sql', scratch],
  ];
  for (const [command, cwd] of passed) expect([command, refusal(command, cwd)]).toEqual([command, undefined]);
});

test('the hook refuses a second stack and passes the shared one, a non-shell call and an unreadable call', () => {
  const run = (input: string) =>
    spawnSync(process.execPath, [resolve(repositoryRoot, '.claude/hooks/refuse-second-stack.ts')], {
      input,
      encoding: 'utf8',
      env: { ...process.env, SUPABASE_WORKDIR: '' },
    });
  const shell = (command: string, cwd: string) =>
    run(JSON.stringify({ tool_name: 'Bash', tool_input: { command }, cwd }));
  const refused = shell('bunx supabase start', scratch);
  expect(refused.status).toBe(2);
  expect(refused.stderr).toContain('second local Supabase stack, `scratch-types`');
  expect(shell(`cd ${scratch} && bunx supabase start`, repositoryRoot).status).toBe(2);
  expect(shell('bunx supabase start', repositoryRoot).status).toBe(0);
  expect(shell('bunx supabase status', scratch).status).toBe(0);
  expect(
    run(JSON.stringify({ tool_name: 'Read', tool_input: { file_path: `${scratch}/supabase/config.toml` } }))
      .status,
  ).toBe(0);
  expect(run('not json').status).toBe(0);
});
