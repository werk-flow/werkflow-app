import { test } from '../support/fixtures';
import { settleAcceptanceEntries } from '../support/acceptance-captures';
import { roundCaptures } from '../support/acceptance-rounds';
import { captureStandalone } from '../support/acceptance-standalone';

// Rendered acceptance captures of the inventory rounds (tests/audit/support/acceptance-rounds.ts):
// the screens outside the app shell, each with the session its inventory entry
// names. Tags: @AUDIT-VISUAL-ACCEPT, @ACCEPT <set>.

test.afterEach(async ({}, testInfo) => {
  settleAcceptanceEntries(testInfo);
});

for (const set of roundCaptures('standalone')) {
  test.describe(`@AUDIT-VISUAL-ACCEPT @ACCEPT ${set.id}`, () => {
    for (const capture of set.standalone)
      test(`@ACCEPT ${set.id} ${capture.id}`, async ({ browser, baseURL, world }, testInfo) => {
        await captureStandalone({ browser, baseURL, world, testInfo }, set.id, capture);
      });
  });
}
