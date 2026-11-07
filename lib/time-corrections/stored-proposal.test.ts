import { expect, test } from 'bun:test';

import { namesAnotherPerson } from './types';

// A stored proposal is resubmitted, and offered for resubmission, only when
// every fact belongs to the request's subject; a reassignment is the one kind
// that names another person.
const fact = (userId: string) => ({
  factId: `fact-${userId}`,
  employeeRecordId: `record-${userId}`,
  userId,
  entryType: 'clock_in',
  timestamp: '2026-10-20T05:00:00.000Z',
  jobId: null,
  activityKind: null,
  isManual: true,
});
const proposal = (...userIds: string[]) => ({ schemaVersion: 1, facts: userIds.map(fact) });

test('a proposal of the subject alone is resubmittable', () => {
  expect(namesAnotherPerson({ kind: 'edit', subject_user_id: 'subject' }, proposal('subject'))).toBe(false);
  expect(namesAnotherPerson({ kind: 'delete', subject_user_id: 'subject' }, proposal())).toBe(false);
});

test('a stored proposal that names someone else is not, unless it reassigns', () => {
  expect(
    namesAnotherPerson({ kind: 'edit', subject_user_id: 'subject' }, proposal('subject', 'coworker')),
  ).toBe(true);
  expect(namesAnotherPerson({ kind: 'reassign', subject_user_id: 'subject' }, proposal('coworker'))).toBe(
    false,
  );
});

test('an unreadable stored proposal is not resubmittable', () => {
  expect(namesAnotherPerson({ kind: 'edit', subject_user_id: 'subject' }, { facts: 'broken' })).toBe(true);
});
