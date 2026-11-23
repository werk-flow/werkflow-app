// A fake of GitHub's API for the CI mirror (scripts/ci/mirror-api.ts) over a bare repository as the
// mirror, for lib/testing/ci/mirror-executor.test.ts: it runs each pushed job as a scenario says. No
// network.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { MirrorApi, MirrorJob, MirrorRun } from '../../../scripts/ci/mirror-api';
import { CI_DAG, CI_JOBS } from '../ci/dag';
import { MIRROR_WORKFLOW } from '../ci/mirror';
import { type CiResult, resultFileName } from '../ci/results';
import type { Unit } from '../ci/run-commit';

export const git = (cwd: string, ...args: string[]): string =>
  execFileSync(
    'git',
    [
      '-c',
      'user.name=Owner',
      '-c',
      'user.email=owner@example.invalid',
      '-c',
      'commit.gpgSign=false',
      ...args,
    ],
    { cwd, encoding: 'utf8' },
  ).trim();

const unitOf = (branch: string): Unit => {
  const name = branch.split('/').at(-1) ?? '';
  const [job = '', shard] = name.split('-');
  const known = CI_JOBS.find((candidate) => candidate === job);
  if (!known) throw new Error(`no job in ${branch}`);
  return { job: known, shard: shard === undefined ? null : Number(shard) };
};

export type Scenario = {
  /** The pushed commit's tree as the API reports it, when it lies. */
  tree?: string;
  conclusion?: string;
  /** Holds a run in progress while it returns true for the run's id. */
  running?: (id: number) => boolean;
  attempt?: number;
  /** The branch cannot be read once it exists, as when the API fails right after a push. */
  unreadableBranch?: boolean;
  cancelFails?: () => boolean;
  /** The mirror reruns the job once its result artifact was downloaded. */
  rerunAfterDownload?: boolean;
  otherJobRan?: boolean;
  /** The result file the artifact holds, or the files it holds. */
  result?: (unit: Unit) => CiResult;
  files?: (unit: Unit, result: CiResult) => Record<string, string>;
  onRunsOf?: () => void;
  /** Told each time the mirror starts a run of a push, with the number of runs so far and its branch. */
  onRun?: (runs: number, branch: string) => void;
  /** Holds back the run of a push to `branch` while it returns false, as a mirror slow to start it. */
  startsRun?: (branch: string) => boolean;
};

export type Fake = {
  api: MirrorApi;
  cancelled: number[];
  deleted: string[];
};

/** The commit `branch` names in the bare repository `remote`, or undefined. */
function branchHeadOf(remote: string, branch: string): string | undefined {
  const head = spawnSync('git', ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], {
    cwd: remote,
    encoding: 'utf8',
  });
  return head.status === 0 ? head.stdout.trim() : undefined;
}

/** A zip archive of `files`, built in a new folder under `folder`. */
function zipOf(folder: string, files: Record<string, string>): Uint8Array {
  const zipFolder = mkdtempSync(join(folder, 'zip-'));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(zipFolder, name), text);
  execFileSync('zip', [
    '-q',
    '-j',
    join(zipFolder, 'out.zip'),
    ...Object.keys(files).map((name) => join(zipFolder, name)),
  ]);
  return new Uint8Array(readFileSync(join(zipFolder, 'out.zip')));
}

/** The branch half of the API: the bare repository as the mirror's refs and commits. */
function branchApi(
  remote: string,
  scenario: Scenario,
  deleted: string[],
): Pick<MirrorApi, 'branchHead' | 'commit' | 'ciBranches' | 'deleteBranch'> {
  return {
    async branchHead(branch) {
      const head = branchHeadOf(remote, branch);
      if (head && scenario.unreadableBranch) throw new Error('GitHub GET /git/ref answered 502.');
      return head;
    },
    async commit(sha) {
      return {
        tree: scenario.tree ?? git(remote, 'rev-parse', `${sha}^{tree}`),
        committedAt: new Date(git(remote, 'log', '-1', '--format=%cI', sha)),
      };
    },
    async ciBranches() {
      const listed = git(
        remote,
        'for-each-ref',
        '--format=%(refname:lstrip=2) %(objectname)',
        'refs/heads/ci/',
      );
      return listed
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          const [name = '', sha = ''] = line.split(' ');
          return { name, sha };
        });
    },
    async deleteBranch(branch) {
      deleted.push(branch);
      git(remote, 'update-ref', '-d', `refs/heads/${branch}`);
    },
  };
}

