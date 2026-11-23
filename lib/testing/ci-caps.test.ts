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
  expect(ci.text('concurrency', 'group')).toStartWith(
    'ci-${{ github.event.pull_request.number || github.sha }}',
  );
  expect(ci.text('concurrency', 'cancel-in-progress')).toBe("${{ github.event_name == 'pull_request' }}");
});

test('a run starts at most the planned browser shards at once, and the date look-ahead at most four legs', () => {
  expect(readWorkflow('ci.yml').at('jobs', 'browser', 'strategy', 'max-parallel')).toBe(MAX_SHARDS);
  const lookahead = readWorkflow('date-lookahead.yml');
  expect(lookahead.at('jobs', 'leg', 'strategy', 'max-parallel')).toBe(4);
  // One look-ahead at a time, and a new one never cancels a run in progress.
  expect(lookahead.at('concurrency')).toEqual({ group: 'date-lookahead', 'cancel-in-progress': false });
});

test('a scheduled nightly skips a head that already has a green full run, and starts when the decision fails', () => {
  const nightly = readWorkflow('nightly.yml');
  expect(nightly.at('jobs', 'decide', 'if')).toBe("github.event_name == 'schedule'");
  expect(nightly.step('decide', 'Decide whether the head has a full run').run).toBe(
    'bash .github/scripts/main-full-run.sh decide',
  );
  expect(nightly.at('jobs', 'full', 'needs')).toBe('decide');
  expect(nightly.text('jobs', 'full', 'if')).toBe(
    "${{ !cancelled() && !inputs.alert_proof && needs.decide.outputs.head_has_full_run != 'true' }}",
  );
  // A skipped full run proved nothing, so the alert neither opens nor closes the issue.
  expect(nightly.text('jobs', 'alert', 'if')).toContain("needs.decide.outputs.head_has_full_run != 'true'");
});

test('every job that runs on a runner has its own timeout, so a hung job never runs for 6 hours unnoticed', () => {
  const folder = resolve(import.meta.dir, '../..', workflowsFolder());
  const files = readdirSync(folder).filter((file) => file.endsWith('.yml'));
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
