import { test } from '../support/fixtures';
import { surfaceTests } from '../../../lib/testing/selection/surface-groups';
import { auditSurfaceTest } from '../support/surface-audit';

// Rendered audit of the job pages (werkflow-design, "Checklist"): every page in
// both themes, every in-page tab at every width and every dialog at 1280, 768
// and 375 px with axe and its keyboard path. The inventories in
// lib/testing/selection/ name the pages, tabs and dialogs. Tag: @AUDIT-LAYOUT-SURFACES.

test.describe('@AUDIT-LAYOUT-SURFACES job: tabs and dialogs fit, pass axe and keep their keyboard path', () => {
  for (const piece of surfaceTests('job')) {
    test(piece.title, async ({ adminPage, world, businessDate }) => {
      await auditSurfaceTest({ page: adminPage, role: 'admin', world, businessDate }, piece);
    });
  }
});
