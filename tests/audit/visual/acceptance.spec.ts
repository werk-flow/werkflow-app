import { test } from '../support/fixtures';
import { ACCEPTANCE_SETS } from '../support/acceptance-sets';
import {
  captureAcceptance,
  captureStandalone,
  settleAcceptanceEntries,
} from '../support/acceptance-captures';

// Rendered acceptance captures (docs/technical/standards-audit.md, "Rendered
// design acceptance"): one test per capture of an open set, run on request
// with `bun run test:audit:focused --grep "@ACCEPT <set>"`. The fixture refuses
// to capture a screen that is not ready, and an image counts as evidence only
// when its test passed. Tags: @AUDIT-VISUAL-ACCEPT, @ACCEPT <set>.

test.afterEach(async ({}, testInfo) => {
  settleAcceptanceEntries(testInfo);
});

for (const set of ACCEPTANCE_SETS) {
  test.describe(`@AUDIT-VISUAL-ACCEPT @ACCEPT ${set.id}`, () => {
    for (const capture of set.captures.filter((spec) => spec.role === 'admin'))
      test(`@ACCEPT ${set.id} ${capture.id}`, async ({ adminPage, world, businessDate }, testInfo) => {
        await captureAcceptance({ page: adminPage, world, businessDate, testInfo }, set.id, capture);
      });
    for (const capture of set.captures.filter((spec) => spec.role === 'employee'))
      test(`@ACCEPT ${set.id} ${capture.id}`, async ({ employeePage, world, businessDate }, testInfo) => {
        await captureAcceptance({ page: employeePage, world, businessDate, testInfo }, set.id, capture);
      });
    for (const capture of set.standalone)
      test(`@ACCEPT ${set.id} ${capture.id}`, async ({ browser, baseURL, world }, testInfo) => {
        await captureStandalone({ browser, baseURL, world, testInfo }, set.id, capture);
      });
  });
}
