// The queue's git and runner calls (scripts/ci/queue-adapter.ts) on real repositories: a batch entry
// is the squash merge GitHub would build, and a run's verdict comes only from the results the runner
// wrote for that run.
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createQueueAdapter,
  markQueue,
  readQueueState,
  runIntegration,
  runMain,
  squashCommit,
  writeQueueState,
} from '../../../scripts/ci/queue-adapter';
import type { QueuedPull } from './queue';

let folder = '';
let repository = '';

const git = (...args: string[]): string =>
  execFileSync(
    'git',
    ['-c', 'user.name=ci', '-c', 'user.email=ci@example.invalid', '-c', 'commit.gpgSign=false', ...args],
    {
      cwd: repository,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  ).trim();

function commitFile(file: string, content: string): string {
  writeFileSync(join(repository, file), content);
  git('add', file);
  git('commit', '--quiet', '--message', file);
  return git('rev-parse', 'HEAD');
}

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'ci-queue-'));
  repository = join(folder, 'repository');
  execFileSync('git', ['init', '--quiet', '--initial-branch=main', repository]);
  commitFile('a.txt', 'one\ntwo\nthree\n');
});

afterEach(() => {
  rmSync(folder, { recursive: true, force: true });
});

test("a squash entry holds the three-way merge's tree on its parent alone, and a conflict leaves the PR out", () => {
  const base = git('rev-parse', 'HEAD');
  git('switch', '--quiet', '-c', 'pr');
  commitFile('a.txt', 'one\ntwo\nthree, changed\n');
  const head = commitFile('b.txt', 'b\n');
  git('switch', '--quiet', 'main');
  const main = commitFile('a.txt', 'one, changed\ntwo\nthree\n');

  const squashed = squashCommit(repository, main, head, 'A change (#7)');
  git('merge', '--quiet', '--squash', 'pr');
  git('commit', '--quiet', '--message', 'reference');
  expect(squashed?.tree).toBe(git('rev-parse', 'HEAD^{tree}'));
  expect(git('rev-list', '--parents', '-n', '1', squashed?.commit ?? '')).toBe(`${squashed?.commit} ${main}`);
  expect(git('log', '-1', '--format=%s', squashed?.commit ?? '')).toBe('A change (#7)');

  git('switch', '--quiet', '-c', 'clash', base);
  const clash = commitFile('a.txt', 'one, other\ntwo\nthree\n');
  expect(squashCommit(repository, main, clash, 'Clash (#8)')).toBe(undefined);
});

const pull: QueuedPull = {
  number: 7,
  title: 'A change',
  headSha: 'a'.repeat(40),
  isDraft: false,
  queuedAt: '2026-11-21T08:00:00Z',
  check: 'SUCCESS',
  mergeState: 'BLOCKED',
  listGrowthApproved: false,
};

/**
 * A runner that fetches the commit as the queue's contract says and writes a passed plan, then runs
 * `body` in bash. `receipt <job> <status> <completedAt> [fields]` writes that job's result;
 * `ledger` appends the last one to the folder's ledger.jsonl.
 */
function runner(body: string): string {
  const path = join(folder, 'runner.sh');
  writeFileSync(
    path,
    `#!/usr/bin/env bash
set -euo pipefail
checkout="$(mktemp -d "${folder}/checkout-XXXXXX")"
git init --quiet "$checkout"
git -C "$checkout" fetch --quiet "$CI_QUEUE_REPOSITORY" "refs/ci-queue/runs/$CI_QUEUE_COMMIT"
tree="$(git -C "$checkout" rev-parse "$CI_QUEUE_COMMIT^{tree}")"
receipt() {
  printf '{"version":1,"job":"%s","shard":null,"event":"%s","tree":"%s","commit":"%s","base":"%s","status":"%s","groups":[],"planReason":"","reusedFrom":null,"listGrowthApproved":false,"producer":"stub","runUrl":"%s","startedAt":"2026-11-21T08:00:00Z","completedAt":%s,"attempt":1%s}\\n' \\
    "$1" "$CI_EVENT" "$tree" "$CI_QUEUE_COMMIT" "$CI_BASE_SHA" "$2" "$CI_RUN_URL" "$3" "\${4:-}" > "$CI_RESULTS_DIR/$1.json"
  last="$CI_RESULTS_DIR/$1.json"
}
ledger() { cat "$last" >> "${join(folder, 'ledger.jsonl')}"; }
receipt plan running null; ledger
receipt plan passed '"2026-11-21T08:10:00Z"' ',"plan":{"jobs":["plan","check"],"skips":{},"shards":[],"outputs":{},"work":["fast:step:build"]}'; ledger
${body}
`,
  );
  chmodSync(path, 0o755);
  return path;
}

