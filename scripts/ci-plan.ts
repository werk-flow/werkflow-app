import { execFileSync } from 'node:child_process';
import { appendFileSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { captureInputSnapshot } from '../lib/testing/evidence/group-evidence';
import { createGroupQualification } from '../lib/testing/evidence/group-qualification';
import { ciBrowserHoldUntil, midnightProofHoldUntil } from '../lib/testing/runner/group-schedule';
import {
  actionJobsOf,
  CI_JOB_BODIES,
  changesOnlyRows,
  ciPlan,
  componentShards,
  planLog,
  REGISTRY_ROWS,
  runnerModules,
  scriptsCiRuns,
} from '../lib/testing/selection/ci-plan';
import {
  lockfileChange,
  packageJsonChange,
  type DependencyChange,
} from '../lib/testing/selection/dependency-change';
import { E_INVOICE_STEP, eInvoiceReason } from '../lib/testing/selection/e-invoice-selection';
import { fastTierPlan, tailwindScan } from '../lib/testing/selection/fast-tier';
import { readGroupDurations } from '../lib/testing/selection/group-durations';
import { renderedSurfaceFiles, surfaceRoots } from '../lib/testing/selection/surface-closure';
import { getTestGroups } from '../lib/testing/selection/test-groups';
import { z } from '../lib/zod';
import { workflowsFolder } from '../lib/testing/ci-workflow';

// The `Plan` job of .github/workflows/ci.yml: which browser groups this run
// executes and how they split into shards (lib/testing/selection/ci-plan.ts).
// Usage: bun scripts/ci-plan.ts --base <commit> | --full "<reason>"
// --base is a pull request's base or, for a push to main, the previous main
// commit. A base git cannot read (a force push, a new branch) plans a full run.
// It writes `browser`, `shards`, `full`, `full_reason`, `tooling_reason` (a tooling change that
// runs a sample, owner decision D3) and `midnight_until` to $GITHUB_OUTPUT when set, and the fast
// tier's selection (lib/testing/selection/fast-tier.ts): `selected_components`, `component_shards`,
// `selected_unit`, `selected_sql`, `selected_static` and `selected_lint`, and `selected_invoices`
// (lib/testing/selection/e-invoice-selection.ts), each group list comma-separated and empty when
// the run needs none.
// scripts/ci/job.ts plan runs it and decides which jobs the run executes; with CI_EVENT=pr it
// sets no midnight hold.
const repository = resolve(import.meta.dir, '..');
const [flag, value] = process.argv.slice(2);
if ((flag !== '--base' && flag !== '--full') || !value)
  throw new Error('Usage: bun scripts/ci-plan.ts --base <commit> | --full "<reason>"');

const git = (...args: string[]): string =>
  execFileSync('git', args, { cwd: repository, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });

/**
 * The files the change touches since its merge base with the base commit, the changed
 * registries whose change stays inside their rows, and the effect of each changed dependency file;
 * undefined when git cannot say.
 */
function changedSince(
  base: string,
): { files: string[]; rowChanges: string[]; dependencies: Record<string, DependencyChange> } | undefined {
  try {
    const mergeBase = git('merge-base', base, 'HEAD').trim();
    const files = git('diff', '--name-only', '--no-renames', '-z', mergeBase, 'HEAD', '--')
      .split('\0')
      .filter(Boolean);
    return {
      files,
      rowChanges: files.filter((file) => rowsOnly(mergeBase, file)),
      dependencies: dependencyChanges(mergeBase, files),
    };
  } catch (error) {
    console.warn(
      `[ci-plan] Cannot diff against ${JSON.stringify(base)}: ${JSON.stringify(error instanceof Error ? error.message : String(error))}`,
    );
    return undefined;
  }
}

/** A dependency file that is new or gone at either end cannot be read, so it runs every group. */
function dependencyChanges(mergeBase: string, files: readonly string[]): Record<string, DependencyChange> {
  const classifiers = { 'package.json': packageJsonChange, 'bun.lock': lockfileChange };
  return Object.fromEntries(
    Object.entries(classifiers)
      .filter(([file]) => files.includes(file))
      .map(([file, classify]) => {
        try {
          return [file, classify(git('show', `${mergeBase}:${file}`), git('show', `HEAD:${file}`))];
        } catch {
          return [file, { effect: 'every-group', reason: `${file} is new or gone` }];
        }
      }),
  );
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
const actions = Object.fromEntries(
  readdirSync(join(repository, '.github/actions')).map((action) => [
    action,
    read(`.github/actions/${action}/action.yml`),
  ]),
);
const ciScripts = scriptsCiRuns(
  [read(`${workflowsFolder()}/ci.yml`), ...Object.values(actions), ...CI_JOB_BODIES.map(read)],
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
  dependencies: change?.dependencies ?? {},
  actionJobs: actionJobsOf(read(`${workflowsFolder()}/ci.yml`), actions),
  fullRun: flag === '--full' ? value : undefined,
  runnerModules: runnerModules(qualification.graph, ciScripts),
  durations,
});
const fast = fastTierPlan({
  groups,
  graph: qualification.graph,
  // A dependency change that moves only lint and type packages selects no group of its own.
  changedFiles:
    flag === '--base' ? change?.files.filter((file) => !plan.tooling.lintOnly.includes(file)) : [],
  fullReason: plan.fullReason,
  everyGroupOf: plan.tooling.fast,
  rowChanges: change?.rowChanges ?? [],
  tailwindScans: await tailwindScan(read('app/globals.css'), repository),
});

const invoices = eInvoiceReason({
  graph: qualification.graph,
  changedFiles: flag === '--base' ? change?.files : [],
  lintOnly: plan.tooling.lintOnly,
  fullReason: plan.fullReason,
  toolingReason: plan.tooling.invoices,
});
for (const line of planLog(plan, fast.reasons, invoices)) console.info(line);
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
      `tooling_reason=${(plan.fullReason ? '' : (plan.tooling.browser ?? '')).replace(/\s+/g, ' ')}`,
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
      `selected_invoices=${invoices ? E_INVOICE_STEP : ''}`,
      '',
    ].join('\n'),
  );
