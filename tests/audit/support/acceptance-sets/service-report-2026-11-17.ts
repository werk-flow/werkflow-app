import { acceptanceSet, type OpenSet } from '../acceptance-sets';

/**
 * werk-flow/werkflow-planning#471 of 2026-11-17: the Wartung page with
 * „Abgeschlossene Wartungsbesuche“ and its „Servicebericht erstellen“. Before:
 * the committed references `wartung-*`, which end with the workspace.
 */
function serviceReportCaptures(): OpenSet {
  const both = { widths: [1280, 375], schemes: ['light', 'dark'] } as const;
  return {
    id: 'service-report-2026-11-17',
    captures: [
      { id: 'admin-wartung', role: 'admin', route: '/service/wartung', view: { kind: 'page' }, ...both },
      { id: 'buero-wartung', role: 'buero', route: '/service/wartung', view: { kind: 'page' }, ...both },
    ],
    standalone: [],
  };
}

acceptanceSet(serviceReportCaptures());
