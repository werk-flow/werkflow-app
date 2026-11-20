import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { captureInputSnapshot } from '../lib/testing/evidence/group-evidence';
import { createGroupQualification } from '../lib/testing/evidence/group-qualification';
import { ciBrowserHoldUntil, midnightProofHoldUntil } from '../lib/testing/runner/group-schedule';
import { changesOnlyRows, ciPlan, REGISTRY_ROWS, runnerModules } from '../lib/testing/selection/ci-plan';
import { renderedSurfaceFiles, surfaceRoots } from '../lib/testing/selection/surface-closure';
import { getTestGroups } from '../lib/testing/selection/test-groups';

// The `Plan` job of .github/workflows/ci.yml: which browser groups this run
// executes and how they split into shards (lib/testing/selection/ci-plan.ts).
// Usage: bun scripts/ci-plan.ts --base <commit> | --full "<reason>"
// --base is a pull request's base or, for a push to main, the previous main
// commit. A base git cannot read (a force push, a new branch) plans a full run.
// It writes `browser`, `shards`, `full`, `full_reason` and `midnight_until` to $GITHUB_OUTPUT when set.
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
    console.warn(`[ci-plan] Cannot diff against ${base}: ${error instanceof Error ? error.message : error}`);
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
  runnerModules: runnerModules(qualification.graph),
});

console.info(
  `[ci-plan] ${plan.fullReason ? `Full run: ${plan.fullReason}` : 'Selection by diff'}; ${plan.browser.length} browser groups in ${plan.shards.length} shards.`,
);
for (const entry of plan.browser) console.info(`  ${entry.id} | ${entry.reason}`);
for (const shard of plan.shards) console.info(`  shard ${shard.shard}: ${shard.groups}`);
const now = new Date();
const proofMinutes = process.env.MIDNIGHT_PROOF_MINUTES;
const holdUntil = proofMinutes
  ? midnightProofHoldUntil({ now, minutes: proofMinutes, ref: process.env.GITHUB_REF_NAME ?? '' })
  : ciBrowserHoldUntil(now);
// A pull request's run starts no browser shard (scripts/ci/job.ts plan), so it never waits.
const midnightUntil =
  process.env.CI_EVENT !== 'pr' && plan.shards.length && holdUntil ? holdUntil.toISOString() : '';
if (midnightUntil) {
  const message = `This run waits on purpose${proofMinutes ? ' (proof run)' : ''}: the browser shards start at ${midnightUntil}. No browser group starts from 23:40 to 00:10 Berlin time, and a Browser job that started now could reach that window within its timeout. The other jobs run meanwhile; Check reports after the shards.`;
  console.info(`::notice title=Midnight wait::${message}`);
  // This job ends before the wait starts, so its summary is on the run page during the wait.
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) appendFileSync(summary, `${message}\n`);
}
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
      '',
    ].join('\n'),
  );
