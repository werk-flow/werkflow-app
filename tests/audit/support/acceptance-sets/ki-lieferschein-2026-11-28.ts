import { expect, type Locator } from '@playwright/test';
import { kiOrganizationFor, kiThreadWithLieferschein } from '../../../golden/support/db/ki';
import type { TestWorld } from '../../../golden/support/world';
import { acceptanceSet } from '../acceptance-sets';

/**
 * werk-flow/werkflow-planning#535 of 2026-11-28: the „KI-Entwurf“ card of a
 * read Lieferschein, opened from its tool row, for a Lieferschein that fits
 * the inventory and one whose lines do not.
 */
async function openedCard(scope: Locator): Promise<void> {
  const row = scope.getByRole('button', { name: 'Lieferschein lesen', exact: true });
  // The act runs once per width on the same page: a second click would close the row.
  if ((await row.getAttribute('aria-expanded')) !== 'true') await row.click();
  await expect(scope.getByRole('region', { name: 'Lieferschein LS-2026-1187' })).toBeVisible();
}

const account = (role: 'admin' | 'buero') => async (world: TestWorld) => {
  const ki = await kiOrganizationFor(world);
  return { user: ki.users[role], organizationId: ki.organizationId };
};

acceptanceSet({
  id: 'ki-lieferschein-2026-11-28',
  captures: [
    {
      id: 'admin-lieferschein-passt',
      role: 'admin',
      route: '/ki',
      view: { kind: 'page' },
      destination: (world: TestWorld) => kiThreadWithLieferschein(world, 'admin', 'sauber'),
      act: openedCard,
      account: account('admin'),
      widths: [1280, 375],
      schemes: ['light', 'dark'],
    },
    {
      id: 'buero-lieferschein-abweichend',
      role: 'buero',
      route: '/ki',
      view: { kind: 'page' },
      destination: (world: TestWorld) => kiThreadWithLieferschein(world, 'buero', 'abweichend'),
      act: openedCard,
      account: account('buero'),
      widths: [1280, 375],
      schemes: ['light', 'dark'],
    },
  ],
  standalone: [],
});
