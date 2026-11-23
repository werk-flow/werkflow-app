import { acceptanceSet, type OpenSet } from '../acceptance-sets';

/**
 * werk-flow/werkflow-planning#489 of 2026-11-17: a field worker's start page
 * with today's Einsätze, the clock and the own Aufgaben, clocked out and
 * clocked in, on a phone and a desktop. Its empty, offline and failed states
 * read the phone's storage, which no request can hold: the component contract
 * (tests/ui-contracts/worker-start.spec.ts) proves them.
 */
function workerStartCaptures(): OpenSet {
  const both = { widths: [375, 1280], schemes: ['light', 'dark'] } as const;
  return {
    id: 'worker-start-2026-11-17',
    captures: [
      { id: 'employee-dashboard', role: 'employee', route: '/dashboard', view: { kind: 'page' }, ...both },
      {
        id: 'employee-dashboard-clocked-in',
        role: 'employee',
        route: '/dashboard',
        view: { kind: 'page' },
        clockedIn: true,
        ...both,
      },
    ],
    standalone: [],
  };
}

acceptanceSet(workerStartCaptures());
