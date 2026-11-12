import { test } from '../support/fixtures';
import { surfaceTests } from '../../../lib/testing/selection/surface-groups';
import { ACCEPTANCE_RECORDS } from '../support/acceptance-records';
import { expectNoSidewaysOverflow, expectPhoneMeasures } from '../support/layout-measure';
import { auditSurfaceTest } from '../support/surface-audit';
import { openSurface } from '../support/surface-routes';

// Rendered audit of the customers pages (werkflow-design, "Checklist"): every page in
// both themes, every in-page tab at every width and every dialog at 1280, 768
// and 375 px with axe and its keyboard path. The inventories in
// lib/testing/selection/ name the pages, tabs and dialogs. Tag: @AUDIT-LAYOUT-SURFACES.

test.describe('@AUDIT-LAYOUT-SURFACES customers: tabs and dialogs fit, pass axe and keep their keyboard path', () => {
  for (const piece of surfaceTests('customers')) {
    test(piece.title, async ({ adminPage, world, businessDate }) => {
      await auditSurfaceTest({ page: adminPage, role: 'admin', world, businessDate }, piece);
    });
  }

  // The golden world has no Objekt roles and the list opens without a search,
  // so the default views never render the role lines. These open them with
  // the worst-case unbroken names of `worldName`.
  for (const record of ['managed-building-search', 'managed-building'] as const) {
    test(`${record}: every Objekt and role line wraps inside its card`, async ({ adminPage, world }) => {
      const destination = await ACCEPTANCE_RECORDS[record](world);
      await adminPage.setViewportSize({ width: 375, height: 812 });
      await openSurface(adminPage, destination);
      await expectPhoneMeasures(adminPage, `${destination.route} at 375 px`);
      await adminPage.setViewportSize({ width: 1280, height: 800 });
      await expectNoSidewaysOverflow(adminPage, `${destination.route} at 1280 px`);
    });
  }
});
