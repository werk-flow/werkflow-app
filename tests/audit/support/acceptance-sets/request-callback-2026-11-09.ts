import { worldName } from '../../../../lib/testing/seed-world-plan';
import { seedCustomer } from '../../../golden/support/db/customers';
import { seedRequest } from '../../../golden/support/db/requests';
import { createAdminClient } from '../../../golden/support/db/shared';
import type { TestWorld } from '../../../golden/support/world';
import { surfaceFixture } from '../surface-fixtures';
import type { SurfaceDestination } from '../surface-routes';
import { acceptanceSet, type OpenSet } from '../acceptance-sets';

/**
 * An open emergency request at a site without a recorded Anlage, owned by the
 * Büro, whose promised callback passed two hours ago. One seed serves the
 * request detail and the Büro's Aufgaben.
 */
async function seedCallbackOverdueRequest(world: TestWorld): Promise<{ requestId: string; summary: string }> {
  const summary = worldName('Kein Warmwasser im Haus 3', world.runId);
  const requestId = await surfaceFixture(world, 'acceptance.callback-overdue-request', async () => {
    const customer = await seedCustomer({
      orgId: world.orgId,
      actorId: world.users.admin.id,
      name: worldName('Hausverwaltung Lindenhof GmbH', world.runId),
      sites: [{ name: 'Lindenhof 3', street: 'Lindenhof 3', postalCode: '10115', city: 'Berlin' }],
    });
    const siteId = customer.siteIds.get('Lindenhof 3');
    if (!siteId) throw new Error('seedCallbackOverdueRequest: the site was not seeded');
    const id = await seedRequest({
      orgId: world.orgId,
      actorId: world.users.admin.id,
      summary,
      requestNumber: `ANF-${world.runId}-CALL`,
      clientId: customer.clientId,
      siteId,
      urgency: 'notfall',
      assignedTo: world.users.buero.id,
    });
    await createAdminClient()
      .from('client_requests')
      .update({ callback_due_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString() })
      .eq('id', id)
      .throwOnError();
    return id;
  });
  return { requestId, summary };
}

async function callbackOverdueRequest(world: TestWorld): Promise<SurfaceDestination> {
  const { requestId, summary } = await seedCallbackOverdueRequest(world);
  return { route: `/anfragen/${requestId}`, heading: summary };
}

async function callbackOverdueTasks(world: TestWorld): Promise<SurfaceDestination> {
  await seedCallbackOverdueRequest(world);
  return { route: '/aufgaben', heading: 'Rückruf überfällig' };
}

/**
 * werk-flow/werkflow-planning#322 of 2026-11-09: capture with „Rückruf bis“,
 * an emergency request whose callback is overdue with the Notfall notice and a
 * site without Anlagen, and the overdue callback in the Büro's Aufgaben.
 */
function requestCallbackCaptures(): OpenSet {
  const both = { widths: [1280, 375], schemes: ['light', 'dark'] } as const;
  return {
    id: 'request-callback-2026-11-09',
    captures: [
      {
        id: 'buero-anfrage-erfassen',
        role: 'buero',
        route: '/anfragen',
        view: { kind: 'dialog', opener: 'requests.create' },
        reveal: 'Rückruf bis',
        ...both,
      },
      {
        id: 'buero-anfrage-rueckruf',
        role: 'buero',
        route: '/anfragen/[requestId]',
        view: { kind: 'page' },
        destination: callbackOverdueRequest,
        ...both,
      },
      {
        id: 'buero-anfrage-bearbeiten',
        role: 'buero',
        route: '/anfragen/[requestId]',
        view: { kind: 'dialog', opener: 'requests.edit' },
        destination: callbackOverdueRequest,
        reveal: 'An diesem Einsatzort ist keine Anlage erfasst.',
        ...both,
      },
      {
        id: 'buero-aufgaben-rueckruf',
        role: 'buero',
        route: '/aufgaben',
        view: { kind: 'page' },
        destination: callbackOverdueTasks,
        ...both,
      },
    ],
    standalone: [],
  };
}

acceptanceSet(requestCallbackCaptures());
