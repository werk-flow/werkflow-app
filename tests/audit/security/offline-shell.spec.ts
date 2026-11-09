import { expect, test } from '../support/fixtures';
import { signOutViaUi } from '../../golden/support/steps/organization';
import { jobListReady } from '../support/lab-journeys';
import {
  offlineFallback,
  offlineRetryButton,
  expectNoServiceWorkerCaches,
  expectOnlyShellFilesCached,
  setNetwork,
  waitForOfflineShell,
} from '../support/offline-shell';

// The installable app shell (werk-flow/werkflow-planning#316): the service
// worker answers a navigation without network with the offline fallback, and
// no cache it owns ever holds an authenticated response or outlives a sign-out.

test('the app shell opens without signal and keeps nothing of the person @AUDIT-SECURITY-OFFLINE-SHELL', async ({
  employeePage: page,
  world,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });

  await test.step('the field worker opens the app and the shell fills', async () => {
    await page.goto('/auftraege');
    await expect(jobListReady(page)).toBeVisible();
    await waitForOfflineShell(page);
  });

  await test.step('authenticated pages the field worker opens never enter a cache', async () => {
    for (const path of ['/dashboard', '/zeiterfassung', '/auftraege']) {
      await page.goto(path);
      await expect(page).toHaveURL(new RegExp(`${path}$`));
    }
    await expectOnlyShellFilesCached(page, [world.users.employee.email]);
  });

  await test.step('a navigation without network shows the fallback, and the retry opens the page', async () => {
    await setNetwork(page, 'offline');
    await page.goto('/auftraege');
    await expect(offlineFallback(page)).toBeVisible();
    await expect(page).toHaveURL(/\/auftraege$/);
    await expect(offlineRetryButton(page)).toBeEnabled();
    await setNetwork(page, 'online');
    await offlineRetryButton(page).click();
    await expect(jobListReady(page)).toBeVisible();
  });

  await test.step('sign-out empties every cache the service worker owns', async () => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await signOutViaUi(page);
    await expectNoServiceWorkerCaches(page);
  });
});
