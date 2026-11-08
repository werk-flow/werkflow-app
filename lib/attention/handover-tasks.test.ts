import { expect, test } from 'bun:test';
import { toWorkHandoverTasks, type HandoverJobRow, type HandoverProjectRow } from './handover-tasks';

function job(id: string, updatedAt: string): HandoverJobRow {
  return {
    id,
    job_number: `A-${id}`,
    title: `Auftrag ${id}`,
    execution_version: 1,
    project_id: null,
    updated_at: updatedAt,
  };
}

function project(id: string, updatedAt: string): HandoverProjectRow {
  return {
    id,
    project_number: `P-${id}`,
    name: `Projekt ${id}`,
    execution_version: 1,
    execution_state_override: null,
    status_override: null,
    updated_at: updatedAt,
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
