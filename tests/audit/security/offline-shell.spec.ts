import { expect, test } from '../support/fixtures';
import { goldenTestOrganizationName } from '../../golden/support/seed';
import {
  createAdditionalOrganization,
  organizationSwitcher,
  signOutViaUi,
} from '../../golden/support/steps/organization';
import { selectFromSearchable } from '../../golden/support/steps/shared';
import { jobListReady } from '../support/lab-journeys';
import {
  bypassHttpCache,
  coldStartWithoutSignal,
  expectNextBuildShellAfterUpdate,
  expectShellOfServedBuild,
  offlineFallback,
  offlineRetryButton,
  expectNoServiceWorkerCaches,
  expectOnlyShellFilesCached,
  expectOwnedCacheDeleted,
  plantOwnedCache,
  setNetwork,
  waitForOfflineShell,
  withDeployableOrigin,
  withProtectedOrigin,
} from '../support/offline-shell';

// The installable app shell (werk-flow/werkflow-planning#316): the service
// worker answers a navigation without network with the offline fallback, and
// no cache it owns ever holds an authenticated response or outlives a sign-out.

// Every other browser test blocks service workers (playwright.audit.config.ts); this one tests the worker.
test.use({ serviceWorkers: 'allow' });

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
    // Only the worker's cache may serve the fallback's files, so the retry proves the shell.
    await bypassHttpCache(page);
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

// The installed app on a phone without signal starts cold: no page of it is
// open, the browser starts the worker for the start URL. Staging sits behind
// Vercel Authentication, which redirects every request without its cookie, the
// worker's own shell requests included (werk-flow/werkflow-planning#22, OQ-5).
test('the installed app opens its shell on a cold start without signal, also behind deployment protection @AUDIT-SECURITY-OFFLINE-SHELL', async ({
  employeePage,
  world,
  baseURL,
}) => {
  // A cold start closes every page; the test goes on in the page it opens.
  let page = employeePage;
  await page.setViewportSize({ width: 375, height: 812 });

  await test.step('a cold start without signal opens the shell', async () => {
    await page.goto('/auftraege');
    await expect(jobListReady(page)).toBeVisible();
    await waitForOfflineShell(page);
    await coldStartWithoutSignal(page, baseURL ?? '', async (started) => {
      page = started;
      await expect(offlineFallback(page)).toBeVisible();
      await setNetwork(page, 'online');
    });
  });

  await test.step('behind deployment protection the shell fills, keeps nothing of the person and opens cold', async () => {
    await withProtectedOrigin(page, baseURL ?? '', async (origin) => {
      await page.goto(`${origin}/auftraege`);
      await expect(jobListReady(page)).toBeVisible();
      await waitForOfflineShell(page);
      await expectOnlyShellFilesCached(page, [world.users.employee.email]);
      await coldStartWithoutSignal(page, origin, async (started) => {
        await expect(offlineFallback(started)).toBeVisible();
        await setNetwork(started, 'online');
      });
    });
  });
});

// werk-flow/werkflow-planning#408: the build writes the shell version, so a
// deployment replaces the shell on a phone without anyone editing a number.
test('a new build replaces the shell a phone holds, without a manual version bump @AUDIT-SECURITY-OFFLINE-SHELL', async ({
  employeePage: page,
  request,
  baseURL,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await withDeployableOrigin(baseURL ?? '', async (deployment) => {
    await test.step('the worker of the served build names the build id as its shell version', async () => {
      await page.goto(`${deployment.origin}/auftraege`);
      await expect(jobListReady(page)).toBeVisible();
      await waitForOfflineShell(page);
      await expectShellOfServedBuild(page, request);
    });

    await test.step('after the next deployment the new worker fills its shell and deletes the old one', async () => {
      deployment.deployNextBuild();
      await expectNextBuildShellAfterUpdate(page);
    });

    await test.step('a navigation without network shows the fallback from the new shell', async () => {
      await bypassHttpCache(page);
      await setNetwork(page, 'offline');
      await page.goto(`${deployment.origin}/auftraege`);
      await expect(offlineFallback(page)).toBeVisible();
      await setNetwork(page, 'online');
    });
  });
});

test('an organization switch deletes what the worker cached and keeps the offline fallback @AUDIT-SECURITY-OFFLINE-SHELL', async ({
  adminPage: page,
  world,
}) => {
  const secondOrganization = goldenTestOrganizationName('Offline Zweitorg', world.runId);

  await test.step('the admin works in a second organization with a filled shell', async () => {
    await page.goto('/dashboard');
    await createAdditionalOrganization(page, secondOrganization);
    await waitForOfflineShell(page);
    await plantOwnedCache(page, world.users.admin.email);
  });

  await test.step('the switch back deletes the worker caches and the shell comes back', async () => {
    await selectFromSearchable(page, organizationSwitcher(page, secondOrganization), world.orgName, {
      searchFirst: false,
    });
    await expect(organizationSwitcher(page, world.orgName)).toBeEnabled();
    await expectOwnedCacheDeleted(page);
    await waitForOfflineShell(page);
  });

  await test.step('a reload without network shows the fallback', async () => {
    await setNetwork(page, 'offline');
    await page.reload();
    await expect(offlineFallback(page)).toBeVisible();
    await setNetwork(page, 'online');
  });
});
