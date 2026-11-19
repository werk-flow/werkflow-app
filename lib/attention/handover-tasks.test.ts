import { expect, test } from 'bun:test';
import {
  latestHandCompletion,
  toWorkHandoverTasks,
  type HandoverJobRow,
  type HandoverProjectRow,
} from './handover-tasks';

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
  recordedCompletionDate: string | null = null,
): HandoverProjectRow {
  return {
    id,
    project_number: `P-${id}`,
    name: `Projekt ${id}`,
    execution_version: 1,
    execution_state_override: null,
    status_override: null,
    updated_at: updatedAt,
    recordedCompletionDate,
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
      // A recorded completion wins over a later edit of the project.
      project('p-edited', '2026-11-18T09:00:00Z', '2026-11-12'),
      project('p-leap-day', '2026-02-01T08:00:00Z', '2028-02-29'),
      // Nothing recorded: the Berlin day of the last change.
      project('p-unrecorded', '2026-11-17T23:30:00Z'),
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
    'p-edited': '2026-11-12',
    'p-leap-day': '2028-02-29',
    'p-unrecorded': '2026-11-18',
  });
});

test("a project's completion by hand is the Berlin day of its latest transition, never a withdrawn release", () => {
  expect(latestHandCompletion([])).toBeNull();
  expect(
    latestHandCompletion([
      { event_type: 'reopened', created_at: '2026-11-02T09:00:00Z' },
      // 23:30 UTC on the 11th is the 12th in Berlin.
      { event_type: 'reopened', created_at: '2026-11-11T23:30:00Z' },
      { event_type: 'handover_withdrawn', created_at: '2026-11-18T08:00:00Z' },
    ]),
  ).toBe('2026-11-12');
  expect(
    latestHandCompletion([{ event_type: 'handover_withdrawn', created_at: '2026-11-18T08:00:00Z' }]),
  ).toBeNull();
});
