import { expect, test } from 'bun:test';
import { jobDetailHref, projectDetailHref } from './routes';

test("job and project routes encode their numbers and nest a project's job", () => {
  expect(projectDetailHref({ id: 'project-id', projectNumber: 'P 7' })).toBe('/auftraege/projekt/P%207');
  expect(jobDetailHref({ id: 'job-id', jobNumber: 'A/12' })).toBe('/auftraege/A%2F12');
  expect(jobDetailHref({ id: 'job-id', jobNumber: 'A-12' }, { id: 'project-id', projectNumber: 'P-7' })).toBe(
    '/auftraege/projekt/P-7/A-12',
  );
  expect(jobDetailHref({ id: 'job-id', jobNumber: 'A-12' }, null)).toBe('/auftraege/A-12');
});

test('a draft without a number falls back to its id', () => {
  expect(jobDetailHref({ id: 'job-id', jobNumber: null }, { id: 'project-id', projectNumber: null })).toBe(
    '/auftraege/projekt/project-id/job-id',
  );
});
