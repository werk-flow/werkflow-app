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
  retryWithoutSignal,
  setNetwork,
  waitForOfflineShell,
  withDeployableOrigin,
  withProtectedOrigin,
} from '../support/offline-shell';
import {
  offlinePackText,
  offlineStand,
  seedTodayAssignment,
  waitForTodayOnDevice,
  wipeTodayFromPage,
} from '../support/offline-today';

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

  await test.step('a navigation without network shows the fallback, and a tap without signal says so', async () => {
    // The start page above stored the field worker's day or not, as its refresh raced the next
    // navigation; with a day the offline page rightly shows it. This step is about a phone that
    // keeps none, so the day goes as a wipe takes it (the stored day's own test is the cold start).
    await wipeTodayFromPage(page);
    // Only the worker's cache may serve the fallback's files, so the answer to the tap proves the shell.
    await bypassHttpCache(page);
    await setNetwork(page, 'offline');
    await page.goto('/auftraege');
    await expect(offlineFallback(page)).toBeVisible();
    await expect(page).toHaveURL(/\/auftraege$/);
    await retryWithoutSignal(page);
  });

  await test.step('with the signal back, a tap opens the page', async () => {
    // Chromium's offline emulation leaves this page's navigator.onLine true and fires no `online`,
    // so nothing returns on its own here and the tap is the way back; the UI contract
    // tests/ui-contracts/offline-retry.spec.ts proves the return on `online`.
    await setNetwork(page, 'online');
    await offlineRetryButton(page).click();
    await expect(jobListReady(page)).toBeVisible();
    await expect(page).toHaveURL(/\/auftraege$/);
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
// worker's own shell requests included (werk-flow/werkflow-planning#22, OQ-5),
// and names each image of public/ with the deployment's query. The iPhone
// re-test of 2026-11-14 showed the plain fallback instead of the stored day, a
// broken logo and a retry that did nothing: every file the page loads must
// come from the shell, and the page's script must run.
test('the installed app opens its shell on a cold start without signal, also behind deployment protection @AUDIT-SECURITY-OFFLINE-SHELL', async ({
  employeePage,
  world,
  baseURL,
}) => {
  // A cold start closes every page; the test goes on in the page it opens.
  let page = employeePage;
  await page.setViewportSize({ width: 375, height: 812 });
  const title = `Wartung Kaltstart ${world.runId}`;
  const instruction = `Abgasmessung ${world.runId}`;
  await seedTodayAssignment(world, { title, instruction });

  await test.step('a cold start without signal shows the day the start page stored', async () => {
    await page.goto('/dashboard');
    await waitForTodayOnDevice(page, [title, instruction]);
    await waitForOfflineShell(page);
    await coldStartWithoutSignal(page, baseURL ?? '', async (started) => {
      page = started;
      await expect(offlineStand(page)).toBeVisible();
      await expect(offlinePackText(page, title)).toBeVisible();
      await setNetwork(page, 'online');
    });
  });

  await test.step('behind deployment protection the shell fills, keeps nothing of the person and opens cold with its script and logo', async () => {
    await withProtectedOrigin(page, baseURL ?? '', async (origin) => {
      await page.goto(`${origin}/auftraege`);
      await expect(jobListReady(page)).toBeVisible();
      await waitForOfflineShell(page);
      await expectOnlyShellFilesCached(page, [world.users.employee.email]);
      await coldStartWithoutSignal(page, origin, async (started) => {
        await expect(offlineFallback(started)).toBeVisible();
        await retryWithoutSignal(started);
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
    await createAdditionalOrganization(page, secondOrganization, world.users.admin.email);
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
