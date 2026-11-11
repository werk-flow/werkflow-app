import { test } from '../support/fixtures';
import { captureAcceptance, settleAcceptanceEntries } from '../support/acceptance-captures';
import { roundCaptures } from '../support/acceptance-rounds';
import { SETTINGS_OPENERS } from '../support/dialog-openers/settings';

// Rendered acceptance captures of the inventory rounds (tests/audit/support/acceptance-rounds.ts):
// the settings and organization dialogs. The spec imports only this area's
// openers, so a changed helper of another area does not select it.
// Tags: @AUDIT-VISUAL-ACCEPT, @ACCEPT <set>.

test.afterEach(async ({}, testInfo) => {
  settleAcceptanceEntries(testInfo);
});

for (const set of roundCaptures('settings')) {
  test.describe(`@AUDIT-VISUAL-ACCEPT @ACCEPT ${set.id}`, () => {
    for (const capture of set.captures)
      test(`@ACCEPT ${set.id} ${capture.id}`, async ({ browser, baseURL, world, businessDate }, testInfo) => {
        await captureAcceptance({ browser, baseURL, world, businessDate, testInfo }, set.id, capture, {
          openers: SETTINGS_OPENERS,
        });
      });
  });
}
