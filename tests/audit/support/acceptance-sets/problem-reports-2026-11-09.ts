import type { CaptureSpec } from '../acceptance-rounds';
import { stateCaptureId } from '../acceptance-state-plan';
import { acceptanceSet, type OpenSet } from '../acceptance-sets';

/**
 * werk-flow/werkflow-planning#334 of 2026-11-09: „Problem melden“ in the shell,
 * its dialog with the redrawn screenshot for the field worker and the office,
 * and „Meine Meldungen“ for each role, empty and loading.
 */
function problemReportCaptures(): OpenSet {
  const both = { widths: [1280, 375], schemes: ['light', 'dark'] } as const;
  const page = { kind: 'page' } as const;
  return {
    id: 'problem-reports-2026-11-09',
    captures: [
      { id: 'admin-dashboard', role: 'admin', route: '/dashboard', view: page, ...both },
      ...(['admin', 'buero', 'employee'] as const).map(
        (role): CaptureSpec => ({ id: `${role}-meldungen`, role, route: '/meldungen', view: page, ...both }),
      ),
      {
        id: stateCaptureId('employee-meldungen', 'loading'),
        role: 'employee',
        route: '/meldungen',
        view: page,
        state: 'loading',
        ...both,
      },
      {
        id: 'employee-dashboard-dialog-reports-field',
        role: 'employee',
        route: '/dashboard',
        view: { kind: 'dialog', opener: 'reports.field' },
        ...both,
      },
      {
        id: 'buero-auftraege-dialog-reports-office',
        role: 'buero',
        route: '/auftraege',
        view: { kind: 'dialog', opener: 'reports.office' },
        ...both,
      },
    ],
    standalone: [],
  };
}

acceptanceSet(problemReportCaptures());
