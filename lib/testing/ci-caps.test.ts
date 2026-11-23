// The caps that keep GitHub Actions near 9,000 job-minutes a day and well under the account's 60
// concurrent jobs (docs/technical/testing.md, "CI"). Each assertion names the cap a later edit of a
// workflow would remove.
import { expect, test } from 'bun:test';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { MAX_SHARDS } from './selection/ci-plan';
import { readWorkflow, workflowsFolder } from './ci-workflow';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

test('a newer push to a pull request cancels its older run, and nothing else cancels a run', () => {
  const ci = readWorkflow('ci.yml');
  // The key of an ordinary push to a PR is `ci-<number>-diff`: every other part is guarded by a
  // condition false on a first attempt of a synchronize event, so no run id or commit enters it.
  const parts = ci
    .text('concurrency', 'group')
    .split(/(\$\{\{.*?\}\})/)
    .filter(Boolean);
  expect(parts.slice(0, 4)).toEqual([
    'ci-',
    '${{ github.event.pull_request.number || github.sha }}',
    '-',
    "${{ inputs.full && 'full' || 'diff' }}",
  ]);
  const guards = [
    "github.run_attempt != '1' && ",
    "github.event.action == 'edited' && !github.event.changes.base && ",
  ];
  expect(parts.slice(4).map((part, index) => part.startsWith(`\${{ ${guards[index]}`))).toEqual([true, true]);
  expect(ci.text('concurrency', 'cancel-in-progress')).toBe("${{ github.event_name == 'pull_request' }}");
});

test('a run starts at most the planned browser shards at once, and the date look-ahead at most four legs', () => {
  expect(readWorkflow('ci.yml').at('jobs', 'browser', 'strategy', 'max-parallel')).toBe(MAX_SHARDS);
  const lookahead = readWorkflow('date-lookahead.yml');
  expect(lookahead.at('jobs', 'leg', 'strategy', 'max-parallel')).toBe(4);
  // One look-ahead at a time, and a new one never cancels a run in progress.
  expect(lookahead.at('concurrency')).toEqual({ group: 'date-lookahead', 'cancel-in-progress': false });
});

test('a scheduled nightly skips only on a successful decision that found a green full run', () => {
  const nightly = readWorkflow('nightly.yml');
  expect(nightly.at('jobs', 'decide', 'if')).toBe("github.event_name == 'schedule'");
  expect(nightly.at('jobs', 'decide', 'outputs')).toEqual({
    head_has_full_run: '${{ steps.decide.outputs.head_has_full_run }}',
  });
  expect(nightly.step('decide', 'Decide whether the head has a full run')).toMatchObject({
    id: 'decide',
    run: 'bash .github/scripts/full-run-verdict.sh head',
  });
  expect(nightly.at('jobs', 'full', 'needs')).toBe('decide');
  expect(nightly.text('jobs', 'full', 'if')).toBe(
    "${{ !cancelled() && !inputs.alert_proof && !(needs.decide.result == 'success' && needs.decide.outputs.head_has_full_run == 'true') }}",
  );
});

test('every job of every workflow (.yml or .yaml) that runs on a runner has its own timeout, so a hung job never runs for 6 hours unnoticed', () => {
  const folder = resolve(import.meta.dir, '../..', workflowsFolder());
  const files = readdirSync(folder).filter((file) => /\.ya?ml$/.test(file));
  expect(files.length).toBeGreaterThan(0);
  for (const file of files) {
    const jobs = readWorkflow(file).at('jobs');
    if (!isRecord(jobs)) throw new Error(`${file} has no jobs`);
    for (const [name, job] of Object.entries(jobs)) {
      // A call of another workflow takes the called jobs' timeouts.
      if (!isRecord(job) || 'uses' in job) continue;
      expect(typeof job['timeout-minutes'], `${file} ${name}`).toBe('number');
    }
  }
});
