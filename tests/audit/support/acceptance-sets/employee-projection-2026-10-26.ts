import type { InventoriedRoute } from '../../../../lib/testing/selection/mobile-route-inventory';
import { slug, type CaptureSpec } from '../acceptance-rounds';
import { acceptanceSet, type OpenSet } from '../acceptance-sets';

/** The employee read projection of 2026-10-26: the field worker sees their job pages as before, and their project with only their own jobs. */
function employeeProjectionCaptures(): OpenSet {
  const both = { widths: [1280, 375], schemes: ['light', 'dark'] } as const;
  const routes: readonly InventoriedRoute[] = [
    '/auftraege/[jobNumber]',
    '/auftraege/projekt/[projectNumber]',
    '/auftraege/projekt/[projectNumber]/[jobNumber]',
  ];
  return {
    id: 'employee-projection-2026-10-26',
    captures: routes.map(
      (route): CaptureSpec => ({
        id: `employee-${slug(route)}`,
        role: 'employee',
        route,
        view: { kind: 'page' },
        ...both,
      }),
    ),
    standalone: [],
  };
}

acceptanceSet(employeeProjectionCaptures());
