// The merge queue's git, GitHub and runner calls (lib/testing/ci/queue.ts decides). git builds the
// batch with plumbing only, so the queue's checkout never changes; `gh` reads and merges the PRs.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  integrationEnvironment,
  PULLS_QUERY,
  pullsFromGitHub,
  type QueueAdapter,
  type Verdict,
  verdictOf,
} from '../../lib/testing/ci/queue';
import { type Ledger, readLedger, readResult, resultFileName } from '../../lib/testing/ci/results';
import { provenTree } from '../../lib/testing/ci/reuse';

/** The commit status the queue sets on a PR's head right before it merges it. The ruleset requires it (owner's step). */
const QUEUE_STATUS = 'Queue';
/** Where the queue keeps main and each batch tip under test, so no garbage collection takes them. */
const QUEUE_REFS = 'refs/ci-queue';

type Git = (...args: string[]) => string;

/** git in `repository`, never prompting for a credential. */
function gitIn(repository: string): Git {
  return (...args) =>
    execFileSync('git', args, {
      cwd: repository,
      encoding: 'utf8',
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
}

/**
 * The squash commit of `head` onto `parent`, as GitHub's squash merge builds it: the three-way
 * merge's tree with `parent` as its only parent. Undefined when the merge conflicts.
 */
export function squashCommit(
  repository: string,
  parent: string,
  head: string,
  message: string,
): { commit: string; tree: string } | undefined {
  const merged = spawnSync('git', ['merge-tree', '--write-tree', '--no-messages', parent, head], {
    cwd: repository,
    encoding: 'utf8',
  });
  if (merged.status === 1) return undefined;
  const tree = merged.stdout.split('\n')[0] ?? '';
  if (merged.status !== 0 || !/^[0-9a-f]{40,64}$/.test(tree))
    throw new Error(`git merge-tree failed: ${merged.stderr.trim()}`);
  const commit = gitIn(repository)(
    '-c',
    'user.name=WerkFlow merge queue',
    '-c',
    'user.email=merge-queue@werk-flow.invalid',
    'commit-tree',
    tree,
    '-p',
    parent,
    '-m',
    message,
  );
  return { commit, tree };
}

/**
 * Runs the runner's integration run of a batch prefix and reads its verdict from the results it
 * wrote. The runner's exit code decides nothing: only this run's Check and job results count.
 */
export function runIntegration(
  options: { repository: string; runner: string; resultsDir: string; runUrl: string; ledger?: string },
  run: Parameters<QueueAdapter['integrationRun']>[0],
): Verdict {
  const git = gitIn(options.repository);
  const ref = `${QUEUE_REFS}/runs/${run.tip.commit}`;
  mkdirSync(options.resultsDir, { recursive: true });
  git('update-ref', ref, run.tip.commit);
  try {
    const environment = integrationEnvironment({ ...run, ...options });
    const ran = spawnSync(options.runner, [], {
      cwd: options.repository,
      env: { ...process.env, ...environment },
      stdio: 'inherit',
    });
    console.info(`[queue] runner ended with ${ran.error?.message ?? ran.signal ?? `exit ${ran.status}`}`);
  } finally {
    git('update-ref', '-d', ref);
  }
  const result = (file: string) => readResult(join(options.resultsDir, file));
  const files = existsSync(options.resultsDir) ? readdirSync(options.resultsDir) : [];
  return verdictOf(
    { commit: run.tip.commit, tree: run.tip.tree, base: run.base, runUrl: options.runUrl },
    {
      plan: result(resultFileName('plan', null)),
      check: result(resultFileName('check', null)),
      results: files.filter((file) => file.endsWith('.json')).map(result),
      ledger: ledgerOf(options.ledger),
    },
  );
}

/** The runner's ledger when the queue is given one, read-only; undefined without one. */
const ledgerOf = (path: string | undefined): Ledger | undefined => (path ? readLedger(path) : undefined);

/** The status call that marks `head` for the queue. */
const queueStatus = (head: string, state: 'success' | 'failure', description: string): string[] => [
  'api',
  `repos/{owner}/{repo}/statuses/${head}`,
  '-f',
  `state=${state}`,
  '-f',
  `context=${QUEUE_STATUS}`,
  '-f',
  `description=${description.slice(0, 140)}`,
];

/** The adapter on the real repository, GitHub and runner. */
export function createQueueAdapter(options: {
  repository: string;
  runner: string;
  workDir: string;
  runUrlBase: string;
  ledger?: string;
}): QueueAdapter {
  const git = gitIn(options.repository);
  const gh = (...args: string[]): string =>
    execFileSync('gh', args, {
      cwd: options.repository,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  let nameWithOwner: string[] | undefined;
  const repositoryName = (): string[] =>
    (nameWithOwner ??= gh('api', 'repos/{owner}/{repo}', '--jq', '.full_name').trim().split('/'));
  return {
    main: async () => {
      git('fetch', '--quiet', '--no-tags', 'origin', `+refs/heads/main:${QUEUE_REFS}/main`);
      const [commit = '', ...parents] = git('rev-list', '--parents', '-n', '1', `${QUEUE_REFS}/main`).split(
        ' ',
      );
      return { commit, parents, tree: git('rev-parse', `${commit}^{tree}`) };
    },
    pulls: async () =>
      pullsFromGitHub(
        JSON.parse(
          // gh fills {owner} and {repo} only in a REST path, so the GraphQL fields take them from it.
          gh(
            'api',
            'graphql',
            '--paginate',
            '--slurp',
            '-f',
            `query=${PULLS_QUERY}`,
            ...['owner', 'name'].flatMap((field, index) => ['-f', `${field}=${repositoryName()[index]}`]),
          ),
        ),
      ),
    squash: async (parent, pull) => {
      git('fetch', '--quiet', '--no-tags', 'origin', pull.headSha);
      const squashed = squashCommit(
        options.repository,
        parent,
        pull.headSha,
        `${pull.title} (#${pull.number})`,
      );
      console.info(
        `[queue] #${pull.number}: ${squashed ? `squashed as ${squashed.commit}` : 'conflicts, left out'}`,
      );
      return squashed;
    },
    integrationRun: async (run) => {
      const id = `${new Date().toISOString().replace(/[-:.]/g, '')}-${run.tip.commit.slice(0, 12)}`;
      const runUrl = `${options.runUrlBase}/${id}`;
      console.info(
        `[queue] integration run ${runUrl} of ${run.pulls.map((pull) => `#${pull.number}`).join(', ')}`,
      );
      const verdict = runIntegration({ ...options, resultsDir: join(options.workDir, id), runUrl }, run);
      console.info(`[queue] ${runUrl}: ${verdict.kind}, ${verdict.detail}`);
      return verdict;
    },
    land: async (pull, proof) => {
      gh(...queueStatus(pull.headSha, 'success', `Passed in ${proof.runUrl}`));
      gh('pr', 'merge', String(pull.number), '--squash', '--match-head-commit', pull.headSha);
      console.info(`[queue] #${pull.number}: merged`);
    },
    withdraw: async (pull) => {
      gh(...queueStatus(pull.headSha, 'failure', 'Not merged; the queue tests it again'));
      console.info(`[queue] #${pull.number}: Queue withdrawn`);
    },
    proven: async (tree) => {
      const ledger = ledgerOf(options.ledger);
      return ledger !== undefined && provenTree(ledger, tree) !== undefined;
    },
    reject: async (pull, proof) => {
      gh('pr', 'merge', String(pull.number), '--disable-auto');
      gh(
        'pr',
        'comment',
        String(pull.number),
        '--body',
        [
          `The merge queue's integration run ${proof.runUrl} failed with this PR on top of \`main\` and the batch's PRs before it, which passed without it (${proof.detail}).`,
          '',
          `The queue took the PR out and turned auto-merge off. Classify the failure (docs/technical/testing.md, "Failures"), fix it, and run \`gh pr merge ${pull.number} --squash --auto\` again to queue it.`,
        ].join('\n'),
      );
      console.info(`[queue] #${pull.number}: rejected`);
    },
  };
}
