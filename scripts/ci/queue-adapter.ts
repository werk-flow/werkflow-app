// The merge queue's git, GitHub and runner calls (lib/testing/ci/queue.ts decides). git builds the
// batch with plumbing only, so the queue's checkout never changes; `gh` reads and merges the PRs.
// Once .github/scripts/check-app.json names the CI App, a PR's `Check` is the App's check run and
// the `Queue` mark goes through the publisher as the App's check run (lib/testing/ci/check-app.ts).
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { appCheckStateOf } from '../../lib/testing/ci/check-app';
import { mainEnvironment, type MainFollowUp, mainFollowUpSchema } from '../../lib/testing/ci/queue-main-run';
import {
  INTEGRATION_ATTEMPT,
  integrationEnvironment,
  type QueueAdapter,
  type QueuedPull,
  type QueueState,
  queueStateSchema,
  type Verdict,
} from '../../lib/testing/ci/queue';
import { verdictOf } from '../../lib/testing/ci/queue-verdict';
import { PULLS_QUERY, pullsFromGitHub } from '../../lib/testing/ci/queue-github';
import { type Ledger, readLedger, readResult, resultFileName } from '../../lib/testing/ci/results';
import { provenTree } from '../../lib/testing/ci/reuse';
import { acknowledgedStart, mainStartRecord } from '../../lib/testing/ci/run-commit';
import { migrationOrderProblems } from '../../lib/testing/local-stack/migration-order';

/** The commit status the queue sets on a PR's head right before it merges it. The ruleset requires it (owner's step). */
const QUEUE_STATUS = 'Queue';
/** Where the queue keeps main and each batch tip under test, so no garbage collection takes them. */
const QUEUE_REFS = 'refs/ci-queue';

/** The queue's state between ticks, in its work directory: a pending `Queue` mark or a freeze. */
export const QUEUE_STATE_FILE = 'queue-state.json';
/** main's run a landing still owes (`mainFollowUp`), until it started. */
const MAIN_FOLLOW_UP_FILE = 'main-follow-up.json';

/** The owed main run in `workDir`, or undefined. A damaged file throws, so the tick stops for a person. */
export function readMainFollowUp(workDir: string): MainFollowUp | undefined {
  const path = join(workDir, MAIN_FOLLOW_UP_FILE);
  return existsSync(path) ? mainFollowUpSchema.parse(JSON.parse(readFileSync(path, 'utf8'))) : undefined;
}

/** Saves an owed main run durably, or clears it with undefined. */
export function saveMainFollowUp(workDir: string, followUp: MainFollowUp | undefined): void {
  const path = join(workDir, MAIN_FOLLOW_UP_FILE);
  if (!followUp) return rmSync(path, { force: true });
  writeFileSync(`${path}.tmp`, `${JSON.stringify(mainFollowUpSchema.parse(followUp))}\n`, { flush: true });
  renameSync(`${path}.tmp`, path);
}

type Git = (...args: string[]) => string;

/** The state at `path`; a missing file is a clear state. A damaged one throws, so the tick stops for a person. */
export function readQueueState(path: string): QueueState {
  if (!existsSync(path)) return { pending: null, frozen: null };
  return queueStateSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
}