function integration(body: string, runUrl: string, ledger?: string) {
  const commit = git('rev-parse', 'HEAD');
  const tip = { pull, commit, tree: git('rev-parse', 'HEAD^{tree}') };
  return runIntegration(
    {
      repository,
      runner: runner(body),
      resultsDir: join(folder, 'results', runUrl),
      runUrl,
      ...(ledger ? { ledger } : {}),
    },
    { tip, base: commit, pulls: [pull] },
  );
}

test("a run's verdict is its own finished Check, whatever the runner's exit code", () => {
  expect(integration('receipt check passed \'"2026-11-21T09:00:00Z"\'; exit 1', 'queue/1').kind).toBe(
    'passed',
  );
  expect(git('for-each-ref', 'refs/ci-queue')).toBe('');
});

test("with the runner's ledger, a passed Check counts only once the ledger holds it as the landing's pass", () => {
  const ledger = join(folder, 'ledger.jsonl');
  const passed =
    'receipt check passed \'"2026-11-21T09:00:00Z"\' \',"planStartedAt":"2026-11-21T08:00:00Z"\'';
  expect(integration(passed, 'queue/4', ledger).kind).toBe('inconclusive');
  expect(integration(`${passed}; ledger`, 'queue/5', ledger).kind).toBe('passed');
});

test('a runner that leaves no Check result, or one still running, gives no verdict', () => {
  expect(integration('exit 0', 'queue/2').detail).toStartWith('no Check result:');
  expect(integration('receipt check running null; kill -9 $$', 'queue/3')).toEqual({
    kind: 'inconclusive',
    runUrl: 'queue/3',
    detail: 'Check did not finish',
  });
});

test('with a CI App the Queue mark goes only through the publisher as the App; without one it is a commit status', () => {
  const head = 'c'.repeat(40);
  const mark = { head, state: 'success' as const, description: 'Passed in queue/9', runUrl: 'queue/9' };
  const called = join(folder, 'publisher.log');
  const publisher = join(folder, 'publisher');
  writeFileSync(
    publisher,
    `#!/usr/bin/env bash\nprintf '%s|%s|%s\\n' "$*" "$CI_RUN_URL" "$CI_COMMIT" >> "${called}"\nexit "\${PUBLISHER_EXIT:-0}"\n`,
  );
  chmodSync(publisher, 0o755);
  const statuses: string[][] = [];
  const gh = (...args: string[]) => {
    statuses.push(args);
    return '';
  };

  markQueue({ repository, appId: 4242, publisher }, mark, gh);
  markQueue({ repository, appId: 4242, publisher }, { ...mark, state: 'failure' }, gh);
  expect(readFileSync(called, 'utf8')).toBe(`queue success|queue/9|${head}\nqueue failure|queue/9|${head}\n`);
  expect(statuses).toEqual([]);

  // A configured App never falls back to the queue's own token.
  expect(() => markQueue({ repository, appId: 4242, publisher: undefined }, mark, gh)).toThrow(
    'no --publisher',
  );
  process.env.PUBLISHER_EXIT = '1';
  try {
    expect(() => markQueue({ repository, appId: 4242, publisher }, mark, gh)).toThrow(
      `The publisher did not post Queue success on ${head} (exit 1).`,
    );
  } finally {
    delete process.env.PUBLISHER_EXIT;
  }
  expect(statuses).toEqual([]);

  markQueue({ repository, appId: null, publisher }, mark, gh);
  expect(statuses).toEqual([
    [
      'api',
      `repos/{owner}/{repo}/statuses/${head}`,
      '-f',
      'state=success',
      '-f',
      'context=Queue',
      '-f',
      'description=Passed in queue/9',
    ],
  ]);
  expect(readFileSync(called, 'utf8').split('\n')).toHaveLength(4);
});