/** A run's jobs: its own job as the run ended, every other one skipped unless the scenario ran it. */
function jobsOf(run: MirrorRun & { unit: Unit }, otherJobRan: boolean): MirrorJob[] {
  return Object.values(CI_DAG)
    .filter((spec) => spec.name !== 'Plan' && spec.name !== 'Check')
    .map(
      (spec): MirrorJob =>
        spec.name === CI_DAG[run.unit.job].name
          ? { name: spec.name, status: 'completed', conclusion: run.conclusion }
          : { name: spec.name, status: 'completed', conclusion: otherJobRan ? 'success' : 'skipped' },
    );
}

/**
 * A fake of the mirror's API over the bare repository `place.remote`: a push starts a run of its
 * branch's job, which ends as `scenario` says, and its artifact holds `place.result` unless the
 * scenario gives another. Zip archives are built under `place.folder`.
 */
export function fakeMirror(
  scenario: Scenario,
  place: { folder: string; remote: string; result: (unit: Unit) => CiResult },
): Fake {
  const runs = new Map<string, MirrorRun & { unit: Unit }>();
  const fake = { cancelled: new Array<number>(), deleted: new Array<string>() };
  let nextId = 1;
  const runById = (id: number) => {
    const found = [...runs.values()].find((run) => run.id === id);
    if (!found) throw new Error(`no run ${id}`);
    return found;
  };
  const settle = (run: MirrorRun) => {
    if (run.status !== 'completed' && !(scenario.running?.(run.id) ?? false)) {
      run.status = 'completed';
      run.conclusion = scenario.conclusion ?? 'success';
    }
    return { ...run };
  };
  const api: MirrorApi = {
    ...branchApi(place.remote, scenario, fake.deleted),
    async runsOf(branch, sha) {
      scenario.onRunsOf?.();
      const pushed = branchHeadOf(place.remote, branch) === sha;
      if (!runs.has(branch) && pushed && (scenario.startsRun?.(branch) ?? true)) {
        runs.set(branch, {
          id: nextId++,
          path: MIRROR_WORKFLOW,
          head_sha: sha,
          head_branch: branch,
          event: 'push',
          status: 'queued',
          conclusion: null,
          run_attempt: scenario.attempt ?? 1,
          unit: unitOf(branch),
        });
        scenario.onRun?.(runs.size, branch);
      }
      const run = runs.get(branch);
      return run ? [settle(run)] : [];
    },
    run: async (id) => settle(runById(id)),
    jobs: async (id) => jobsOf(runById(id), scenario.otherJobRan ?? false),
    async artifacts(id) {
      const run = runById(id);
      const name = run.unit.shard === null ? run.unit.job : `${run.unit.job}-${run.unit.shard}`;
      return [{ id: id * 10, name: `ci-result-${name}`, expired: false, workflow_run: { id } }];
    },
    async download(artifactId) {
      const run = runById(artifactId / 10);
      if (scenario.rerunAfterDownload) run.run_attempt = 2;
      const result = (scenario.result ?? place.result)(run.unit);
      const files = scenario.files?.(run.unit, result) ?? {
        [resultFileName(run.unit.job, run.unit.shard)]: JSON.stringify(result),
      };
      return zipOf(place.folder, files);
    },
    async cancel(id) {
      if (scenario.cancelFails?.()) throw new Error('GitHub POST /actions/runs/cancel answered 500.');
      fake.cancelled.push(id);
      const run = runById(id);
      run.status = 'completed';
      run.conclusion = 'cancelled';
    },
  };
  return { ...fake, api };
}
