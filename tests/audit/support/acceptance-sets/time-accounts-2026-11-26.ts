import { acceptanceSet, type OpenSet } from '../acceptance-sets';

/**
 * werk-flow/werkflow-planning#358 and #264 of 2026-11-26: the adjustment forms
 * with their „Stunden (Std:Min)“ field, and an employee's own Zeitkonto with
 * its monthly values.
 */
function timeAccountCaptures(): OpenSet {
  return {
    id: 'time-accounts-2026-11-26',
    captures: [
      {
        id: 'admin-zeitkonto-korrigieren',
        role: 'admin',
        route: '/zeiterfassung/einstellungen',
        view: { kind: 'page' },
        widths: [1280, 375],
        schemes: ['light', 'dark'],
        reveal: 'Zeitkonto korrigieren',
      },
      {
        id: 'employee-zeitkonto',
        role: 'employee',
        route: '/zeiterfassung/zeitkonto',
        view: { kind: 'page' },
        widths: [1280, 375],
        schemes: ['light', 'dark'],
      },
    ],
    standalone: [],
  };
}

acceptanceSet(timeAccountCaptures());
