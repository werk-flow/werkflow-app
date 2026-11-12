import { expect, test } from '@playwright/test';
import { assertWorkspaceTestLock } from '@/lib/testing/runner/workspace-test-lock';
import { CLOCK_ORGANIZATION_ID, CLOCK_USER_ID } from './clock-state-fixture';
import { CLOCKED_OUT_STATE } from './clock-unsent-support';

// The clock of the page a phone shows without signal (components/clock-offline.tsx): it keeps an
// action only under the wipe signal it started with, and a refused action says so, also when no
// clock is left to show.

/** The cross-tab wipe signal of lib/field-sync/device/today-wipe.ts. */
const TODAY_WIPE_KEY = 'werkflow:today-wiped';

test('a capture refused after another tab’s sign-out says so, also once no clock is left to show', async ({
  page,
}) => {
  assertWorkspaceTestLock();
  const bundle = process.env.WERKFLOW_UI_CONTRACT_BUNDLE;
  if (!bundle) throw new Error('Run through bun tests/ui-contracts/run.ts.');
  await page.route('http://localhost/ui-contracts**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<html lang="de"><body><div id="root"></div></body></html>',
    }),
  );
  await page.goto('http://localhost/ui-contracts');
  // A start the app kept before its signal went, under the current wipe signal.
  await page.evaluate(
    ({ userId, organizationId, base }) => {
      window.uiContractFixture = 'offline-clock';
      const operationId = '50000000-0000-4000-8000-0000000000d1';
      localStorage.setItem(
        `werkflow:unsent:clock:${String(Date.now()).padStart(15, '0')}:1:${operationId}`,
        JSON.stringify({
          userId,
          organizationId,
          operationId,
          action: 'start',
          selection: { kind: 'work', allocationKind: 'unallocated', jobId: null },
          expectedSessionId: null,
          expectedVersion: null,
          capturedAt: new Date().toISOString(),
          triedOnline: false,
          wipeGeneration: '',
          base,
          readAt: new Date().toISOString(),
        }),
      );
    },
    { userId: CLOCK_USER_ID, organizationId: CLOCK_ORGANIZATION_ID, base: CLOCKED_OUT_STATE },
  );
  await page.addScriptTag({ path: bundle });
  const clock = page.getByRole('main');
  await expect(clock.getByRole('group', { name: 'Nächste Aktion' })).toBeVisible();

  // Another tab signs out; this page has not heard of it yet.
  await page.evaluate((key) => localStorage.setItem(key, 'signed-out-elsewhere'), TODAY_WIPE_KEY);
  await clock.getByRole('button', { name: 'Erfassung beenden', exact: true }).click();

  await expect(clock).toContainText(
    'Du wurdest in einem anderen Tab abgemeldet. Diese Zeit wurde nicht gespeichert.',
  );
  await expect(clock.getByRole('group', { name: 'Nächste Aktion' })).toHaveCount(0);
});
