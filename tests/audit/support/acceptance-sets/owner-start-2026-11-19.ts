import { worldName } from '../../../../lib/testing/seed-world-plan';
import { berlinDateAtOffset } from '../../../golden/support/date-ownership';
import { seedRequest } from '../../../golden/support/db/requests';
import { createAdminClient } from '../../../golden/support/db/shared';
import type { TestWorld } from '../../../golden/support/world';
import { surfaceFixture } from '../surface-fixtures';
import type { SurfaceDestination } from '../surface-routes';
import { acceptanceSet, type OpenSet } from '../acceptance-sets';

/**
 * The owner's start with an exception: Büro's callback, promised a week ago,
 * is five workdays overdue and reaches Admin with its owner.
 */
async function ownerWithOverdueCallback(world: TestWorld): Promise<SurfaceDestination> {
  await surfaceFixture(world, 'acceptance.owner-start-overdue-callback', async () => {
    const requestId = await seedRequest({
      orgId: world.orgId,
      actorId: world.users.buero.id,
      assignedTo: world.users.buero.id,
      summary: worldName('Rückruf wegen Heizungsausfall', world.runId),
      requestNumber: `ANF-${world.runId}-OWNER`,
      callerName: 'Erika Musterfrau',
    });
    await createAdminClient()
      .from('client_requests')
      .update({ callback_due_at: `${berlinDateAtOffset(-7)}T08:00:00.000Z` })
      .eq('id', requestId)
      .throwOnError();
    return requestId;
  });
  return { route: '/dashboard', heading: 'Dashboard' };
}

/**
 * werk-flow/werkflow-planning#490 of 2026-11-19: above the office start,
 * Admin sees „Braucht deine Entscheidung“; Büro's start does not change.
 */
function ownerStartCaptures(): OpenSet {
  return {
    id: 'owner-start-2026-11-19',
    captures: [
      {
        id: 'admin-dashboard-entscheidung',
        role: 'admin',
        route: '/dashboard',
        view: { kind: 'page' },
        destination: ownerWithOverdueCallback,
        widths: [1280, 375],
        schemes: ['light', 'dark'],
      },
      {
        id: 'buero-dashboard',
        role: 'buero',
        route: '/dashboard',
        view: { kind: 'page' },
        destination: ownerWithOverdueCallback,
        widths: [375],
        schemes: ['light'],
      },
    ],
    standalone: [],
  };
}

acceptanceSet(ownerStartCaptures());
