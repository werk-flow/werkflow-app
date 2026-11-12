import { acceptanceSet, type OpenSet } from '../acceptance-sets';

/**
 * werk-flow/werkflow-planning#167 of 2026-10-30: the proposed start date with
 * its reason, and the opening date correction of opened time accounts.
 */
function timeAccountOpeningCaptures(): OpenSet {
  return {
    id: 'time-account-opening-2026-10-30',
    captures: [
      {
        id: 'admin-zeiterfassung-einstellungen',
        role: 'admin',
        route: '/zeiterfassung/einstellungen',
        view: { kind: 'page' },
        widths: [1280, 375],
        schemes: ['light', 'dark'],
        reveal: 'Zeitkonten',
      },
    ],
    standalone: [],
  };
}

acceptanceSet(timeAccountOpeningCaptures());
