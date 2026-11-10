import { describe, expect, test } from 'bun:test';

import { pickerGroupHeading, pickerJobDetails, withRunningJob } from './picker-labels';
import type { PickerGroup } from './picker-types';

function headings(groups: PickerGroup[]): (string | null)[] {
  const jobs = groups.map((group) => ({ group }));
  return jobs.map((_, index) => pickerGroupHeading(jobs, index));
}

describe('clock picker group headings', () => {
  test('each group is headed once, where it starts', () => {
    expect(headings(['in_progress', 'today', 'upcoming', 'upcoming', 'own', 'other'])).toEqual([
      'In Ausführung',
      'Heute geplant',
      'Demnächst geplant',
      null,
      'Deine weiteren Aufträge',
      'Weitere Aufträge',
    ]);
  });

  test('a list of one group carries no heading', () => {
    expect(headings(['own', 'own', 'own'])).toEqual([null, null, null]);
    expect(headings([])).toEqual([]);
  });
});

describe('clock picker job details', () => {
  const job = { jobNumber: 'AUF-2026-89', clientName: 'Ingrid Becker', projectName: null };

  test('a next visit leads with its date', () => {
    expect(pickerJobDetails({ ...job, group: 'upcoming', nextVisitDate: '2026-11-18' })).toBe(
      '18.11.2026 · AUF-2026-89 · Ingrid Becker',
    );
  });

  test('another group names number, customer and project only', () => {
    expect(
      pickerJobDetails({ ...job, projectName: 'Neubau', group: 'today', nextVisitDate: '2026-11-18' }),
    ).toBe('AUF-2026-89 · Ingrid Becker · Neubau');
  });
});

describe('the running job of a switch', () => {
  const page: { id: string; group: PickerGroup }[] = [
    { id: 'a', group: 'today' },
    { id: 'b', group: 'own' },
    { id: 'c', group: 'other' },
  ];

  test('joins the end of its own group, so no heading repeats', () => {
    const jobs = withRunningJob(page, { id: 'r', group: 'today' });
    expect(jobs.map((job) => job.id)).toEqual(['a', 'r', 'b', 'c']);
    expect(jobs.map((_, index) => pickerGroupHeading(jobs, index)).filter(Boolean)).toEqual([
      'Heute geplant',
      'Deine weiteren Aufträge',
      'Weitere Aufträge',
    ]);
  });

  test('leads when its group comes first, and stays once when the page holds it', () => {
    expect(withRunningJob(page, { id: 'r', group: 'in_progress' }).map((job) => job.id)).toEqual([
      'r',
      'a',
      'b',
      'c',
    ]);
    expect(withRunningJob(page, { id: 'b', group: 'own' })).toBe(page);
  });
});
