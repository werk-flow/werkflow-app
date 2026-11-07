// The job reads an employee reaches beyond their own assignments, over the
// in-memory database: the time-correction picker offers open jobs of the
// whole organization by number and title only, never by their description,
// and resolves a selected id only for an open job or a job of the caller's
// own time records; the active-work read names only the caller's assigned
// jobs and their projects. Admin and Büro keep the full read, and nobody
// reaches another organization's job.
import assert from 'node:assert/strict';
import { setSystemTime } from 'bun:test';
import {
  CALLER_ID,
  ORGANIZATION_A,
  ORGANIZATION_B,
  installActionWorld,
  signInAs,
} from './action-boundary-world';

const coworkerId = '31000000-0000-4000-8000-000000000001';
const ids = {
  assigned: '32000000-0000-4000-8000-000000000001',
  coworkers: '32000000-0000-4000-8000-000000000002',
  untitled: '32000000-0000-4000-8000-000000000003',
  finished: '32000000-0000-4000-8000-000000000004',
  finishedOwnEntry: '32000000-0000-4000-8000-000000000005',
  finishedOwnSegment: '32000000-0000-4000-8000-000000000006',
  foreign: '32000000-0000-4000-8000-000000000007',
  assignedProject: '33000000-0000-4000-8000-000000000001',
  coworkerProject: '33000000-0000-4000-8000-000000000002',
} as const;
const hiddenDescription = 'Schlüssel liegt unter der Fußmatte';
const officeNote = 'Notiz nur fürs Büro';

function job(
  id: string,
  fields: { number: string; title: string; description?: string; status?: string; projectId?: string },
  assignees: readonly string[],
  organizationId: string = ORGANIZATION_A,
) {
  return {
    id,
    organization_id: organizationId,
    job_number: fields.number,
    title: fields.title,
    description: fields.description ?? null,
    client_id: null,
    project_id: fields.projectId ?? null,
    status: fields.status ?? 'nicht_bearbeitet',
    job_assignments: assignees.map((userId) => ({ user_id: userId })),
  };
}

const jobs = [
  job(ids.assigned, { number: 'AUF-2026-1', title: 'Heizung warten', projectId: ids.assignedProject }, [
    CALLER_ID,
  ]),
  job(
    ids.coworkers,
    {
      number: 'AUF-2026-2',
      title: 'Bad sanieren',
      description: hiddenDescription,
      projectId: ids.coworkerProject,
    },
    [coworkerId],
  ),
  job(ids.untitled, { number: 'AUF-2026-3', title: '  ', description: officeNote }, [coworkerId]),
  job(ids.finished, { number: 'AUF-2026-4', title: 'Altauftrag', status: 'fertig' }, [coworkerId]),
  job(ids.finishedOwnEntry, { number: 'AUF-2026-5', title: 'Eigener Altauftrag', status: 'fertig' }, []),
  job(ids.finishedOwnSegment, { number: 'AUF-2026-6', title: 'Eigene Wartung', status: 'fertig' }, []),
  job(ids.foreign, { number: 'AUF-2026-7', title: 'Fremder Auftrag' }, [CALLER_ID], ORGANIZATION_B),
];
// A fixed instant, so the coworker's clock-in stays on today's date.
const now = '2026-11-04T09:00:00.000Z';
setSystemTime(new Date('2026-11-04T10:00:00.000Z'));
const earlier = '2026-01-05T08:00:00.000Z';

const world = installActionWorld({
  jobs,
  job_assignments: jobs.flatMap((row) =>
    row.job_assignments.map((assignment) => ({
      job_id: row.id,
      user_id: assignment.user_id,
      organization_id: row.organization_id,
    })),
  ),
  time_entries: [
    // The caller's own earlier time on a job finished since.
    {
      id: '34000000-0000-4000-8000-000000000001',
      organization_id: ORGANIZATION_A,
      user_id: CALLER_ID,
      entry_type: 'clock_in',
      job_id: ids.finishedOwnEntry,
      timestamp: earlier,
      status: 'approved',
    },
    // A coworker's earlier time on another finished job.
    {
      id: '34000000-0000-4000-8000-000000000002',
      organization_id: ORGANIZATION_A,
      user_id: coworkerId,
      entry_type: 'clock_in',
      job_id: ids.finished,
      timestamp: earlier,
      status: 'approved',
    },
    // The coworker works on their own job right now.
    {
      id: '34000000-0000-4000-8000-000000000003',
      organization_id: ORGANIZATION_A,
      user_id: coworkerId,
      entry_type: 'clock_in',
      job_id: ids.coworkers,
      timestamp: now,
      status: 'approved',
    },
  ],
  time_segments: [
    // The caller's own ended segment on a job finished since.
    {
      id: '35000000-0000-4000-8000-000000000001',
      organization_id: ORGANIZATION_A,
      job_id: ids.finishedOwnSegment,
      kind: 'work',
      ended_at: earlier,
      time_sessions: [{ user_id: CALLER_ID, status: 'closed', ended_at: earlier }],
    },
    // Someone works on the caller's assigned job right now.
    {
      id: '35000000-0000-4000-8000-000000000002',
      organization_id: ORGANIZATION_A,
      job_id: ids.assigned,
      kind: 'work',
      ended_at: null,
      time_sessions: [{ user_id: coworkerId, status: 'open', ended_at: null }],
    },
    // A coworker's ended segment on a finished job: it never resolves that job for the caller.
    {
      id: '35000000-0000-4000-8000-000000000003',
      organization_id: ORGANIZATION_A,
      job_id: ids.finished,
      kind: 'work',
      ended_at: earlier,
      time_sessions: [{ user_id: coworkerId, status: 'closed', ended_at: earlier }],
    },
  ],
});
const { readEntityOptions } = await import('@/lib/jobs/option-server');
const { getActiveJobIdsForOrg } = await import('@/lib/time-tracking/clock-state-actions');

