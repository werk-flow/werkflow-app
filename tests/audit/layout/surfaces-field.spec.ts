import { test } from '../support/fixtures';
import { surfaceTests } from '../../../lib/testing/selection/surface-groups';
import { auditSurfaceTest } from '../support/surface-audit';

// Rendered audit of the field worker's pages (werkflow-design, "Checklist"):
// every page in both themes with WCAG 2.2 target
// sizes, every in-page tab at every width and every dialog the field worker
// opens (clock, manual entry, evidence, sickness, vacation) at 1280, 768 and
// 375 px with axe and its keyboard path. Tag: @AUDIT-LAYOUT-SURFACES.

test.describe('@AUDIT-LAYOUT-SURFACES field: tabs and dialogs fit, pass axe and keep their keyboard path', () => {
  for (const piece of surfaceTests('field')) {
    test(piece.title, async ({ employeePage, world, businessDate }) => {
      await auditSurfaceTest({ page: employeePage, role: 'employee', world, businessDate }, piece);
    });
  }
});
