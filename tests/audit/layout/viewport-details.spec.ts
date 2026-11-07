import type { Locator } from '@playwright/test';
import { expect, test } from '../support/fixtures';
import {
  DYNAMIC_PHONE_ROUTES,
  MANAGER_PHONE_ROUTES,
  PHONE_REDIRECTS,
} from '../../../lib/testing/selection/mobile-route-inventory';
import { layoutNames, prepareLayoutDetails } from '../support/layout-fixtures';
import { detailDestination, openSurface } from '../support/surface-routes';
import {
  expectMainThreadSettles,
  expectNoControlUnderClock,
  expectPhoneLayout,
  expectWideLayout,
} from '../support/viewport-audit';
import {
  clockInLauncher,
  clockInOnJob,
  clockOut,
  monthlyResultListRow,
  monthlyResults,
  runningClockLauncher,
  timeHistoryPanel,
  timeHistoryTab,
} from '../../golden/support/steps/time-tracking';

// Design canon (werkflow-design, "Density and layout"): the detail pages, the
// field worker's work packs and the route aliases fit a 375 px phone, and every
// manager page and detail page fits the tablet and laptop widths (768, 1024,
// 1280 and 1680 px). The list pages at 375 px run in audit:layout
// (mobile-viewport.spec.ts). Tag: @AUDIT-LAYOUT.

test.describe('@AUDIT-LAYOUT tablet and laptop widths: no horizontal scroll', () => {
  for (const route of MANAGER_PHONE_ROUTES) {
    test(`admin ${route} fits 768, 1024, 1280 and 1680 px`, async ({ adminPage, world }) => {
      await expectWideLayout(adminPage, route, world);
    });
  }

  for (const pattern of DYNAMIC_PHONE_ROUTES) {
    test(`admin ${pattern} fits 768, 1024, 1280 and 1680 px`, async ({ adminPage, world, businessDate }) => {
      const destination = await detailDestination(pattern, adminPage, world, businessDate);
      await expectWideLayout(adminPage, destination.route, world);
    });
  }
});

test.describe('@AUDIT-LAYOUT phone details and route aliases', () => {
  for (const pattern of DYNAMIC_PHONE_ROUTES) {
    test(`admin ${pattern} fits a 375 px viewport`, async ({ adminPage, world, businessDate }, testInfo) => {
      const destination = await detailDestination(pattern, adminPage, world, businessDate);
      await expectPhoneLayout(adminPage, destination.route, testInfo, destination.heading);
      if (pattern === '/zeiterfassung/perioden/[periodId]') {
        const employeeName = `${world.users.employee.firstName} ${world.users.employee.lastName}`;
        await expect(
          monthlyResultListRow(monthlyResults(adminPage), employeeName).getByText(employeeName, {
            exact: true,
          }),
        ).toBeVisible();
      }
    });
  }

  test('admin scoped project handover fits a 375 px viewport', async ({ adminPage, world }, testInfo) => {
    const details = await prepareLayoutDetails(world);
    await expectPhoneLayout(
      adminPage,
      `/auftraege/uebergaben/projekt/${details.projectId}`,
      testInfo,
      layoutNames(world).project,
    );
  });

  for (const pattern of [
    '/auftraege/[jobNumber]',
    '/auftraege/projekt/[projectNumber]/[jobNumber]',
  ] as const) {
    test(`employee ${pattern} work pack fits a 375 px viewport`, async ({
      adminPage,
      employeePage,
      world,
      businessDate,
    }, testInfo) => {
      const destination = await detailDestination(pattern, adminPage, world, businessDate);
      await expectPhoneLayout(employeePage, destination.route, testInfo, destination.heading);
      // A lifecycle transition reloads the pack with a flash param, which the
      // page strips with a route transition while hydration work is pending.
      await employeePage.goto(`${destination.route}?field_transition=updated`);
      await expect(employeePage).toHaveURL(
        (url) => decodeURIComponent(url.pathname) === destination.route && url.search === '',
      );
      // The URL changes before the replace's server render arrives; the loop began after that render.
      await employeePage.waitForLoadState('networkidle');
      await expectMainThreadSettles(employeePage, `${destination.route} after a lifecycle transition`);
    });
  }

  for (const alias of PHONE_REDIRECTS) {
    test(`admin ${alias.route} redirects to its audited page`, async ({ adminPage }, testInfo) => {
      await adminPage.goto(alias.route);
      await expect(adminPage).toHaveURL((url) => url.pathname === alias.destination);
      await expectPhoneLayout(adminPage, alias.destination, testInfo);
    });
  }
});

// The clock dock never covers a page control, in either clock state, at any
// scroll position: while clocked in, the activity and the two hot keys sit in
// the dock; clocked out, the dock holds the start button. The pages are the
// ones where the floating clock covered controls (werk-flow/werkflow-planning#59
// and #89). The phone list and detail pages run the same check clocked out.
test.describe('@AUDIT-LAYOUT the clock dock never covers a control', () => {
  for (const viewport of [
    { width: 375, height: 812 },
    { width: 1280, height: 800 },
  ]) {
    test(`employee at ${viewport.width} px, clocked out and clocked in on a job: work pack, time pages and settings stay clear`, async ({
      adminPage,
      employeePage,
      world,
      businessDate,
    }) => {
      const pack = await detailDestination('/auftraege/[jobNumber]', adminPage, world, businessDate);
      await employeePage.setViewportSize(viewport);
      const expectFieldPagesClear = async (state: string, launcher: Locator): Promise<void> => {
        for (const destination of [pack, { route: '/zeiterfassung' }, { route: '/einstellungen' }]) {
          await openSurface(employeePage, destination);
          await expect(launcher).toBeEnabled();
          await expectNoControlUnderClock(employeePage, `${state}, ${destination.route}`);
        }
        await openSurface(employeePage, { route: '/zeiterfassung' });
        await timeHistoryTab(employeePage).click();
        await expect(timeHistoryPanel(employeePage)).toBeVisible();
        await expectNoControlUnderClock(employeePage, `${state}, /zeiterfassung Verlauf`);
      };
      await expectFieldPagesClear('clocked out', clockInLauncher(employeePage));
      await clockInOnJob(employeePage, pack.heading);
      try {
        await expectFieldPagesClear('clocked in', runningClockLauncher(employeePage));
      } finally {
        await clockOut(employeePage);
      }
    });

    test(`admin clocked out at ${viewport.width} px: the period's findings stay clear`, async ({
      adminPage,
      world,
      businessDate,
    }) => {
      const period = await detailDestination(
        '/zeiterfassung/perioden/[periodId]',
        adminPage,
        world,
        businessDate,
      );
      await adminPage.setViewportSize(viewport);
      await openSurface(adminPage, period);
      await expect(clockInLauncher(adminPage)).toBeEnabled();
      await expectNoControlUnderClock(adminPage, period.route);
    });
  }
});
