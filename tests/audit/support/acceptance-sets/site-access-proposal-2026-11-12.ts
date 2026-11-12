import { acceptanceSet, type OpenSet } from '../acceptance-sets';
import { siteAccessJobDestination, siteAccessTasks } from '../site-access-fixtures';

/**
 * werk-flow/werkflow-planning#329 of 2026-11-12: the field worker's „Zugang
 * stimmt nicht?“ on the job's Einsatzort, the form, the open and the rejected
 * proposal, and the „Zugang prüfen“ task in Aufgaben with its review on the
 * customer page.
 */
function siteAccessCaptures(): OpenSet {
  const phone = { widths: [375], schemes: ['light', 'dark'] } as const;
  const desktop = { widths: [1280], schemes: ['light', 'dark'] } as const;
  const job = { role: 'employee', route: '/auftraege/[jobNumber]' } as const;
  return {
    id: 'site-access-proposal-2026-11-12',
    captures: [
      {
        id: 'handwerker-zugang',
        ...job,
        view: { kind: 'page' },
        destination: siteAccessJobDestination('none'),
        reveal: 'Zugang stimmt nicht?',
        ...phone,
      },
      {
        id: 'handwerker-zugang-formular',
        ...job,
        view: { kind: 'dialog', opener: 'field.site-access' },
        destination: siteAccessJobDestination('none'),
        ...phone,
      },
      {
        id: 'handwerker-zugang-offen',
        ...job,
        view: { kind: 'page' },
        destination: siteAccessJobDestination('open'),
        reveal: 'Hinweis ändern',
        ...phone,
      },
      {
        id: 'handwerker-zugang-abgelehnt',
        ...job,
        view: { kind: 'page' },
        destination: siteAccessJobDestination('rejected'),
        reveal: 'Zugang stimmt nicht?',
        ...phone,
      },
      {
        id: 'buero-aufgaben-zugang',
        role: 'buero',
        route: '/aufgaben',
        view: { kind: 'page' },
        destination: siteAccessTasks,
        ...desktop,
      },
      {
        id: 'buero-aufgaben-zugang-pruefen',
        role: 'buero',
        route: '/aufgaben',
        view: { kind: 'dialog', opener: 'customers.site-access-review' },
        destination: siteAccessTasks,
        ...desktop,
      },
    ],
    standalone: [],
  };
}

acceptanceSet(siteAccessCaptures());
