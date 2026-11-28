import { expect, type Locator } from '@playwright/test';
import { KI_SEEDED_CUSTOMER, kiOrganizationFor, kiThreadWithRows } from '../../../golden/support/db/ki';
import type { TestWorld } from '../../../golden/support/world';
import { acceptanceSet } from '../acceptance-sets';

/**
 * werk-flow/werkflow-planning#533 of 2026-11-27: the customer search row of
 * the ki-rows set opened, which reads its input and result only now.
 */
async function openedToolRow(scope: Locator): Promise<void> {
  const row = scope.getByRole('button', { name: 'Kunden und Einsatzorte finden', exact: true });
  // The act runs once per width on the same page: a second click would close the row.
  if ((await row.getAttribute('aria-expanded')) !== 'true') await row.click();
  // Postgres orders a result's keys, so the customer's number follows its address.
  await expect(scope.getByText(new RegExp(`^${KI_SEEDED_CUSTOMER} · .* · K-1001$`))).toBeVisible();
}

acceptanceSet({
  id: 'ki-row-open-2026-11-27',
  captures: [
    {
      id: 'admin-ki-zeile-geoeffnet',
      role: 'admin',
      route: '/ki',
      view: { kind: 'page' },
      destination: kiThreadWithRows,
      act: openedToolRow,
      account: async (world: TestWorld) => {
        const ki = await kiOrganizationFor(world);
        return { user: ki.users.admin, organizationId: ki.organizationId };
      },
      widths: [1280, 375],
      schemes: ['light', 'dark'],
    },
  ],
  standalone: [],
});
