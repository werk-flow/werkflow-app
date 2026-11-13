import type { CaptureSpec } from '../acceptance-rounds';
import { acceptanceSet, type OpenSet } from '../acceptance-sets';

/**
 * werk-flow/werkflow-planning#410 of 2026-11-13: the report dialog with the
 * redrawn screenshot, opened in each theme, for the field worker and the office.
 */
function reportThemeCaptures(): OpenSet {
  const views = [
    {
      id: 'employee-dashboard-dialog-reports-field',
      role: 'employee',
      route: '/dashboard',
      opener: 'reports.field',
    },
    {
      id: 'buero-auftraege-dialog-reports-office',
      role: 'buero',
      route: '/auftraege',
      opener: 'reports.office',
    },
  ] as const;
  return {
    id: 'report-theme-2026-11-13',
    captures: views.map(
      ({ id, role, route, opener }): CaptureSpec => ({
        id,
        role,
        route,
        view: { kind: 'dialog', opener },
        widths: [375, 1280],
        schemes: ['light', 'dark'],
        openInEachScheme: true,
      }),
    ),
    standalone: [],
  };
}

acceptanceSet(reportThemeCaptures());
