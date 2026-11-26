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
 * Abrechnung“ with a running subscription and two invoices, loading, and
 * running or cancelled to the end of the period; Büro's settings no longer
 * list the section. The served test app holds no Stripe key, so „Nächste
 * Zahlung“ fails with its retry and the subscribed screens are `-error`
 * captures, the cancel confirmation over that failure included. The pilot
 * state without a subscription is the page's visual reference.
 */
function werkflowBillingCaptures(): OpenSet {
  const both = { widths: [1280, 375], schemes: ['light', 'dark'] } as const;
  const page = { kind: 'page' } as const;
  return {
    id: 'werkflow-billing-2026-11-16',
    captures: [
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
        id: stateCaptureId('admin-abo-gekuendigt', 'error'),
        role: 'admin',
        route: ROUTE,
        view: page,
        destination: cancelled,
        state: 'error',
        ...both,
      },
      {
        id: stateCaptureId('admin-abo-kuendigen', 'error'),
        role: 'admin',
        route: ROUTE,
        // The opener seeds the running subscription that offers the cancel.
        view: { kind: 'dialog', opener: 'settings.billing-cancel', overFailedPage: true },
        state: 'error',
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
