import { describe, expect, test } from 'bun:test';

import { measuredTestSource } from './measured-test-source';

const FILE = 'tests/audit/performance/example.spec.ts';

function spec(parts: { measured?: string; other?: string; entry?: string; unused?: string; hook?: string }) {
  return `
import { expect, test } from '../support/fixtures';
import { expectUsableWithin } from '../../golden/support/scenario-measurement';

const ENTRY = '${parts.entry ?? '/kunden'}';
const UNUSED = '${parts.unused ?? 'a'}';
function target(page) { return page.getByTestId(ENTRY); }
${parts.hook ?? ''}
test.describe('Performance @AUDIT-PERFORMANCE', () => {
  test('PERF-1 measured', async ({ page }) => {
    await expectUsableWithin('customers.list.open', {
      page,
      trigger: () => page.goto(ENTRY),
      usable: target(page),
    });
    ${parts.measured ?? ''}
  });

  test('PERF-2 unmeasured', async ({ page }) => {
    await page.goto('/kunden');
    ${parts.other ?? ''}
  });
});
`;
}

const source = (parts: Parameters<typeof spec>[0] = {}) =>
  measuredTestSource(FILE, spec(parts), 'customers.list.open');

describe('measuredTestSource', () => {
  test('an edit to another test of the file keeps the measured source', () => {
    expect(source({ other: "await page.getByRole('button').click();" })).toBe(source());
  });

  test('an edit inside the measured test changes the measured source', () => {
    expect(source({ measured: "await page.getByRole('button').click();" })).not.toBe(source());
  });

  test('a module-level declaration the measured test reaches is part of it, even through a helper', () => {
    expect(source({ entry: '/auftraege' })).not.toBe(source());
  });

  test('a module-level declaration no measured test reaches is not part of it', () => {
    expect(source({ unused: 'b' })).toBe(source());
  });

  test('a hook of the file is part of every measured test', () => {
    expect(source({ hook: "test.beforeEach(async ({ page }) => { await page.goto('/'); });" })).not.toBe(
      source(),
    );
  });

  test('comments do not change it', () => {
    const commented = spec({})
      .replace("test('PERF-1 measured'", "// The measured navigation.\n  test('PERF-1 measured'")
      .replace('page,\n', 'page, /* the page */\n');
    expect(measuredTestSource(FILE, commented, 'customers.list.open')).toBe(source());
  });

  test('a scenario that no test of its file records fails loudly', () => {
    expect(() => measuredTestSource(FILE, spec({}), 'jobs.list.open')).toThrow(
      'has no test that records the measured scenario jobs.list.open',
    );
  });
});
