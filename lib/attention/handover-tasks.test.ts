import { expect, test } from 'bun:test';
import { toWorkHandoverTasks, type HandoverJobRow, type HandoverProjectRow } from './handover-tasks';

function job(id: string, updatedAt: string, completedOn: string | null = null): HandoverJobRow {
  return {
    id,
    job_number: `A-${id}`,
    title: `Auftrag ${id}`,
    execution_version: 1,
    project_id: null,
    updated_at: updatedAt,
    actual_completion_date: completedOn,
  };
}

function project(
  id: string,
  updatedAt: string,
  lastChildCompletionDate: string | null = null,
): HandoverProjectRow {
  return {
    id,
    project_number: `P-${id}`,
    name: `Projekt ${id}`,
    execution_version: 1,
    execution_state_override: null,
    status_override: null,
    updated_at: updatedAt,
    lastChildCompletionDate,
  };
}

test('handover tasks list the oldest finished work first across jobs and projects', () => {
  const tasks = toWorkHandoverTasks(
    [job('j-new', '2026-11-07T10:00:00Z'), job('j-old', '2026-10-01T08:00:00Z')],
    [project('p-mid', '2026-10-15T12:00:00Z'), project('p-oldest', '2026-09-20T07:00:00Z')],
    [],
    [],
    [],
  );
  expect(tasks.map((task) => task.sourceId)).toEqual(['p-oldest', 'j-old', 'p-mid', 'j-new']);
});

test('a released handover package leaves the list', () => {
  const tasks = toWorkHandoverTasks(
    [job('j-released', '2026-09-01T08:00:00Z'), job('j-open', '2026-10-01T08:00:00Z')],
    [project('p-released', '2026-09-02T08:00:00Z')],
    [{ job_id: 'j-released', state: 'released', version: 3 }],
    [{ project_id: 'p-released', state: 'released', version: 2 }],
    [],
  );
  expect(tasks.map((task) => task.sourceId)).toEqual(['j-open']);
});

test('a handover waits since the Berlin day its execution completed', () => {
  const tasks = toWorkHandoverTasks(
    [
      job('j-recorded', '2026-11-18T09:00:00Z', '2026-11-16'),
      // No recorded date: the Berlin day of the last change, here across a month end.
      job('j-unrecorded', '2026-10-31T23:30:00Z'),
    ],
    [
      // Completed through its last child job, after the project's own last change.
      project('p-derived', '2026-02-01T08:00:00Z', '2028-02-29'),
      // Completed by hand after its children.
      project('p-explicit', '2026-11-17T22:30:00Z', '2026-11-10'),
      project('p-childless', '2026-11-12T08:00:00Z'),
    ],
    [],
    [],
    [],
  );
  const completedOn = Object.fromEntries(
    tasks.map((task) => [
      task.sourceId,
      task.sourceType === 'work_handover_review' ? task.completedOn : null,
    ]),
  );
  expect(completedOn).toEqual({
    'j-recorded': '2026-11-16',
    'j-unrecorded': '2026-11-01',
    'p-derived': '2028-02-29',
    'p-explicit': '2026-11-17',
    'p-childless': '2026-11-12',
  });
});