test("the queue turns a PR's auto-merge off through gh, and a refusal throws so no Queue success follows", async () => {
  const called = join(folder, 'gh.log');
  const bin = join(folder, 'bin');
  mkdirSync(bin);
  writeFileSync(
    join(bin, 'gh'),
    `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> "${called}"\nexit "$(cat "${folder}/gh-exit" 2> /dev/null || echo 0)"\n`,
  );
  chmodSync(join(bin, 'gh'), 0o755);
  const adapter = createQueueAdapter({
    repository,
    runner: 'unused',
    workDir: folder,
    runUrlBase: 'queue',
    appId: 4242,
    publisher: 'unused',
  });
  const path = process.env.PATH;
  process.env.PATH = `${bin}:${path}`;
  try {
    await adapter.disableAutoMerge(pull);
    writeFileSync(join(folder, 'gh-exit'), '1');
    await expect(adapter.disableAutoMerge(pull)).rejects.toThrow();
  } finally {
    process.env.PATH = path;
  }
  expect(readFileSync(called, 'utf8')).toBe('pr merge 7 --disable-auto\npr merge 7 --disable-auto\n');
});

test("a behind PR's branch is updated with main through gh at the head the queue saw, and a refusal throws", async () => {
  const called = join(folder, 'gh.log');
  const bin = join(folder, 'bin');
  mkdirSync(bin);
  writeFileSync(
    join(bin, 'gh'),
    `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> "${called}"\nexit "$(cat "${folder}/gh-exit" 2> /dev/null || echo 0)"\n`,
  );
  chmodSync(join(bin, 'gh'), 0o755);
  const adapter = createQueueAdapter({
    repository,
    runner: 'unused',
    workDir: folder,
    runUrlBase: 'queue',
    appId: null,
  });
  const path = process.env.PATH;
  process.env.PATH = `${bin}:${path}`;
  try {
    await adapter.updateBranch(pull);
    writeFileSync(join(folder, 'gh-exit'), '1');
    await expect(adapter.updateBranch(pull)).rejects.toThrow();
  } finally {
    process.env.PATH = path;
  }
  // The update names the head the queue saw green, so GitHub refuses it once the branch moved on.
  const update = `api --method PUT repos/{owner}/{repo}/pulls/7/update-branch -f expected_head_sha=${pull.headSha}\n`;
  expect(readFileSync(called, 'utf8')).toBe(update + update);
});

test("a batch entry's migrations are checked against the prefix it lands on, from the queue's commits alone", async () => {
  mkdirSync(join(repository, 'supabase/migrations'), { recursive: true });
  const main = commitFile(
    'supabase/migrations/20261020100000_first.sql',
    'create table public.jobs (id int);\n',
  );
  const higher = commitFile(
    'supabase/migrations/20261027100000_job_due.sql',
    'alter table public.jobs add column due date;\n',
  );
  const lower = commitFile(
    'supabase/migrations/20261026120000_job_owner.sql',
    'alter table public.jobs add column owner text;\n',
  );
  const adapter = createQueueAdapter({
    repository,
    runner: 'unused',
    workDir: folder,
    runUrlBase: 'queue',
    appId: null,
  });
  const entry = { pull, commit: lower, tree: git('rev-parse', `${lower}^{tree}`) };
  expect(await adapter.migrationProblems(higher, entry)).toEqual([
    expect.stringContaining('20261026120000_job_owner.sql changes what a migration with a higher version'),
  ]);
  expect(await adapter.migrationProblems(main, { ...entry, commit: higher })).toEqual([]);
});

