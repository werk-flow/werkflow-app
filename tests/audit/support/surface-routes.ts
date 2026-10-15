import { expect, type Page } from '@playwright/test';
import type {
  DynamicPhoneRoute,
  InventoriedRoute,
} from '../../../lib/testing/selection/mobile-route-inventory';
import {
  periodListHeading,
  periodOpenLinks,
  TIME_ACCOUNT_COPY,
} from '../../golden/support/steps/time-tracking';
import type { TestWorld } from '../../golden/support/world';
import { layoutNames, prepareLayoutDetails } from './layout-fixtures';

/** A concrete page of the route inventory, with the heading that proves its record loaded. */
export type SurfaceDestination = { route: string; heading?: string };

const DYNAMIC_ROUTES: ReadonlySet<string> = new Set<DynamicPhoneRoute>([
  '/kunden/[clientId]',
  '/anfragen/[requestId]',
  '/auftraege/[jobNumber]',
  '/mitarbeiter/[userId]',
  '/auftraege/[jobNumber]/uebergabe',
  '/auftraege/projekt/[projectNumber]',
  '/auftraege/projekt/[projectNumber]/uebergabe',
  '/auftraege/projekt/[projectNumber]/[jobNumber]',
  '/auftraege/projekt/[projectNumber]/[jobNumber]/uebergabe',
  '/auftraege/uebergaben/[targetType]/[targetId]',
  '/service/anlagen/[equipmentNumber]',
  '/service/faelle/[caseNumber]',
  '/zeiterfassung/perioden/[periodId]',
]);

function isDynamicRoute(route: InventoriedRoute): route is DynamicPhoneRoute {
  return DYNAMIC_ROUTES.has(route);
}

/** Resolves an inventoried route or detail pattern to the page the audit opens in this world. */
export async function surfaceDestination(
  route: InventoriedRoute,
  page: Page,
  world: TestWorld,
  businessDate: string,
): Promise<SurfaceDestination> {
  return isDynamicRoute(route) ? detailDestination(route, page, world, businessDate) : { route };
}

export async function detailDestination(
  pattern: DynamicPhoneRoute,
  page: Page,
  world: TestWorld,
  businessDate: string,
): Promise<{ route: string; heading: string }> {
  if (pattern === '/zeiterfassung/perioden/[periodId]') {
    await page.goto('/zeiterfassung/perioden');
    const content = page.getByRole('main').locator('[data-page-body]');
    await expect(periodListHeading(content)).toBeVisible();
    const open = periodOpenLinks(content);
    if ((await open.count()) === 0) {
      // Use the real preparation boundary to obtain a calculated period with
      // employee rows and findings, rather than fabricating protected snapshots.
      // Seeded personnel starts in the business month. The default previous
      // month would produce an empty result and leave the mobile result cards unobserved.
      const month = businessDate.slice(0, 7);
      const monthInput = content.getByRole('textbox', { name: TIME_ACCOUNT_COPY.month, exact: true });
      await expect(monthInput).toHaveValue(/^\d{2}\.\d{4}$/);
      await monthInput.fill(month);
      // The picker commits a typed month and shows it in German order on blur.
      await monthInput.blur();
      await expect(monthInput).toHaveValue(`${month.slice(5)}.${month.slice(0, 4)}`);
      await content.getByRole('button', { name: TIME_ACCOUNT_COPY.preparePeriod, exact: true }).click();
      // Successful preparation redirects directly to the saved period.
      await expect(page).toHaveURL(/\/zeiterfassung\/perioden\/[0-9a-f-]{36}$/);
      return { route: new URL(page.url()).pathname, heading: TIME_ACCOUNT_COPY.monthlyResults };
    }
    await expect(open).toHaveCount(1);
    const route = await open.getAttribute('href');
    if (!route?.startsWith('/zeiterfassung/perioden/'))
      throw new Error('Period preparation did not expose its exact saved detail route.');
    return { route, heading: TIME_ACCOUNT_COPY.monthlyResults };
  }
  const details = await prepareLayoutDetails(world);
  const names = layoutNames(world);
  switch (pattern) {
    case '/kunden/[clientId]':
      return { route: `/kunden/${details.clientId}`, heading: names.client };
    case '/anfragen/[requestId]':
      return { route: `/anfragen/${details.requestId}`, heading: names.request };
    case '/mitarbeiter/[userId]':
      return {
        route: `/mitarbeiter/${world.users.employee.id}`,
        heading: `${world.users.employee.firstName} ${world.users.employee.lastName}`,
      };
    case '/service/anlagen/[equipmentNumber]':
      return { route: `/service/anlagen/${details.equipmentNumber}`, heading: names.equipment };
    case '/service/faelle/[caseNumber]':
      return { route: `/service/faelle/${details.caseNumber}`, heading: names.serviceCase };
    case '/auftraege/[jobNumber]':
      return { route: `/auftraege/${details.jobNumber}`, heading: names.job };
    case '/auftraege/[jobNumber]/uebergabe':
      return { route: `/auftraege/${details.jobNumber}/uebergabe`, heading: names.job };
    case '/auftraege/projekt/[projectNumber]':
      return { route: `/auftraege/projekt/${details.projectNumber}`, heading: names.project };
    case '/auftraege/projekt/[projectNumber]/uebergabe':
      return { route: `/auftraege/projekt/${details.projectNumber}/uebergabe`, heading: names.project };
    case '/auftraege/projekt/[projectNumber]/[jobNumber]':
      return {
        route: `/auftraege/projekt/${details.projectNumber}/${details.nestedJobNumber}`,
        heading: names.nestedJob,
      };
    case '/auftraege/projekt/[projectNumber]/[jobNumber]/uebergabe':
      return {
        route: `/auftraege/projekt/${details.projectNumber}/${details.nestedJobNumber}/uebergabe`,
        heading: names.nestedJob,
      };
    case '/auftraege/uebergaben/[targetType]/[targetId]':
      return { route: `/auftraege/uebergaben/auftrag/${details.jobId}`, heading: names.job };
  }
}

/**
 * Opens the page and waits until it is usable: the URL is the requested one,
 * the page title and the record heading are visible, the page body holds
 * content and no skeleton is left.
 */
export async function openSurface(page: Page, destination: SurfaceDestination): Promise<void> {
  await page.goto(destination.route);
  await expect(page).toHaveURL((url) => decodeURIComponent(url.pathname) === destination.route);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  const content = page.getByRole('main').locator('[data-page-body]');
  await expect(content).toBeVisible();
  await expect(content.locator('[data-slot="skeleton"]:visible')).toHaveCount(0);
  await expect(content).not.toHaveText('');
  if (destination.heading)
    await expect(page.getByRole('heading', { name: destination.heading, exact: true })).toBeVisible();
}
