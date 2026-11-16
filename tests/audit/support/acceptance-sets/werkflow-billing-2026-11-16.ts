import { seedWerkflowSubscription } from '../../../golden/support/db/werkflow-billing';
import type { TestWorld } from '../../../golden/support/world';
import { stateCaptureId } from '../acceptance-state-plan';
import { acceptanceSet, type OpenSet } from '../acceptance-sets';
import type { SurfaceDestination } from '../surface-routes';

const ROUTE = '/einstellungen/abonnement-abrechnung';

async function subscribed(world: TestWorld, cancelAtPeriodEnd: boolean): Promise<SurfaceDestination> {
  await seedWerkflowSubscription(world, { cancelAtPeriodEnd });
  return { route: ROUTE };
}
const running = (world: TestWorld) => subscribed(world, false);
const cancelled = (world: TestWorld) => subscribed(world, true);

/**
 * werk-flow/werkflow-planning#252 of 2026-11-16: the Admin's „Abonnement &
 * Abrechnung“ with a running subscription and two invoices, loading and with
 * a failed read, cancelled to the end of the period, and the cancel
 * confirmation; Büro's settings no longer list the section. The test server
 * holds no Stripe key, so „Nächste Zahlung“ shows its retry. The pilot
 * state without a subscription is the page's visual reference.
 */
function werkflowBillingCaptures(): OpenSet {
  const both = { widths: [1280, 375], schemes: ['light', 'dark'] } as const;
  const page = { kind: 'page' } as const;
  return {
    id: 'werkflow-billing-2026-11-16',
    captures: [
      { id: 'admin-abo-aktiv', role: 'admin', route: ROUTE, view: page, destination: running, ...both },
      {
        id: stateCaptureId('admin-abo-aktiv', 'loading'),
        role: 'admin',
        route: ROUTE,
        view: page,
        destination: running,
        state: 'loading',
        ...both,
      },
      {
        id: stateCaptureId('admin-abo-aktiv', 'error'),
        role: 'admin',
        route: ROUTE,
        view: page,
        destination: running,
        state: 'error',
        ...both,
      },
      {
        id: 'admin-abo-kuendigen',
        role: 'admin',
        route: ROUTE,
        view: { kind: 'dialog', opener: 'settings.billing-cancel' },
        ...both,
      },
      {
        id: 'admin-abo-gekuendigt',
        role: 'admin',
        route: ROUTE,
        view: page,
        destination: cancelled,
        ...both,
      },
      {
        id: 'buero-einstellungen-profil',
        role: 'buero',
        route: '/einstellungen/profil',
        view: page,
        ...both,
      },
    ],
    standalone: [],
  };
}

acceptanceSet(werkflowBillingCaptures());
