import { expect, type Locator } from '@playwright/test';
import type { TestWorld } from '../../../golden/support/world';
import { acceptanceSet, type OpenSet } from '../acceptance-sets';
import { prepareFieldEquipment } from '../dialog-openers/time';
import { layoutNames } from '../layout-fixtures';

/** Links the layout Anlage to the employee's job, searches it by name and waits for its hit. */
async function searchFieldEquipment(layer: Locator, world: TestWorld): Promise<void> {
  await prepareFieldEquipment(world);
  await layer.getByRole('textbox', { name: 'Suchbegriff', exact: true }).fill('Wärmeerzeuger');
  await expect(
    layer
      .getByRole('region', { name: 'Anlagen', exact: true })
      .getByRole('link', { name: new RegExp(layoutNames(world).equipment) }),
  ).toBeVisible();
}

/**
 * werk-flow/werkflow-planning#493 of 2026-11-17: a field worker's header
 * search names the Anlagen of their jobs in its prompt and finds them; a hit
 * opens the job's work pack at that Anlage.
 */
function fieldEquipmentSearchCaptures(): OpenSet {
  const fieldSearch = { kind: 'dialog', opener: 'customers.search-field' } as const;
  return {
    id: 'field-equipment-search-2026-11-17',
    captures: [
      {
        id: 'employee-search',
        role: 'employee',
        route: '/dashboard',
        view: fieldSearch,
        widths: [375],
        schemes: ['light', 'dark'],
      },
      {
        id: 'employee-search-hits',
        role: 'employee',
        route: '/dashboard',
        view: fieldSearch,
        widths: [375, 1280],
        schemes: ['light', 'dark'],
        inLayer: searchFieldEquipment,
      },
    ],
    standalone: [],
  };
}

acceptanceSet(fieldEquipmentSearchCaptures());
