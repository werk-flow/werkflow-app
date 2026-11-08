// A project read whose merged days would exceed the row bound still completes
// wherever each job's own read completes: two overlapping jobs each stay under
// the bound alone, their merged days do not, and the project read returns the
// same entries as the single-job read of each job.
import assert from 'node:assert/strict';
import { mock } from 'bun:test';
import { LIST_ROW_CAP } from '@/lib/supabase/query-batches';
import { ORGANIZATION_A, installActionWorld, signInAs } from './action-boundary-world';

const projectId = '8f000000-0000-4000-8000-000000000001';
const firstJobId = '8f000000-0000-4000-8000-000000000011';
const secondJobId = '8f000000-0000-4000-8000-000000000012';
const otherJobId = '8f000000-0000-4000-8000-000000000019';
const workerId = '8f000000-0000-4000-8000-000000000031';

type Entry = { id: string; entry_type: 'clock_in' | 'clock_out'; timestamp: string; job_id: string };
let entryNumber = 0;
const nextId = () => `8f000000-0000-4000-8000-${String((entryNumber += 1)).padStart(12, '0')}`;
const at = (day: string, minutes: number) =>
  `${day}T${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}:00.000Z`;
function session(jobId: string, day: string, from: number, to: number): Entry[] {
  return [
    { id: nextId(), entry_type: 'clock_in', timestamp: at(day, from), job_id: jobId },
    { id: nextId(), entry_type: 'clock_out', timestamp: at(day, to), job_id: jobId },
  ];
}

// 39 days; every time lies between 06:00 and 15:00 UTC, inside one Berlin day.
// The first job runs on day 1 and day 20, the second on day 20 and day 39, so
// their day spans overlap on day 20. Every day the worker also logs short
// sessions on another project.
const days = Array.from({ length: 39 }, (_, index) =>
  new Date(Date.UTC(2026, 2, 2 + index)).toISOString().slice(0, 10),
);
const fillerEntriesPerDay = 300;
const projectSessions = new Map<string, Entry[]>([
  [`${days[0]}:${firstJobId}`, session(firstJobId, days[0] ?? '', 360, 420)],
  [`${days[19]}:${firstJobId}`, session(firstJobId, days[19] ?? '', 360, 420)],
  [`${days[19]}:${secondJobId}`, session(secondJobId, days[19] ?? '', 450, 510)],
  [`${days[38]}:${secondJobId}`, session(secondJobId, days[38] ?? '', 360, 420)],
]);
const entries: Entry[] = days.flatMap((day) => [
  ...(projectSessions.get(`${day}:${firstJobId}`) ?? []),
  ...(projectSessions.get(`${day}:${secondJobId}`) ?? []),
  ...Array.from({ length: fillerEntriesPerDay / 2 }, (_, index) =>
    session(otherJobId, day, 600 + index * 2, 601 + index * 2),
  ).flat(),
]);
// Each job's own span holds 20 days of rows; the merged span holds all 39.
assert.ok(20 * fillerEntriesPerDay < LIST_ROW_CAP && entries.length > LIST_ROW_CAP);

const world = installActionWorld({
  projects: [{ id: projectId, organization_id: ORGANIZATION_A }],
  jobs: [firstJobId, secondJobId].map((id) => ({
    id,
    organization_id: ORGANIZATION_A,
    project_id: projectId,
  })),
  time_entries: entries.map((entry) => ({
    ...entry,
    organization_id: ORGANIZATION_A,
    user_id: workerId,
    status: 'approved',
    is_manual: false,
    reviewed_by: null,
    reviewed_at: null,
    created_at: entry.timestamp,
    updated_at: entry.timestamp,
  })),
});
mock.module('@/lib/time-corrections/approved-projection', () => ({
  loadApprovedCorrectionProjection: async () => [],
}));
const { getTimeEntriesForJob, getTimeEntriesForProjectJobs } = await import(
  '@/lib/time-tracking/entry-read-actions'
);

signInAs(world, 'admin');
const projectRead = await getTimeEntriesForProjectJobs(projectId);
assert.ok(projectRead.success, JSON.stringify(projectRead));
const projectEntriesByJob = new Map(projectRead.jobs.map((job) => [job.jobId, job.entries]));
for (const jobId of [firstJobId, secondJobId]) {
  const jobRead = await getTimeEntriesForJob(jobId);
  assert.ok(jobRead.success, JSON.stringify(jobRead));
  assert.deepEqual(
    projectEntriesByJob.get(jobId),
    jobRead.entries,
    'The project read and the job read agree on each job.',
  );
}
const idsOf = (sessions: Array<Entry[] | undefined>) =>
  sessions.flatMap((pair) => pair ?? []).map(({ id }) => id);
assert.deepEqual(
  projectRead.jobs.map((job) => ({ jobId: job.jobId, ids: job.entries.map(({ id }) => id) })),
  [
    {
      jobId: firstJobId,
      ids: idsOf([
        projectSessions.get(`${days[0]}:${firstJobId}`),
        projectSessions.get(`${days[19]}:${firstJobId}`),
      ]),
    },
    {
      jobId: secondJobId,
      ids: idsOf([
        projectSessions.get(`${days[19]}:${secondJobId}`),
        projectSessions.get(`${days[38]}:${secondJobId}`),
      ]),
    },
  ],
);
