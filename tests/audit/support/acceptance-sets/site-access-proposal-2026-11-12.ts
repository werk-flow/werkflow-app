import { acceptanceSet, type OpenSet } from '../acceptance-sets';
import type { TestWorld } from '../../../golden/support/world';
import { seedSiteAccessJob, siteAccessJob, type SiteAccessJobState } from '../site-access-fixtures';
import type { SurfaceDestination } from '../surface-routes';

/** The employee's job at an Einsatzort in the given proposal state. */
function siteAccessJobDestination(state: SiteAccessJobState) {
  return async (world: TestWorld): Promise<SurfaceDestination> => {
    await seedSiteAccessJob(world, state);
    const { jobNumber, title } = siteAccessJob(world, state);
    return { route: `/auftraege/${encodeURIComponent(jobNumber)}`, heading: title };
  };
}

/** The office's Aufgaben with one open access proposal. */
async function siteAccessTasks(world: TestWorld): Promise<SurfaceDestination> {
  await seedSiteAccessJob(world, 'open');
  return { route: '/aufgaben', heading: 'Zugang prüfen' };
}

/**
 * werk-flow/werkflow-planning#329 of 2026-11-12: the field worker's pencil
 * on the job's Einsatzort, the form, the open and the rejected proposal with
 * the rejected one's form, and the „Zugang prüfen“ task in Aufgaben with its review on the
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
        ...phone,
      },
      {
        id: 'handwerker-zugang-abgelehnt',
        ...job,
        view: { kind: 'page' },
        destination: siteAccessJobDestination('rejected'),
        ...phone,
      },
      {
        id: 'handwerker-zugang-abgelehnt-formular',
        ...job,
        view: { kind: 'dialog', opener: 'field.site-access' },
        destination: siteAccessJobDestination('rejected'),
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