/** Writes the state through a flushed temporary file and a rename: a crash leaves the old state or the new one. */
export function writeQueueState(path: string, state: QueueState): void {
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(queueStateSchema.parse(state), null, 2)}\n`, { flush: true });
  renameSync(temporary, path);
}

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
 * wrote: this run's Check and job results, and a pass only with the runner's exit 0 as well.
 */
export function runIntegration(
  options: { repository: string; runner: string; resultsDir: string; runUrl: string; ledger?: string },
  run: Parameters<QueueAdapter['integrationRun']>[0],
): Verdict {
  const git = gitIn(options.repository);
  const ref = `${QUEUE_REFS}/runs/${run.tip.commit}`;
  mkdirSync(options.resultsDir, { recursive: true });
  git('update-ref', ref, run.tip.commit);
  let runnerPassed = false;
  try {
    // A queue run posts no Check, so its runner never gets the main run's publisher.
    const inherited = { ...process.env };
    delete inherited.CI_PUBLISHER;
    const environment = integrationEnvironment({ ...run, ...options });
    const ran = spawnSync(options.runner, [], {
      cwd: options.repository,
      env: { ...inherited, ...environment },
      stdio: 'inherit',
    });
    console.info(`[queue] runner ended with ${ran.error?.message ?? ran.signal ?? `exit ${ran.status}`}`);
    runnerPassed = ran.status === 0 && !ran.error;
  } finally {
    git('update-ref', '-d', ref);
  }
  const result = (file: string) => readResult(join(options.resultsDir, file));
  const files = existsSync(options.resultsDir) ? readdirSync(options.resultsDir) : [];
  return verdictOf(
    {
      commit: run.tip.commit,
      tree: run.tip.tree,
      base: run.base,
      runUrl: options.runUrl,
      attempt: INTEGRATION_ATTEMPT,
    },
    {
      plan: result(resultFileName('plan', null)),
      check: result(resultFileName('check', null)),
      results: files.filter((file) => file.endsWith('.json')).map(result),
      ledger: ledgerOf(options.ledger),
      runnerPassed,
    },
  );
}

/**
 * Starts main's run after a landing (`mainRunOf` in lib/testing/ci/queue-main-run.ts) through the
 * main runner, and waits for it. True once the run is paid: the start record of main's run of the
 * commit in the runner's work root names a run (mainStartRecord, written by scripts/ci/run-commit.ts
 * once that run's Plan launched), this one or another. Its exit code decides nothing: every failure
 * before that record, whatever it exits with, leaves the run owed. A run recorded on an earlier tick
 * is paid without starting it again.
 */
export function runMain(
  options: { repository: string; mainRunner: string; workDir: string; runUrlBase: string; workRoot: string },
  run: { commit: string; base: string; prs: readonly number[]; id: string },
): boolean {
  const id = `${run.id}-main-${run.commit.slice(0, 12)}`;
  const paid = (): boolean =>
    acknowledgedStart(mainStartRecord(options.workRoot, run.commit), run.commit) !== undefined;
  if (paid()) return true;
  const environment = mainEnvironment({
    ...run,
    runUrl: `${options.runUrlBase}/${id}`,
    resultsDir: join(options.workDir, id),
  });
  console.info(`[queue] main's run ${environment.CI_RUN_URL} of ${run.commit}, base ${run.base}`);
  const ran = spawnSync(options.mainRunner, [], {
    cwd: options.repository,
    env: { ...process.env, ...environment, CI_WORK_ROOT: options.workRoot },
    stdio: 'inherit',
  });
  console.info(
    `[queue] main's runner ended with ${ran.error?.message ?? ran.signal ?? `exit ${ran.status}`}${paid() ? '' : ', before its start was recorded'}`,
  );
  return paid();
}

/**
 * Whether `main`, the commit a tick read, holds `commit`: is it or a commit above it. It checks the
 * captured commit, never the queue's ref, which a concurrent read in the same clone can move. A
 * commit the queue's clone lacks is not held.
 */
export function mainHolds(repository: string, commit: string, main: string): boolean {
  return (
    spawnSync('git', ['merge-base', '--is-ancestor', commit, main], {
      cwd: repository,
      stdio: 'ignore',
    }).status === 0
  );
}

/** The runner's ledger when the queue is given one, read-only; undefined without one. */
const ledgerOf = (path: string | undefined): Ledger | undefined => (path ? readLedger(path) : undefined);

type Mark = { head: string; state: 'success' | 'failure'; description: string; runUrl: string };

/**
 * Marks a PR head `Queue`. Without a CI App, a commit status with the queue's `gh` token. With one,
 * the App's check run through `publisher`: the trusted publisher's `queue` mode, as the user that
 * holds the App's token, so the queue never holds it. A publisher that fails throws.
 */
export function markQueue(
  options: { repository: string; appId: number | null; publisher?: string | undefined },
  mark: Mark,
  gh: (...args: string[]) => string,
): void {
  if (options.appId === null) {
    gh(
      'api',
      `repos/{owner}/{repo}/statuses/${mark.head}`,
      '-f',
      `state=${mark.state}`,
      '-f',
      `context=${QUEUE_STATUS}`,
      '-f',
      `description=${mark.description.slice(0, 140)}`,
    );
    return;
  }
  if (!options.publisher) throw new Error('The CI App is configured, but the queue has no --publisher.');
  const published = spawnSync(options.publisher, ['queue', mark.state], {
    cwd: options.repository,
    env: { ...process.env, CI_RUN_URL: mark.runUrl, CI_COMMIT: mark.head },
    stdio: 'inherit',
  });
  if (published.status !== 0)
    throw new Error(
      `The publisher did not post Queue ${mark.state} on ${mark.head} (${published.error?.message ?? published.signal ?? `exit ${published.status}`}).`,
    );
}

