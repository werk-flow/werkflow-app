import { test } from '../support/fixtures';
import { captureAcceptance, settleAcceptanceEntries } from '../support/acceptance-captures';
import { ACCEPTANCE_RECORDS } from '../support/acceptance-records';
import { ACCEPTANCE_SETS } from '../support/acceptance-sets';
import { captureStandalone } from '../support/acceptance-standalone';
import { DIALOG_OPENERS } from '../support/dialog-openers';

// Rendered acceptance captures (docs/technical/standards-audit.md, "Rendered
// design acceptance"): one test per capture of an open set, run on request
// with `bun run test:audit:focused --grep "@ACCEPT <set>"`. The fixture refuses
// to capture a screen that is not ready, and an image counts as evidence only
// when its test passed. A set may open any dialog, so this spec imports every
// opener; the rounds over the whole inventory run in the acceptance-<group>
// specs beside it. Tags: @AUDIT-VISUAL-ACCEPT, @ACCEPT <set>.

test.afterEach(async ({}, testInfo) => {
  settleAcceptanceEntries(testInfo);
});

for (const set of ACCEPTANCE_SETS) {
  test.describe(`@AUDIT-VISUAL-ACCEPT @ACCEPT ${set.id}`, () => {
    for (const capture of set.captures)
      test(`@ACCEPT ${set.id} ${capture.id}`, async ({ browser, baseURL, world, businessDate }, testInfo) => {
        await captureAcceptance({ browser, baseURL, world, businessDate, testInfo }, set.id, capture, {
          openers: DIALOG_OPENERS,
          destination: capture.record && ACCEPTANCE_RECORDS[capture.record],
        });
      });
    for (const capture of set.standalone)
      test(`@ACCEPT ${set.id} ${capture.id}`, async ({ browser, baseURL, world }, testInfo) => {
        await captureStandalone({ browser, baseURL, world, testInfo }, set.id, capture);
      });
  });
}