async function pickJobs(request: {
  purpose: 'time-correction' | 'manual-entry';
  query?: string;
  selectedIds?: string[];
}) {
  const result = await readEntityOptions({ organizationId: ORGANIZATION_A, kind: 'jobs', ...request });
  assert.equal(result.success, true, JSON.stringify(result));
  return result.success ? result : { options: [], selected: [] };
}
const values = (options: ReadonlyArray<{ value: string }>) => options.map((option) => option.value).sort();
const allSelectable = Object.values(ids).filter((id) => !id.startsWith('33'));

// ---- Employee --------------------------------------------------------------
signInAs(world, 'employee');

// A search never matches a description the employee may not read.
for (const purpose of ['time-correction', 'manual-entry'] as const) {
  assert.deepEqual(
    (await pickJobs({ purpose, query: 'Fußmatte' })).options,
    [],
    `${purpose} searched a description`,
  );
  assert.deepEqual(
    (await pickJobs({ purpose, query: 'Büro' })).options,
    [],
    `${purpose} searched a description`,
  );
}
// Number and title still find every open job of the organization for a correction.
assert.deepEqual(values((await pickJobs({ purpose: 'time-correction', query: 'Bad' })).options), [
  ids.coworkers,
]);
assert.deepEqual(values((await pickJobs({ purpose: 'time-correction', query: 'auf-2026-1' })).options), [
  ids.assigned,
]);

// A job without a title is labeled by its number, never by its description.
const correctionPage = await pickJobs({ purpose: 'time-correction' });
assert.deepEqual(values(correctionPage.options), [ids.assigned, ids.coworkers, ids.untitled].sort());
assert.equal(correctionPage.options.find((option) => option.value === ids.untitled)?.label, 'AUF-2026-3');
for (const option of correctionPage.options)
  assert.ok(![hiddenDescription, officeNote].some((text) => option.label.includes(text)), option.label);

// A selected id resolves only for an open job or a job of the caller's own time.
assert.deepEqual(
  values((await pickJobs({ purpose: 'time-correction', selectedIds: allSelectable })).selected),
  [ids.assigned, ids.coworkers, ids.untitled, ids.finishedOwnEntry, ids.finishedOwnSegment].sort(),
);

// Active work names only the caller's assigned jobs and their projects.
assert.deepEqual(await getActiveJobIdsForOrg(ORGANIZATION_A), {
  success: true,
  activeJobIds: [ids.assigned],
  activeProjectIds: [ids.assignedProject],
});
assert.deepEqual(await getActiveJobIdsForOrg(ORGANIZATION_B), { success: false, error: 'not_a_member' });

// ---- Admin and Büro keep the full read ------------------------------------
for (const role of ['admin', 'buero'] as const) {
  signInAs(world, role);
  assert.deepEqual(values((await pickJobs({ purpose: 'time-correction', query: 'Fußmatte' })).options), [
    ids.coworkers,
  ]);
  const managerPage = await pickJobs({ purpose: 'time-correction' });
  assert.equal(
    managerPage.options.find((option) => option.value === ids.untitled)?.label,
    `AUF-2026-3 · ${officeNote}`,
  );
  assert.deepEqual(
    values((await pickJobs({ purpose: 'time-correction', selectedIds: allSelectable })).selected),
    allSelectable.filter((id) => id !== ids.foreign).sort(),
    `${role} resolves every selected job of the organization, and none of another`,
  );
  const active = await getActiveJobIdsForOrg(ORGANIZATION_A);
  assert.equal(active.success, true);
  if (active.success) {
    assert.deepEqual(active.activeJobIds.sort(), [ids.assigned, ids.coworkers].sort());
    assert.deepEqual(active.activeProjectIds.sort(), [ids.assignedProject, ids.coworkerProject].sort());
  }
  assert.deepEqual(await getActiveJobIdsForOrg(ORGANIZATION_B), { success: false, error: 'not_a_member' });
}
