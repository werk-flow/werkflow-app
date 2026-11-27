import { kiOrganizationFor, kiThreadWithRows } from '../../../golden/support/db/ki';
import type { TestWorld } from '../../../golden/support/world';
import { acceptanceSet, type OpenSet } from '../acceptance-sets';

/**
 * werk-flow/werkflow-planning#533 of 2026-11-27: the rows of the agent's work
 * in a WerkFlow KI thread, in the run's KI organization: a ticked plan, a
 * customer search, the answer and a question with its answers. The opened
 * search is its own set, ki-row-open-2026-11-27; the new chat's copy is in
 * ki-chat-2026-11-26.
 */

function kiRowCaptures(): OpenSet {
  const both = { widths: [1280, 375], schemes: ['light', 'dark'] } as const;
  const base = {
    role: 'admin',
    route: '/ki',
    view: { kind: 'page' },
    destination: kiThreadWithRows,
    account: async (world: TestWorld) => {
      const ki = await kiOrganizationFor(world);
      return { user: ki.users.admin, organizationId: ki.organizationId };
    },
    ...both,
  } as const;
  return {
    id: 'ki-rows-2026-11-27',
    captures: [{ ...base, id: 'admin-ki-zeilen' }],
    standalone: [],
  };
}

acceptanceSet(kiRowCaptures());
