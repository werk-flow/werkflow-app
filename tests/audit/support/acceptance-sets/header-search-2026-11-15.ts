import { acceptanceSet, type OpenSet } from '../acceptance-sets';

/**
 * werk-flow/werkflow-planning#487 of 2026-11-15: „Suchen“ under the
 * organization switcher on the desktop and in the phone header, and the
 * search dialog for the office and for a field worker.
 */
function headerSearchCaptures(): OpenSet {
  const both = { widths: [1280, 375], schemes: ['light', 'dark'] } as const;
  return {
    id: 'header-search-2026-11-15',
    captures: [
      { id: 'admin-kunden', role: 'admin', route: '/kunden', view: { kind: 'page' }, ...both },
      { id: 'employee-dashboard', role: 'employee', route: '/dashboard', view: { kind: 'page' }, ...both },
      {
        id: 'admin-search',
        role: 'admin',
        route: '/kunden',
        view: { kind: 'dialog', opener: 'customers.search-office' },
        ...both,
      },
      {
        id: 'employee-search',
        role: 'employee',
        route: '/dashboard',
        view: { kind: 'dialog', opener: 'customers.search-field' },
        ...both,
      },
    ],
    standalone: [],
  };
}

acceptanceSet(headerSearchCaptures());
