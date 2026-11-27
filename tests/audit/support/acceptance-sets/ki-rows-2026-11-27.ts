import { expect, type Locator } from '@playwright/test';
import { KI_SEEDED_CUSTOMER, kiOrganizationFor, seedKiTurnWithRows } from '../../../golden/support/db/ki';
import type { TestWorld } from '../../../golden/support/world';
import { acceptanceSet, type OpenSet } from '../acceptance-sets';

/**
 * werk-flow/werkflow-planning#533 of 2026-11-27: the rows of the agent's work
 * in a WerkFlow KI thread, in the run's KI organization: a ticked plan, a
 * customer search collapsed and opened, the answer and a question with its
 * answers. The new chat's changed first-contact copy is in the `/ki` visual
 * reference.
 */
async function threadWithRows(world: TestWorld): Promise<{ route: string }> {
  const ki = await kiOrganizationFor(world);
  const threadId = await seedKiTurnWithRows(ki, 'admin', 'Welche Kunden heißen Müller?');
  return { route: `/ki?chat=${threadId}` };
}

/** Opens the customer search row, which reads its result only now. */
async function openedToolRow(scope: Locator): Promise<void> {
  await scope.getByRole('button', { name: 'Kunden und Einsatzorte finden', exact: true }).click();
  await expect(scope.getByText(`${KI_SEEDED_CUSTOMER} · K-1001`, { exact: false })).toBeVisible();
}

function kiRowCaptures(): OpenSet {
  const both = { widths: [1280, 375], schemes: ['light', 'dark'] } as const;
  const base = {
    role: 'admin',
    route: '/ki',
    view: { kind: 'page' },
    destination: threadWithRows,
    account: async (world: TestWorld) => {
      const ki = await kiOrganizationFor(world);
      return { user: ki.users.admin, organizationId: ki.organizationId };
    },
    ...both,
  } as const;
  return {
    id: 'ki-rows-2026-11-27',
    captures: [
      { ...base, id: 'admin-ki-zeilen' },
      { ...base, id: 'admin-ki-zeile-geoeffnet', act: openedToolRow },
    ],
    standalone: [],
  };
}

acceptanceSet(kiRowCaptures());
