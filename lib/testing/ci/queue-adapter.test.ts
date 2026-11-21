// The queue's git and runner calls (scripts/ci/queue-adapter.ts) on real repositories: a batch entry
// is the squash merge GitHub would build, and a run's verdict comes only from the results the runner
// wrote for that run.
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runIntegration, squashCommit } from '../../../scripts/ci/queue-adapter';
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

afterEach(() => rmSync(folder, { recursive: true, force: true }));

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

/** A runner that fetches the commit as the queue's contract says, then runs `body` in bash. */
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
check() {
  printf '{"version":1,"job":"check","shard":null,"event":"%s","tree":"%s","commit":"%s","base":"%s","status":"%s","groups":[],"planReason":"","reusedFrom":null,"listGrowthApproved":false,"producer":"stub","runUrl":"%s","startedAt":"2026-11-21T08:00:00Z","completedAt":%s}' \\
    "$CI_EVENT" "$tree" "$CI_QUEUE_COMMIT" "$CI_BASE_SHA" "$1" "$CI_RUN_URL" "$2" > "$CI_RESULTS_DIR/check.json"
}
${body}
`,
  );
  chmodSync(path, 0o755);
  return path;
}

function integration(body: string, runUrl: string) {
  const commit = git('rev-parse', 'HEAD');
  const tip = { pull, commit, tree: git('rev-parse', 'HEAD^{tree}') };
  return runIntegration(
    { repository, runner: runner(body), resultsDir: join(folder, 'results', runUrl), runUrl },
    { tip, base: commit, pulls: [pull] },
  );
}

test("a run's verdict is its own finished Check, whatever the runner's exit code", () => {
  expect(integration('check passed \'"2026-11-21T09:00:00Z"\'; exit 1', 'queue/1').kind).toBe('passed');
  expect(git('for-each-ref', 'refs/ci-queue')).toBe('');
});

test('a runner that leaves no Check result, or one still running, gives no verdict', () => {
  expect(integration('exit 0', 'queue/2').detail).toStartWith('no Check result:');
  expect(integration('check running null; kill -9 $$', 'queue/3')).toEqual({
    kind: 'inconclusive',
    runUrl: 'queue/3',
    detail: 'Check did not finish',
  });
});
