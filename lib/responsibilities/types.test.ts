import { expect, test } from 'bun:test';

import { ORGANIZATION_RESPONSIBILITIES, strandedResponsibilityOf } from './types';

// A removal refused by the membership trigger names the stranded
// responsibility; every responsibility keeps its own name instead of falling
// back to the time approval.
test('the trigger refusal names each responsibility as itself', () => {
  for (const responsibility of ORGANIZATION_RESPONSIBILITIES) {
    expect(strandedResponsibilityOf(`last_responsibility_holder:${responsibility}`)).toBe(responsibility);
  }
});

test('another message or an unknown responsibility names none', () => {
  expect(strandedResponsibilityOf('member_removal_exit_before_entry')).toBeNull();
  expect(strandedResponsibilityOf('last_responsibility_holder:payroll')).toBeNull();
});
