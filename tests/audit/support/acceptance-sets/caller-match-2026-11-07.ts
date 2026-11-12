import { worldName } from '../../../../lib/testing/seed-world-plan';
import { seedCustomer } from '../../../golden/support/db/customers';
import { seedRequest } from '../../../golden/support/db/requests';
import { createAdminClient } from '../../../golden/support/db/shared';
import type { TestWorld } from '../../../golden/support/world';
import { surfaceFixture } from '../surface-fixtures';
import type { SurfaceDestination } from '../surface-routes';
import { acceptanceSet, type OpenSet } from '../acceptance-sets';

const CALLER = 'Erika Sommer';

/** An open request whose caller is already a customer: same name, the phone in another notation. */
async function callerMatchRequest(world: TestWorld): Promise<SurfaceDestination> {
  const summary = worldName('Heizung bleibt kalt im Erdgeschoss', world.runId);
  const requestId = await surfaceFixture(world, 'acceptance.caller-match-request', async () => {
    await seedCustomer({
      orgId: world.orgId,
      actorId: world.users.admin.id,
      name: CALLER,
      contacts: [{ name: CALLER, phone: '+49 (0)30 4440123', isPrimary: true }],
    });
    return seedRequest({
      orgId: world.orgId,
      actorId: world.users.admin.id,
      summary,
      requestNumber: `ANF-${world.runId}-MATCH`,
      callerName: CALLER,
      callerPhone: '030 44 40 123',
      callerAddress: 'Lindenweg 7, 10115 Berlin',
    });
  });
  return { route: `/anfragen/${requestId}`, heading: summary };
}

/** A request whose new caller was promoted with the captured address, ready to convert. */
async function promotedCallerRequest(world: TestWorld): Promise<SurfaceDestination> {
  const summary = worldName('Neue Therme für die Dachwohnung', world.runId);
  const requestId = await surfaceFixture(world, 'acceptance.promoted-caller-request', async () => {
    const id = await seedRequest({
      orgId: world.orgId,
      actorId: world.users.admin.id,
      summary,
      requestNumber: `ANF-${world.runId}-NEW`,
      callerName: worldName('Jonas Neumann', world.runId),
      callerPhone: '0171 2345678',
      callerAddress: 'Lindenallee 12, 10115 Berlin',
    });
    await createAdminClient()
      .rpc('promote_client_request_caller', {
        p_actor_id: world.users.admin.id,
        p_organization_id: world.orgId,
        p_request_id: id,
        p_name: '',
        p_client_type: 'privat',
      })
      .throwOnError();
    return id;
  });
  return { route: `/anfragen/${requestId}`, heading: summary };
}

/**
 * werk-flow/werkflow-planning#142 of 2026-11-07: an unmatched caller who is
 * already a customer, and the conversion of a promoted caller that starts with
 * the captured address as Einsatzort.
 */
function callerMatchCaptures(): OpenSet {
  const both = { widths: [1280, 375], schemes: ['light', 'dark'] } as const;
  return {
    id: 'caller-match-2026-11-07',
    captures: [
      {
        id: 'buero-anfrage-treffer',
        role: 'buero',
        route: '/anfragen/[requestId]',
        view: { kind: 'page' },
        destination: callerMatchRequest,
        ...both,
      },
      {
        id: 'buero-anfrage-umwandeln',
        role: 'buero',
        route: '/anfragen/[requestId]',
        view: { kind: 'dialog', opener: 'requests.convert' },
        destination: promotedCallerRequest,
        reveal: 'Ort',
        ...both,
      },
    ],
    standalone: [],
  };
}

acceptanceSet(callerMatchCaptures());
