import type { CaptureSpec } from '../acceptance-rounds';
import { acceptanceSet, type OpenSet } from '../acceptance-sets';

/**
 * werk-flow/werkflow-planning#409 of 2026-11-13: the report dialog with its
 * screenshot preview, and the large redaction view over it, for the field
 * worker and the office, on a phone, a laptop and a desktop.
 */
function reportRedactionCaptures(): OpenSet {
  const sizes = { widths: [375, 1280, 1440], schemes: ['light', 'dark'] } as const;
  const views = [
    { id: 'employee-dashboard-dialog-reports-field', role: 'employee', route: '/dashboard', opener: 'reports.field' },
    { id: 'buero-auftraege-dialog-reports-office', role: 'buero', route: '/auftraege', opener: 'reports.office' },
    {
      id: 'employee-dashboard-dialog-reports-redaction-field',
      role: 'employee',
      route: '/dashboard',
      opener: 'reports.redaction-field',
    },
    {
      id: 'buero-auftraege-dialog-reports-redaction-office',
      role: 'buero',
      route: '/auftraege',
      opener: 'reports.redaction-office',
    },
  ] as const;
  return {
    id: 'report-redaction-2026-11-13',
    captures: views.map(
      ({ id, role, route, opener }): CaptureSpec => ({
        id,
        role,
        route,
        view: { kind: 'dialog', opener },
        ...sizes,
      }),
    ),
    standalone: [],
  };
}

acceptanceSet(reportRedactionCaptures());
