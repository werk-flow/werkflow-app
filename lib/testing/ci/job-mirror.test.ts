// On the CI mirror (scripts/ci/mirror-executor.ts) a job runs the real scripts/ci/job.ts on a
// parentless commit of the source's tree: its result names the source commit and tree, and Fast
// splits into the mirror's part and the host's part, which runs the groups that read outside the tree.
// The source comes from the mirror commit's own message, never from a variable a runner sets.
import { expect, test } from 'bun:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  EMPTY_OUTPUTS,
  fixture,
  inFolder,
  planOf,
  RUN_URL,
  runJob,
  writePlan,
} from '../fixtures/ci-job-repository';
import { mirrorMessage } from './mirror-message';
import { readResult, resultFileName } from './results';

// The CI mirror pushes the source's tree as a parentless commit of its own with the workflows moved
// aside (scripts/ci/mirror-push.ts); Fast's groups that read outside the tree run on the host.
const SOURCE_COMMIT = 'c'.repeat(40);
const SOURCE_TREE = 'a'.repeat(40);
const mirrorPlan = (root: string) =>
  planOf(root, {
    tree: SOURCE_TREE,
    commit: SOURCE_COMMIT,
    plan: {
      jobs: ['plan', 'fast', 'check'],
      skips: {},
      shards: [],
      outputs: { ...EMPTY_OUTPUTS, selected_static: 'static:migration-order,static:format' },
    },
  });

/** Rewrites the fixture's one commit, which has no parent, as the mirror's commit of `job`. */
function asMirrorCommit(root: string, job: 'fast' | 'sql'): void {
  const message = mirrorMessage({
    version: 1,
    job,
    shard: null,
    source: { commit: SOURCE_COMMIT, tree: SOURCE_TREE },
    variables: {},
    plan: {},
  });
  execFileSync(
    'git',
    [
      '-c',
      'user.name=CI mirror',
      '-c',
      'user.email=ci-mirror@ci.invalid',
      'commit',
      '--quiet',
      '--amend',
      '--no-gpg-sign',
      '-F',
      '-',
    ],
    {
      cwd: root,
      input: message,
    },
  );
}

test("on the CI mirror Fast's tree part names the source its commit's message holds and runs every group but the host's", () => {
  inFolder((folder) => {
    const root = fixture(folder);
    asMirrorCommit(root, 'fast');
    const run = join(folder, 'run');
    const dumps = join(folder, 'dumps');
    mkdirSync(dumps);
    mkdirSync(run);
    writeFileSync(join(run, resultFileName('plan', null)), JSON.stringify(mirrorPlan(root)));
    const variables = {
      CI_EVENT: 'integration',
      CI_RESULTS_DIR: run,
      CI_PRODUCER: 'mac-standin',
      CI_RUN_URL: RUN_URL,
      CI_PART: 'tree',
      ENV_DUMP_DIR: dumps,
    };
    expect(runJob(root, 'fast', variables)).toBe(0);
    const fast = readResult(join(run, resultFileName('fast', null)));
    if ('unreadable' in fast) throw new Error(fast.unreadable);
    expect([fast.status, fast.commit, fast.tree, fast.producer]).toEqual([
      'passed',
      SOURCE_COMMIT,
      SOURCE_TREE,
      'mac-standin',
    ]);
    expect(fast.groups.map((group) => group.id)).toEqual(['static:format', 'step:build']);
    // A mirror commit of another job runs nothing as this one.
    asMirrorCommit(root, 'sql');
    expect(runJob(root, 'fast', variables)).toBe(1);
  });
});

test('the tree part refuses a checkout that is no mirror commit, and only Fast has a host part', () => {
  inFolder((folder) => {
    const root = fixture(folder);
    const run = join(folder, 'run');
    writePlan(root, run, { plan: mirrorPlan(root).plan });
    const variables = {
      CI_EVENT: 'integration',
      CI_RESULTS_DIR: run,
      CI_PRODUCER: 'mac-standin',
      CI_RUN_URL: RUN_URL,
    };
    expect(runJob(root, 'fast', { ...variables, CI_PART: 'tree' })).toBe(1);
    expect(readResult(join(run, resultFileName('fast', null)))).toHaveProperty('unreadable');
    expect(runJob(root, 'sql', { ...variables, CI_PART: 'host' })).toBe(1);
  });
});

test("Fast's host part runs only the groups that read outside the tree, without the build", () => {
  inFolder((folder) => {
    const root = fixture(folder);
    const run = join(folder, 'run');
    const dumps = join(folder, 'dumps');
    mkdirSync(dumps);
    writePlan(root, run, { plan: mirrorPlan(root).plan });
    expect(
      runJob(root, 'fast', {
        CI_EVENT: 'integration',
        CI_RESULTS_DIR: run,
        CI_PRODUCER: 'mac-standin',
        CI_RUN_URL: RUN_URL,
        CI_PART: 'host',
        ENV_DUMP_DIR: dumps,
      }),
    ).toBe(0);
    const fast = readResult(join(run, resultFileName('fast', null)));
    expect('groups' in fast && fast.groups.map((group) => group.id)).toEqual(['static:migration-order']);
    // The fake gate's report aside, only the host group ran: no build.
    const ran = spawnSync('ls', [dumps], { encoding: 'utf8' }).stdout.split('\n');
    expect(ran.filter((file) => file.endsWith('.json') && file !== 'report.json')).toEqual([
      'static:migration-order.json',
    ]);
  });
});

test('a mirror message on a commit that has a parent runs nothing, even in a shallow checkout that hides it', () => {
  inFolder((folder) => {
    const root = fixture(folder);
    writeFileSync(join(root, 'second.txt'), 'second\n');
    execFileSync('git', ['-c', 'user.name=ci', '-c', 'user.email=ci@example.invalid', 'add', 'second.txt'], {
      cwd: root,
    });
    execFileSync(
      'git',
      ['-c', 'user.name=ci', '-c', 'user.email=ci@example.invalid', 'commit', '--quiet', '-m', 'second'],
      { cwd: root },
    );
    asMirrorCommit(root, 'fast');
    const shallow = join(folder, 'shallow');
    execFileSync('git', ['clone', '--quiet', '--depth', '1', `file://${root}`, shallow]);
    const run = join(folder, 'run');
    mkdirSync(run);
    writeFileSync(join(run, resultFileName('plan', null)), JSON.stringify(mirrorPlan(shallow)));
    expect(
      runJob(shallow, 'fast', {
        CI_EVENT: 'integration',
        CI_RESULTS_DIR: run,
        CI_PRODUCER: 'mac-standin',
        CI_RUN_URL: RUN_URL,
        CI_PART: 'tree',
      }),
    ).toBe(1);
    expect(readResult(join(run, resultFileName('fast', null)))).toHaveProperty('unreadable');
  });
});
