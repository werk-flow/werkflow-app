import { execFileSync } from 'node:child_process';
import { appendFileSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { captureInputSnapshot } from '../lib/testing/evidence/group-evidence';
import { createGroupQualification } from '../lib/testing/evidence/group-qualification';
import { ciBrowserHoldUntil, midnightProofHoldUntil } from '../lib/testing/runner/group-schedule';
import {
  CI_JOB_BODIES,
  changesOnlyRows,
  ciPlan,
  componentShards,
  planLog,
  REGISTRY_ROWS,
  runnerModules,
  scriptsCiRuns,
} from '../lib/testing/selection/ci-plan';
import { fastTierPlan, tailwindScan } from '../lib/testing/selection/fast-tier';
import { readGroupDurations } from '../lib/testing/selection/group-durations';
import { renderedSurfaceFiles, surfaceRoots } from '../lib/testing/selection/surface-closure';
import { getTestGroups } from '../lib/testing/selection/test-groups';
import { z } from '../lib/zod';

// The `Plan` job of .github/workflows/ci.yml: which browser groups this run
// executes and how they split into shards (lib/testing/selection/ci-plan.ts).
// Usage: bun scripts/ci-plan.ts --base <commit> | --full "<reason>"
// --base is a pull request's base or, for a push to main, the previous main
// commit. A base git cannot read (a force push, a new branch) plans a full run.
// It writes `browser`, `shards`, `full`, `full_reason` and `midnight_until` to $GITHUB_OUTPUT when
// set, and the fast tier's selection (lib/testing/selection/fast-tier.ts): `selected_components`,
// `component_shards`, `selected_unit`, `selected_sql`, `selected_static` and `selected_lint`, each
// group list comma-separated and empty when the run needs none.
// scripts/ci/job.ts plan runs it and decides which jobs the run executes; with CI_EVENT=pr it
// sets no midnight hold.
const repository = resolve(import.meta.dir, '..');
const [flag, value] = process.argv.slice(2);
if ((flag !== '--base' && flag !== '--full') || !value)
  throw new Error('Usage: bun scripts/ci-plan.ts --base <commit> | --full "<reason>"');

const git = (...args: string[]): string =>
  execFileSync('git', args, { cwd: repository, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });

/**
 * The files the change touches since its merge base with the base commit, and the changed
 * registries whose change stays inside their rows; undefined when git cannot say.
 */
function changedSince(base: string): { files: string[]; rowChanges: string[] } | undefined {
  try {
    const mergeBase = git('merge-base', base, 'HEAD').trim();
    const files = git('diff', '--name-only', '--no-renames', '-z', mergeBase, 'HEAD', '--')
      .split('\0')
      .filter(Boolean);
    return { files, rowChanges: files.filter((file) => rowsOnly(mergeBase, file)) };
  } catch (error) {
    console.warn(
      `[ci-plan] Cannot diff against ${JSON.stringify(base)}: ${JSON.stringify(error instanceof Error ? error.message : String(error))}`,
    );
    return undefined;
  }
}

/** A registry that is new or gone at either end is no row change. */
function rowsOnly(mergeBase: string, file: string): boolean {
  if (!REGISTRY_ROWS[file]) return false;
  try {
    return changesOnlyRows(file, git('show', `${mergeBase}:${file}`), git('show', `HEAD:${file}`));
  } catch {
    return false;
  }
}

const groups = getTestGroups(repository);
const qualification = createGroupQualification(repository, groups, captureInputSnapshot(repository));
const rendered = renderedSurfaceFiles(qualification.graph, surfaceRoots(repository));
const change = flag === '--base' ? changedSince(value) : undefined;
const durations = readGroupDurations(repository);
const read = (path: string): string => readFileSync(join(repository, path), 'utf8');
// The workflow, its actions and the job bodies name the scripts CI runs; a file that cannot be read
// stops the plan.
const ciScripts = scriptsCiRuns(
  [
    read('.github/workflows/ci.yml'),
    ...readdirSync(join(repository, '.github/actions')).map((action) =>
      read(`.github/actions/${action}/action.yml`),
    ),
    ...CI_JOB_BODIES.map(read),
  ],
  z.object({ scripts: z.record(z.string(), z.string()) }).parse(JSON.parse(read('package.json'))).scripts,
);
const plan = ciPlan({
  groups: groups.map((group) => ({
    id: group.id,
    kind: group.kind,
    files: group.files,
    scopes: group.scopes,
    executionInputs: qualification.qualify(group).executionInputs ?? [],
    trigger: group.changeTrigger,
    renderedFiles: rendered.get(group.id),
  })),
  changedFiles: flag === '--base' ? change?.files : [],
  rowChanges: change?.rowChanges ?? [],
  fullRun: flag === '--full' ? value : undefined,
  runnerModules: runnerModules(qualification.graph, ciScripts),
  durations,
});
const fast = fastTierPlan({
  groups,
  graph: qualification.graph,
  changedFiles: flag === '--base' ? change?.files : [],
  fullReason: plan.fullReason,
  rowChanges: change?.rowChanges ?? [],
  tailwindScans: await tailwindScan(read('app/globals.css'), repository),
});

for (const line of planLog(plan, fast.reasons)) console.info(line);
const now = new Date();
const proofMinutes = process.env.MIDNIGHT_PROOF_MINUTES;
const holdUntil = proofMinutes
  ? midnightProofHoldUntil({ now, minutes: proofMinutes, ref: process.env.GITHUB_REF_NAME ?? '' })
  : ciBrowserHoldUntil(now);
// A pull request's run starts no browser shard (scripts/ci/job.ts plan), so it never waits.
// scripts/ci/job.ts plan announces the wait from its final plan, after reuse.
const midnightUntil =
  process.env.CI_EVENT !== 'pr' && plan.shards.length && holdUntil ? holdUntil.toISOString() : '';
const output = process.env.GITHUB_OUTPUT;
if (output)
  appendFileSync(
    output,
    [
      `browser=${plan.shards.length ? 'true' : 'false'}`,
      `full=${plan.fullReason ? 'true' : 'false'}`,
      `full_reason=${(plan.fullReason ?? '').replace(/\s+/g, ' ')}`,
      `shards=${JSON.stringify(plan.shards)}`,
      `midnight_until=${midnightUntil}`,
      // The static and SQL jobs take every group of their kind, so a new group joins CI by registration.
      `static=${groups.filter((group) => group.kind === 'static' && group.id !== 'static:lint').map((group) => group.id)}`,
      `sql=${groups.filter((group) => group.kind === 'sql').map((group) => group.id)}`,
      `selected_components=${fast.components}`,
      `component_shards=${JSON.stringify(componentShards(fast.components, durations))}`,
      `selected_unit=${fast.unit}`,
      `selected_sql=${fast.sql}`,
      `selected_static=${fast.static}`,
      `selected_lint=${fast.lint}`,
      '',
    ].join('\n'),
  );
