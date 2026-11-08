// The project time card reads each person's working days once for the whole
// project, not once per job: jobs that share days share one day read, and a
// job whose days lie apart gets its own. Each job still receives exactly the
// sessions its own clock-ins open.
import assert from 'node:assert/strict';
import { mock } from 'bun:test';
import { ORGANIZATION_A, installActionWorld, signInAs } from './action-boundary-world';

const projectId = '8e000000-0000-4000-8000-000000000001';
const firstJobId = '8e000000-0000-4000-8000-000000000011';
const secondJobId = '8e000000-0000-4000-8000-000000000012';
const thirdJobId = '8e000000-0000-4000-8000-000000000013';
const fourthJobId = '8e000000-0000-4000-8000-000000000014';
const jobIds = [firstJobId, secondJobId, thirdJobId, fourthJobId];
const otherJobId = '8e000000-0000-4000-8000-000000000019';
const workerId = '8e000000-0000-4000-8000-000000000031';

type Entry = { id: string; entry_type: 'clock_in' | 'clock_out'; timestamp: string; job_id: string };
let entryNumber = 100;
/** One work session of the worker, with Berlin wall-clock times in winter (UTC+1). */
function session(jobId: string, day: string, from: string, to: string): Entry[] {
  const id = () => `8e000000-0000-4000-8000-000000000${(entryNumber += 1)}`;
  return [
    { id: id(), entry_type: 'clock_in', timestamp: `${day}T${from}:00.000Z`, job_id: jobId },
    { id: id(), entry_type: 'clock_out', timestamp: `${day}T${to}:00.000Z`, job_id: jobId },
  ];
}
// Three jobs share the first day, the third also runs two days later, another
// project's job sits between them, and the fourth job lies weeks apart.
const first = session(firstJobId, '2026-03-02', '06:00', '08:00');
const second = session(secondJobId, '2026-03-02', '08:30', '10:00');
const other = session(otherJobId, '2026-03-02', '10:15', '10:45');
const third = session(thirdJobId, '2026-03-02', '11:00', '13:00');
const thirdLater = session(thirdJobId, '2026-03-04', '06:00', '08:00');
const fourth = session(fourthJobId, '2026-05-04', '05:00', '07:00');
const rows = [...first, ...second, ...other, ...third, ...thirdLater, ...fourth].map((entry) => ({
  ...entry,
  organization_id: ORGANIZATION_A,
  user_id: workerId,
  status: 'approved',
  is_manual: false,
  reviewed_by: null,
  reviewed_at: null,
  created_at: entry.timestamp,
  updated_at: entry.timestamp,
}));

const world = installActionWorld({
  projects: [{ id: projectId, organization_id: ORGANIZATION_A }],
  jobs: jobIds.map((id) => ({ id, organization_id: ORGANIZATION_A, project_id: projectId })),
  time_entries: rows,
});
let timeEntryReads = 0;
const tables = world.tables;
world.tables = new Proxy(tables, {
  get: (target, table) => {
    if (table === 'time_entries') timeEntryReads += 1;
    return Reflect.get(target, table);
  },
});
mock.module('@/lib/time-corrections/approved-projection', () => ({
  loadApprovedCorrectionProjection: async () => [],
}));
const { getTimeEntriesForProjectJobs } = await import('@/lib/time-tracking/entry-read-actions');

signInAs(world, 'admin');
const result = await getTimeEntriesForProjectJobs(projectId);
assert.ok(result.success, JSON.stringify(result));
const entryIdsByJob = result.jobs.map(({ jobId, entries }) => ({
  jobId,
  ids: entries.map((entry) => entry.id),
}));
const idsOf = (entries: Entry[]) => entries.map((entry) => entry.id);
assert.deepEqual(entryIdsByJob, [
  { jobId: firstJobId, ids: idsOf(first) },
  { jobId: secondJobId, ids: idsOf(second) },
  { jobId: thirdJobId, ids: idsOf([...third, ...thirdLater]) },
  { jobId: fourthJobId, ids: idsOf(fourth) },
]);
assert.equal(
  timeEntryReads,
  jobIds.length + 2,
  'Each job reads its own clock-ins once; the days are read once for the whole project, one read per stretch of days that lie apart.',
);