/** One tick of the real CLI; each case here refuses before it reads GitHub. */
const tick = (...args: string[]) =>
  spawnSync(process.execPath, [join(import.meta.dir, '../../../scripts/ci/queue.ts'), ...args], {
    encoding: 'utf8',
  });

test('every refusal before the tick exits 2, the code that stops the loop, and names its cause', () => {
  const required = ['--runner', 'runner', '--run-url-base', 'queue'];
  const workDir = join(folder, 'work');
  const file = join(folder, 'file');
  writeFileSync(file, '');
  mkdirSync(workDir);
  writeFileSync(join(workDir, 'queue.lock'), '');
  for (const [args, cause] of [
    [[], 'needs --runner, --work-dir and --run-url-base'],
    [['--unknown'], "Unknown option '--unknown'"],
    [[...required, '--work-dir', workDir, '--max-batch', '5'], '--max-batch takes 1 to 4'],
    [[...required, '--work-dir', workDir, '--max-batch', '0x2'], '--max-batch takes 1 to 4'],
    // Number() reads `0x10` as 16 and `1e1` as 10: only decimal PR numbers pass.
    [[...required, '--work-dir', workDir, '--dry-run', '--prs', '0x10'], '--prs takes PR numbers'],
    [[...required, '--work-dir', workDir, '--dry-run', '--prs', '7,1e1'], '--prs takes PR numbers'],
    [[...required, '--work-dir', workDir, '--prs', '7'], 'only with --dry-run'],
    [[...required, '--work-dir', workDir], 'queue.lock exists: another tick runs'],
    [[...required, '--work-dir', join(file, 'work')], 'queue.lock could not be created: ENOTDIR'],
  ] as const) {
    const refused = tick(...args);
    expect(refused.status, args.join(' ')).toBe(2);
    expect(refused.stderr, args.join(' ')).toContain(cause);
  }
});

test("the queue's state survives between ticks; a missing file is clear and a damaged one stops the tick", () => {
  const path = join(folder, 'queue-state.json');
  expect(readQueueState(path)).toEqual({ pending: null, frozen: null });
  const state = {
    pending: { pull: 7, head: 'a'.repeat(40), runUrl: 'queue/9', verdict: 'success' as const },
    frozen: 'the publisher was down',
  };
  writeQueueState(path, state);
  expect(readQueueState(path)).toEqual(state);
  writeQueueState(path, { pending: null, frozen: null });
  expect(readQueueState(path)).toEqual({ pending: null, frozen: null });
  for (const damaged of ['{"pending": null', '{"pending": {"pull": 7}, "frozen": null}', '{}'])
    expect(() => {
      writeFileSync(path, damaged);
      readQueueState(path);
    }, damaged).toThrow();
});

test("main's run gets main's head, the tick's base and the landed PRs, in a results directory of its own", () => {
  const mainRunner = join(folder, 'main-runner');
  writeFileSync(
    mainRunner,
    `#!/usr/bin/env bash\nenv | grep -E '^CI_(EVENT|COMMIT|BASE_SHA|PRS|RUN_URL|RESULTS_DIR)=' | sort > "${join(folder, 'main-env')}"\nexit 1\n`,
  );
  chmodSync(mainRunner, 0o755);
  const workDir = join(folder, 'work');
  runMain(
    { repository, mainRunner, workDir, runUrlBase: 'https://ci.example/queue' },
    {
      commit: 'c'.repeat(40),
      base: 'b'.repeat(40),
      prs: [7, 9],
    },
  );
  const env = Object.fromEntries(
    readFileSync(join(folder, 'main-env'), 'utf8')
      .trim()
      .split('\n')
      .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
  );
  expect(env).toMatchObject({
    CI_EVENT: 'main',
    CI_COMMIT: 'c'.repeat(40),
    CI_BASE_SHA: 'b'.repeat(40),
    CI_PRS: '7,9',
  });
  const id = env.CI_RUN_URL?.replace('https://ci.example/queue/', '') ?? '';
  expect(id).toEndWith(`-main-${'c'.repeat(12)}`);
  expect(env.CI_RESULTS_DIR).toBe(join(workDir, id));
});
