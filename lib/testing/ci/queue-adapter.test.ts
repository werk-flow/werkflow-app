// The queue's git and runner calls (scripts/ci/queue-adapter.ts) on real repositories: a batch entry
// is the squash merge GitHub would build, and a run's verdict comes only from the results the runner
// wrote for that run.
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { markQueue, runIntegration, squashCommit } from '../../../scripts/ci/queue-adapter';
import type { QueuedPull } from './queue';

let folder = '';
let repository = '';

const git = (...args: string[]): string =>
  execFileSync('git', ['-c', 'user.name=ci', '-c', 'user.email=ci@example.invalid', ...args], {
    cwd: repository,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();

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
  delete process.env.LEDGER;
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
 * `body` in bash. `receipt <job> <status> <completedAt>` writes that job's result; `ledger` appends
 * the last one to $LEDGER.
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
  printf '{"version":1,"job":"%s","shard":null,"event":"%s","tree":"%s","commit":"%s","base":"%s","status":"%s","groups":[],"planReason":"","reusedFrom":null,"listGrowthApproved":false,"producer":"stub","runUrl":"%s","startedAt":"2026-11-21T08:00:00Z","completedAt":%s}\\n' \\
    "$1" "$CI_EVENT" "$tree" "$CI_QUEUE_COMMIT" "$CI_BASE_SHA" "$2" "$CI_RUN_URL" "$3" > "$CI_RESULTS_DIR/$1.json"
  last="$CI_RESULTS_DIR/$1.json"
}
ledger() { cat "$last" >> "$LEDGER"; }
receipt plan running null; ledger
receipt plan passed '"2026-11-21T08:10:00Z"'
${body}
`,
  );
  chmodSync(path, 0o755);
  return path;
}

function integration(body: string, runUrl: string, ledger?: string) {
  const commit = git('rev-parse', 'HEAD');
  const tip = { pull, commit, tree: git('rev-parse', 'HEAD^{tree}') };
  process.env.LEDGER = join(folder, 'ledger.jsonl');
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

test("with the runner's ledger, a passed Check counts only once the ledger holds it as the tree's pass", () => {
  const ledger = join(folder, 'ledger.jsonl');
  const passed = 'receipt check passed \'"2026-11-21T09:00:00Z"\'';
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
