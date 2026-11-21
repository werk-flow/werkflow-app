// On the CI mirror (scripts/ci/mirror-executor.ts) a job runs the real scripts/ci/job.ts on a
// parentless commit of the source's tree: its result names the source commit and tree, and Fast
// splits into the mirror's part and the host's part, which runs the groups that read outside the tree.
import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
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

test("on the CI mirror Fast's tree part names the source commit and tree and runs every group but the host's, and the build", () => {
  inFolder((folder) => {
    const root = fixture(folder);
    const run = join(folder, 'run');
    const dumps = join(folder, 'dumps');
    mkdirSync(dumps);
    mkdirSync(run);
    writeFileSync(join(run, resultFileName('plan', null)), JSON.stringify(mirrorPlan(root)));
    const code = runJob(root, 'fast', {
      CI_EVENT: 'integration',
      CI_RESULTS_DIR: run,
      CI_PRODUCER: 'mac-standin',
      CI_RUN_URL: RUN_URL,
      CI_SOURCE_COMMIT: SOURCE_COMMIT,
      CI_SOURCE_TREE: SOURCE_TREE,
      CI_PART: 'tree',
      ENV_DUMP_DIR: dumps,
    });
    const fast = readResult(join(run, resultFileName('fast', null)));
    if ('unreadable' in fast) throw new Error(fast.unreadable);
    expect([code, fast.status, fast.commit, fast.tree, fast.producer]).toEqual([
      0,
      'passed',
      SOURCE_COMMIT,
      SOURCE_TREE,
      'mac-standin',
    ]);
    expect(fast.groups.map((group) => group.id)).toEqual(['static:format', 'step:build']);
  });
});

test("Fast's host part runs only the groups that read outside the tree, without the build, and half a source identity fails", () => {
  inFolder((folder) => {
    const root = fixture(folder);
    const run = join(folder, 'run');
    const dumps = join(folder, 'dumps');
    mkdirSync(dumps);
    writePlan(root, run, { plan: mirrorPlan(root).plan });
    const variables = {
      CI_EVENT: 'integration',
      CI_RESULTS_DIR: run,
      CI_PRODUCER: 'mac-standin',
      CI_RUN_URL: RUN_URL,
      ENV_DUMP_DIR: dumps,
    };
    expect(runJob(root, 'fast', { ...variables, CI_PART: 'host' })).toBe(0);
    const fast = readResult(join(run, resultFileName('fast', null)));
    expect('groups' in fast && fast.groups.map((group) => group.id)).toEqual(['static:migration-order']);
    // The fake gate's report aside, only the host group ran: no build.
    const ran = spawnSync('ls', [dumps], { encoding: 'utf8' }).stdout.split('\n');
    expect(ran.filter((file) => file.endsWith('.json') && file !== 'report.json')).toEqual([
      'static:migration-order.json',
    ]);
    expect(runJob(root, 'fast', { ...variables, CI_SOURCE_COMMIT: SOURCE_COMMIT })).toBe(1);
  });
});
