import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { captureInputSnapshot } from '../lib/testing/evidence/group-evidence';
import { createGroupQualification } from '../lib/testing/evidence/group-qualification';
import { ciPlan } from '../lib/testing/selection/ci-plan';
import { getTestGroups } from '../lib/testing/selection/test-groups';

// The `Plan` job of .github/workflows/ci.yml: which browser groups this run
// executes and how they split into shards (lib/testing/selection/ci-plan.ts).
// Usage: bun scripts/ci-plan.ts --base <commit> | --full "<reason>"
// It writes `browser`, `shards` and `full` to $GITHUB_OUTPUT when set.
const repository = resolve(import.meta.dir, '..');
const [flag, value] = process.argv.slice(2);
if ((flag !== '--base' && flag !== '--full') || !value)
  throw new Error('Usage: bun scripts/ci-plan.ts --base <commit> | --full "<reason>"');

/** The files the change touches since its merge base with the base commit; undefined when git cannot say. */
function changedSince(base: string): string[] | undefined {
  try {
    const mergeBase = execFileSync('git', ['merge-base', base, 'HEAD'], {
      cwd: repository,
      encoding: 'utf8',
    });
    return execFileSync(
      'git',
      ['diff', '--name-only', '--no-renames', '-z', mergeBase.trim(), 'HEAD', '--'],
      {
        cwd: repository,
        encoding: 'utf8',
        maxBuffer: 16 * 1024 * 1024,
      },
    )
      .split('\0')
      .filter(Boolean);
  } catch (error) {
    console.warn(`[ci-plan] Cannot diff against ${base}: ${error instanceof Error ? error.message : error}`);
    return undefined;
  }
}

const groups = getTestGroups(repository);
const qualification = createGroupQualification(repository, groups, captureInputSnapshot(repository));
const plan = ciPlan({
  groups: groups.map((group) => ({
    id: group.id,
    kind: group.kind,
    files: group.files,
    scopes: group.scopes,
    executionInputs: qualification.qualify(group).executionInputs ?? [],
  })),
  changedFiles: flag === '--base' ? changedSince(value) : [],
  fullRun: flag === '--full' ? value : undefined,
});

console.info(
  `[ci-plan] ${plan.fullReason ? `Full run: ${plan.fullReason}` : 'Selection by diff'}; ${plan.browser.length} browser groups in ${plan.shards.length} shards.`,
);
for (const entry of plan.browser) console.info(`  ${entry.id} | ${entry.reason}`);
for (const shard of plan.shards) console.info(`  shard ${shard.shard}: ${shard.groups}`);
const output = process.env.GITHUB_OUTPUT;
if (output)
  appendFileSync(
    output,
    [
      `browser=${plan.shards.length ? 'true' : 'false'}`,
      `full=${plan.fullReason ? 'true' : 'false'}`,
      `shards=${JSON.stringify(plan.shards)}`,
      // The static and SQL jobs take every group of their kind, so a new group joins CI by registration.
      `static=${groups.filter((group) => group.kind === 'static' && group.id !== 'static:lint').map((group) => group.id)}`,
      `sql=${groups.filter((group) => group.kind === 'sql').map((group) => group.id)}`,
      '',
    ].join('\n'),
  );
