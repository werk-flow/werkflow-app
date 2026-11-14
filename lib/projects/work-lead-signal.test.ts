import { expect, test } from 'bun:test';
import { isLeadSignal, withLeadSignal } from './work-lead-signal';

test('only a lead view listens to the lead holding', () => {
  expect(withLeadSignal(['work_artifacts'], false)).toEqual(['work_artifacts']);
  expect(withLeadSignal(['work_artifacts'], true)).toEqual(['work_artifacts', 'work_leads']);
});

test('the touch of a lead holding is the signal, an Arbeitsnachweis event is not', () => {
  expect(isLeadSignal({ table: 'work_leads' })).toBe(true);
  expect(isLeadSignal({ table: 'work_artifacts' })).toBe(false);
});
