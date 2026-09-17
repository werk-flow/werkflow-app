import { expect, test } from 'bun:test';
import { collectActiveJobIds } from './active-jobs';

test('a stopped or paused worker does not keep an older job active', () => {
  expect(collectActiveJobIds([
    { user_id: 'stopped', entry_type: 'clock_out', job_id: null },
    { user_id: 'paused', entry_type: 'break_start', job_id: 'paused-job' },
    { user_id: 'stopped', entry_type: 'clock_in', job_id: 'old-job' },
    { user_id: 'paused', entry_type: 'clock_in', job_id: 'paused-job' },
  ], [])).toEqual([]);
});

test('canonical and legacy activity converge into one identity per active job', () => {
  expect(collectActiveJobIds([
    { user_id: 'worker', entry_type: 'break_end', job_id: 'shared-job' },
    { user_id: 'unassigned', entry_type: 'clock_in', job_id: null },
  ], [{ job_id: 'shared-job' }, { job_id: 'canonical-job' }, { job_id: null }])).toEqual(['shared-job', 'canonical-job']);
});
