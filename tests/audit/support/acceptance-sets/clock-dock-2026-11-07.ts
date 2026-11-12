import { acceptanceSet, type OpenSet } from '../acceptance-sets';

/**
 * werk-flow/werkflow-planning#138 of 2026-11-07: the clock dock clocked in on
 * the work pack and the time history, and clocked out on the period's findings.
 */
function clockDockCaptures(): OpenSet {
  const both = { widths: [1280, 375], schemes: ['light', 'dark'] } as const;
  return {
    id: 'clock-dock-2026-11-07',
    captures: [
      {
        id: 'employee-auftraege-jobNumber-clocked-in',
        role: 'employee',
        route: '/auftraege/[jobNumber]',
        view: { kind: 'page' },
        clockedIn: true,
        ...both,
      },
      {
        id: 'employee-zeiterfassung-tab-history-clocked-in',
        role: 'employee',
        route: '/zeiterfassung',
        view: { kind: 'tab', value: 'history' },
        clockedIn: true,
        ...both,
      },
      {
        id: 'admin-zeiterfassung-perioden-periodId',
        role: 'admin',
        route: '/zeiterfassung/perioden/[periodId]',
        view: { kind: 'page' },
        reveal: 'Prüfhinweise',
        ...both,
      },
    ],
    standalone: [],
  };
}

acceptanceSet(clockDockCaptures());
