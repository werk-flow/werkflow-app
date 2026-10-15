import { expect, test } from '../support/fixtures';
import {
  DYNAMIC_PHONE_ROUTES,
  MANAGER_PHONE_ROUTES,
  PHONE_REDIRECTS,
} from '../../../lib/testing/selection/mobile-route-inventory';
import { layoutNames, prepareLayoutDetails } from '../support/layout-fixtures';
import { detailDestination } from '../support/surface-routes';
import { expectMainThreadSettles, expectPhoneLayout, expectWideLayout } from '../support/viewport-audit';
import { monthlyResultListRow, monthlyResults } from '../../golden/support/steps/time-tracking';

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
