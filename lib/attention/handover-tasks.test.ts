import { expect, test } from 'bun:test';
import {
  latestHandCompletion,
  projectCompletedOn,
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

function project(id: string, updatedAt: string, completedOn: string | null = null): HandoverProjectRow {
  return {
    id,
    project_number: `P-${id}`,
    name: `Projekt ${id}`,
    execution_version: 1,
    execution_state_override: null,
    status_override: null,
    updated_at: updatedAt,
    completedOn,
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
      project('p-completed', '2026-11-18T09:00:00Z', '2026-11-12'),
      project('p-unknown', '2026-11-17T09:00:00Z'),
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
    'p-completed': '2026-11-12',
    'p-unknown': null,
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

test("a project's completion day: by hand, else its finished children's latest, unknown while a finished child has none", () => {
  const finished = (actualCompletionDate: string | null) =>
    ({ executionState: 'execution_complete', status: 'fertig', actualCompletionDate }) as const;
  const cancelled = { executionState: 'cancelled', status: 'fertig', actualCompletionDate: null } as const;
  const legacy = { executionState: null, status: 'fertig', actualCompletionDate: null } as const;
  const edited = { updated_at: '2026-11-18T09:00:00Z' };
  const cases: Array<
    [
      why: string,
      hand: string | undefined,
      children: Parameters<typeof projectCompletedOn>[2],
      day: string | null,
    ]
  > = [
    ['completed by hand, whatever its children say', '2026-11-12', [legacy], '2026-11-12'],
    [
      'the latest finished child, over a month end',
      undefined,
      [finished('2026-10-30'), finished('2026-11-02')],
      '2026-11-02',
    ],
    ['through a leap day', undefined, [finished('2028-02-29'), finished('2028-02-28')], '2028-02-29'],
    [
      'a cancelled child carries no day and counts for none',
      undefined,
      [finished('2026-11-10'), cancelled],
      '2026-11-10',
    ],
    [
      'a finished legacy child without a day makes it unknown',
      undefined,
      [finished('2026-11-10'), legacy],
      null,
    ],
    ['no child and no completion by hand: the last change', undefined, [], '2026-11-18'],
  ];
  for (const [why, hand, children, day] of cases) {
    expect(projectCompletedOn(edited, hand, children), why).toBe(day);
  }
});
