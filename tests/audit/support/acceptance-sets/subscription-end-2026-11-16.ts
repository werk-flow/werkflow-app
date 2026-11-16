import { expect, type Locator } from '@playwright/test';
import {
  seedSubscriptionEndedAfterFailedDebit,
  seedWerkflowSubscription,
} from '../../../golden/support/db/werkflow-billing';
import type { TestWorld } from '../../../golden/support/world';
import { stateCaptureId } from '../acceptance-state-plan';
import { acceptanceSet, type OpenSet } from '../acceptance-sets';
import type { SurfaceDestination } from '../surface-routes';

const BILLING = '/einstellungen/abonnement-abrechnung';
const ORGANIZATION = '/einstellungen/organisation';

async function endedAfterFailedDebit(world: TestWorld): Promise<SurfaceDestination> {
  await seedSubscriptionEndedAfterFailedDebit(world);
  return { route: BILLING };
}

async function subscribedOrganization(world: TestWorld): Promise<SurfaceDestination> {
  await seedWerkflowSubscription(world, { cancelAtPeriodEnd: false });
  return { route: ORGANIZATION };
}

/** The served test app holds no Stripe key, so ending the seeded subscription fails and nothing is deleted. */
async function deleteWhileStripeIsUnreachable(dialog: Locator, world: TestWorld): Promise<void> {
  await dialog.getByLabel('Gib den Namen der Organisation ein, um zu bestätigen:').fill(world.orgName);
  await dialog.getByRole('button', { name: 'Endgültig löschen', exact: true }).click();
  await expect(dialog.getByText('konnte gerade nicht beendet werden', { exact: false })).toBeVisible();
}

/**
 * werk-flow/werkflow-planning#495 of 2026-11-16 (werk-flow/werkflow-app#512):
 * the create dialog starts a further organization's Checkout, the billing
 * page offers „Abo neu abschließen“ after Stripe ended the subscription over
 * a failed first debit, and the organization's deletion says that its
 * subscription ends at once, with the refusal when Stripe cannot end it. The
 * billing page's „Nächste Zahlung“ fails without a Stripe key, so its capture
 * is an `-error` capture, as in werkflow-billing-2026-11-16. The refusal has
 * no before: the previous build deleted the organization.
 */
function subscriptionEndCaptures(): OpenSet {
  const both = { widths: [1280, 375], schemes: ['light', 'dark'] } as const;
  return {
    id: 'subscription-end-2026-11-16',
    captures: [
      {
        id: 'admin-dashboard-dialog-create-org',
        role: 'admin',
        route: '/dashboard',
        view: { kind: 'dialog', opener: 'settings.create-org' },
        ...both,
      },
      {
        id: stateCaptureId('admin-abo-erste-zahlung-fehlgeschlagen', 'error'),
        role: 'admin',
        route: BILLING,
        view: { kind: 'page' },
        destination: endedAfterFailedDebit,
        state: 'error',
        ...both,
      },
      {
        id: 'admin-organisation-dialog-delete-org',
        role: 'admin',
        route: ORGANIZATION,
        view: { kind: 'dialog', opener: 'settings.delete-org' },
        ...both,
      },
      {
        id: 'admin-organisation-dialog-delete-org-abo-nicht-beendet',
        role: 'admin',
        route: ORGANIZATION,
        view: { kind: 'dialog', opener: 'settings.delete-org' },
        destination: subscribedOrganization,
        act: deleteWhileStripeIsUnreachable,
        ...both,
      },
    ],
    standalone: [],
  };
}

acceptanceSet(subscriptionEndCaptures());
