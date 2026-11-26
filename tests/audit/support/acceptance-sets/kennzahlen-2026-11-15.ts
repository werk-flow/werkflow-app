import { stateCaptureId } from '../acceptance-state-plan';
import { acceptanceSet, type OpenSet } from '../acceptance-sets';

/**
 * werk-flow/werkflow-planning#278 of 2026-11-15: the Admin's „Wochenzahlen“
 * with the world's records, and its loading state. Büro and field workers
 * are sent to the dashboard, so they have no capture. The failure is a region
 * the server renders, which no browser interception can produce.
 */
function weeklyNumbersCaptures(): OpenSet {
  const both = { widths: [1280, 375], schemes: ['light', 'dark'] } as const;
  const page = { kind: 'page' } as const;
  return {
    id: 'kennzahlen-2026-11-15',
    captures: [
      { id: 'admin-wochenzahlen', role: 'admin', route: '/kennzahlen', view: page, ...both },
      {
        id: stateCaptureId('admin-wochenzahlen', 'loading'),
        role: 'admin',
        route: '/kennzahlen',
        view: page,
        state: 'loading',
        ...both,
      },
    ],
    standalone: [],
  };
}

acceptanceSet(weeklyNumbersCaptures());