/** `gh pr view --json state,mergeCommit`: GitHub's word on whether a PR merged, and as which commit. */
const mergedPullSchema = z.object({
  state: z.string(),
  mergeCommit: z.object({ oid: z.string() }).nullable(),
});

/** The adapter on the real repository, GitHub and runner. */
export function createQueueAdapter(options: {
  repository: string;
  runner: string;
  workDir: string;
  runUrlBase: string;
  ledger?: string;
  /** The CI App's id from .github/scripts/check-app.json, or null while none exists. */
  appId: number | null;
  /** Runs the publisher's `queue` mode as the App's user; required once an App is configured. */
  publisher?: string;
  /** With a main runner, the tick's id: main's run a merge would owe is saved under it. */
  mainFollowUpId?: string;
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
  const { appId } = options;
  /** A queued PR's `Check` from the App's check runs on its head; other PRs keep GitHub's status. */
  const withAppCheck = (pull: QueuedPull): QueuedPull =>
    appId === null || pull.queuedAt === null
      ? pull
      : {
          ...pull,
          check: appCheckStateOf(
            JSON.parse(
              gh(
                'api',
                '--paginate',
                '--slurp',
                `repos/{owner}/{repo}/commits/${pull.headSha}/check-runs?check_name=Check&app_id=${appId}&filter=all&per_page=100`,
              ),
            ),
            appId,
          ),
        };
  const mark = (head: string, state: Mark['state'], description: string, runUrl: string) =>
    markQueue(options, { head, state, description, runUrl }, gh);
  const stateFile = join(options.workDir, QUEUE_STATE_FILE);
  const disableAutoMerge = (number: number): void => {
    gh('pr', 'merge', String(number), '--disable-auto');
  };
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
      ).map(withAppCheck),
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
    migrationProblems: async (parent, entry) => {
      // Only the batch's order counts here: open PRs' versions are the integration run's Fast gate's.
      const problems = migrationOrderProblems({
        repositoryRoot: options.repository,
        mainRef: parent,
        head: entry.commit,
        openPullRequests: [],
      });
      if (problems.length)
        console.info(`[queue] #${entry.pull.number}: migration order: ${problems.join(' ')}`);
      return problems;
    },
    updateBranch: async (pull) => {
      // Only at the head the queue saw green: GitHub refuses the update once the branch moved on.
      gh(
        'api',
        '--method',
        'PUT',
        `repos/{owner}/{repo}/pulls/${pull.number}/update-branch`,
        '-f',
        `expected_head_sha=${pull.headSha}`,
      );
      console.info(`[queue] #${pull.number}: branch updated with main`);
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
    disableAutoMerge: async (pull) => {
      disableAutoMerge(pull.number);
      console.info(`[queue] #${pull.number}: auto-merge off`);
    },
    oweMainRun: async ({ base, prs, merging }) => {
      if (options.mainFollowUpId)
        saveMainFollowUp(options.workDir, { base, prs: [...prs], id: options.mainFollowUpId, merging });
    },
    land: async (pull, proof) => {
      mark(pull.headSha, 'success', `Passed in ${proof.runUrl}`, proof.runUrl);
      gh('pr', 'merge', String(pull.number), '--squash', '--match-head-commit', pull.headSha);
      console.info(`[queue] #${pull.number}: merged`);
    },
    mergeCommit: async (number) => {
      const merged = mergedPullSchema.parse(
        JSON.parse(gh('pr', 'view', String(number), '--json', 'state,mergeCommit')),
      );
      if (merged.state !== 'MERGED') return null;
      // Merged without a commit is no answer: read as unmerged, it would clear main's owed run.
      if (!merged.mergeCommit) throw new Error(`GitHub reports #${number} merged without a merge commit`);
      return merged.mergeCommit.oid;
    },
    withdraw: async (pending) => {
      mark(pending.head, 'failure', 'Withdrawn: a queue pass counts only for its own merge', pending.runUrl);
      console.info(`[queue] #${pending.pull}: Queue withdrawn on ${pending.head}`);
    },
    state: async () => readQueueState(stateFile),
    saveState: async (state) => writeQueueState(stateFile, state),
    proven: async (tree) => {
      const ledger = ledgerOf(options.ledger);
      return ledger !== undefined && provenTree(ledger, tree) !== undefined;
    },
    reject: async (pull, proof) => {
      disableAutoMerge(pull.number);
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
