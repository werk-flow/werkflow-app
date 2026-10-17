import { expect, test } from 'bun:test';

import { EMPLOYMENT_TYPE_LABELS, EMPLOYMENT_TYPES, employmentTypeLabel } from './types';

test('a known employment type reads as its label', () => {
  for (const employmentType of EMPLOYMENT_TYPES)
    expect(employmentTypeLabel(employmentType)).toBe(EMPLOYMENT_TYPE_LABELS[employmentType]);
});

test('an unknown employment type reads as neutral German, never as its code', () => {
  expect(employmentTypeLabel('werkstudent')).toBe('Beschäftigungsart unbekannt');
  expect(employmentTypeLabel('toString')).toBe('Beschäftigungsart unbekannt');
});
