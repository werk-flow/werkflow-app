import { expect, type Locator } from '@playwright/test';
import type { TestWorld } from '../../../golden/support/world';
import { seedCustomer } from '../../../golden/support/db/customers';
import { seedJob, seedProject } from '../../../golden/support/db/work';
import { acceptanceSet, type OpenSet } from '../acceptance-sets';
import { surfaceFixture } from '../surface-fixtures';

/**
 * The made-up customer whose name the hit captures search for. No other set seeds „Kastanienhof“,
 * so the hits stay the same whichever sets ran before in the shared world.
 */
const CUSTOMER = 'Hausverwaltung Kastanienhof GmbH';

/** Seeds a customer with a site, a contact, a project and a job that all match „Kastanienhof“, once per world. */
async function seedKastanienhof(world: TestWorld): Promise<void> {
  await surfaceFixture(world, 'search.kastanienhof', async () => {
    const actorId = world.users.admin.id;
    const customer = await seedCustomer({
      orgId: world.orgId,
      actorId,
      name: CUSTOMER,
      clientType: 'gewerblich',
      address: 'Kastanienhofstraße 4, 70173 Stuttgart',
      contacts: [{ name: 'Erika Musterfrau', role: 'Verwalterin', phone: '0711 4455667', isPrimary: true }],
      sites: [
        {
          name: 'Wohnanlage Kastanienhof',
          street: 'Kastanienhofstraße 4',
          postalCode: '70173',
          city: 'Stuttgart',
          isPrimary: true,
        },
      ],
    });
    const siteId = customer.siteIds.get('Wohnanlage Kastanienhof');
    const projectId = await seedProject({
      orgId: world.orgId,
      actorId,
      projectNumber: `PRJ-${world.runId}-KASTANIENHOF`,
      name: 'Heizungstausch Wohnanlage Kastanienhof',
      clientId: customer.clientId,
      ...(siteId ? { siteId } : {}),
    });
    await seedJob({
      orgId: world.orgId,
      actorId,
      jobNumber: `AUF-${world.runId}-KASTANIENHOF`,
      title: 'Wartung Gastherme Kastanienhof',
      clientId: customer.clientId,
      ...(siteId ? { siteId } : {}),
      projectId,
    });
    return customer.clientId;
  });
}

/** Types the query into the open search and waits for the customer's hit. */
async function searchKastanienhof(layer: Locator, world: TestWorld): Promise<void> {
  await seedKastanienhof(world);
  await layer.getByRole('textbox', { name: 'Suchbegriff', exact: true }).fill('Kastanienhof');
  await expect(
    layer
      .getByRole('region', { name: 'Kunden', exact: true })
      .getByRole('link', { name: new RegExp(CUSTOMER) }),
  ).toBeVisible();
}

/**
 * werk-flow/werkflow-planning#487 of 2026-11-15: „Suchen“ under the
 * organization switcher on the desktop and in the phone header, and the
 * search dialog for the office and for a field worker, empty and with hits.
 */
function headerSearchCaptures(): OpenSet {
  const both = { widths: [1280, 375], schemes: ['light', 'dark'] } as const;
  const officeSearch = { kind: 'dialog', opener: 'customers.search-office' } as const;
  return {
    id: 'header-search-2026-11-15',
    captures: [
      { id: 'admin-kunden', role: 'admin', route: '/kunden', view: { kind: 'page' }, ...both },
      { id: 'employee-dashboard', role: 'employee', route: '/dashboard', view: { kind: 'page' }, ...both },
      { id: 'admin-search', role: 'admin', route: '/kunden', view: officeSearch, ...both },
      {
        id: 'employee-search',
        role: 'employee',
        route: '/dashboard',
        view: { kind: 'dialog', opener: 'customers.search-field' },
        ...both,
      },
      {
        id: 'admin-search-hits',
        role: 'admin',
        route: '/kunden',
        view: officeSearch,
        widths: [1280],
        schemes: ['light'],
        inLayer: searchKastanienhof,
      },
      {
        id: 'admin-search-hits-phone',
        role: 'admin',
        route: '/kunden',
        view: officeSearch,
        widths: [375],
        schemes: ['dark'],
        inLayer: searchKastanienhof,
      },
    ],
    standalone: [],
  };
}

acceptanceSet(headerSearchCaptures());
