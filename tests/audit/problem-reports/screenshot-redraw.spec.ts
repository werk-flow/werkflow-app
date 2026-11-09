import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { type Page } from '@playwright/test';
import type { loadUiStringCatalog } from '../../../lib/problem-reports/screenshot/load-ui-string-catalog';
import type { redrawPage } from '../../../lib/problem-reports/screenshot/redraw-page';
import type { redrawScreenshot } from '../../../lib/problem-reports/screenshot/redraw-screenshot';
import { buildRedrawForBrowserTest } from '../../../lib/problem-reports/screenshot/browser-test-bundle';
import { expectDefined } from '../../../lib/testing/spec-support/expect-defined';
import { expect, test } from '../support/fixtures';
import { seedCustomer } from '../../golden/support/db/customers';
import { seedJob } from '../../golden/support/db/work';
import { visibleText } from '../../golden/support/steps/shared';
import { artifactsDirectory, type TestWorld } from '../../golden/support/world';

// The screenshot redraw (docs/technical/problem-report-scrubbing.md) on real
// pages: a seeded customer and a seeded job of a made-up company, at phone and
// desktop width. No product page loads the redraw yet, so the test serves the
// built modules on the app's own origin and imports them in the page.

type RedrawPageModule = { redrawPage: typeof redrawPage };
type CatalogModule = { loadUiStringCatalog: typeof loadUiStringCatalog };
type ScreenshotModule = { redrawScreenshot: typeof redrawScreenshot };

const MODULE_PATH = '/__problem-report-redraw/';
const VIEWPORTS = [
  { name: 'phone', width: 375, height: 812 },
  { name: 'desktop', width: 1280, height: 900 },
] as const;

/** One customer with a contact and a site, and one job for them, all named for this run and test. */
async function seedRecords(world: TestWorld, testId: string) {
  const run = `${world.runId}-${testId}`;
  const values = {
    customer: `Musterbau Nord ${run}`,
    contact: `Erika Musterfrau ${run}`,
    phone: '+49 4321 987654',
    email: `erika.${run}@musterbau-nord.example`,
    site: `Heizzentrale Lindenhof ${run}`,
    street: 'Lindenallee 17',
    postalCode: '24999',
    city: 'Musterhafen',
    jobNumber: `RD-${run}`,
    jobTitle: `Heizungstausch Lindenhof ${run}`,
  };
  const customer = await seedCustomer({
    orgId: world.orgId,
    actorId: world.users.admin.id,
    name: values.customer,
    clientType: 'gewerblich',
    contacts: [{ name: values.contact, phone: values.phone, email: values.email, isPrimary: true }],
    sites: [
      {
        name: values.site,
        street: values.street,
        postalCode: values.postalCode,
        city: values.city,
        primaryContactName: values.contact,
        isPrimary: true,
      },
    ],
  });
  await seedJob({
    orgId: world.orgId,
    actorId: world.users.admin.id,
    jobNumber: values.jobNumber,
    title: values.jobTitle,
    clientId: customer.clientId,
    siteId: expectDefined(customer.siteIds.get(values.site), 'the seeded site'),
    contactId: expectDefined(customer.contactIds.get(values.contact), 'the seeded contact'),
  });
  return { values, clientId: customer.clientId };
}

async function serveRedraw(page: Page): Promise<void> {
  const modules = buildRedrawForBrowserTest();
  await page.route(`**${MODULE_PATH}*`, (route) => {
    const code = modules.get(new URL(route.request().url()).pathname.slice(MODULE_PATH.length));
    return code
      ? route.fulfill({ contentType: 'text/javascript', body: code })
      : route.fulfill({ status: 404, body: '' });
  });
}

/** Redraws the open page: the clone serialized, and the PNG as base64. */
async function redraw(page: Page): Promise<{ markup: string; png: string }> {
  return page.evaluate(async (base) => {
    const isPageModule = (value: unknown): value is RedrawPageModule =>
      typeof value === 'object' && value !== null && 'redrawPage' in value;
    const isCatalogModule = (value: unknown): value is CatalogModule =>
      typeof value === 'object' && value !== null && 'loadUiStringCatalog' in value;
    const isScreenshotModule = (value: unknown): value is ScreenshotModule =>
      typeof value === 'object' && value !== null && 'redrawScreenshot' in value;
    const paths = ['redraw-page.js', 'load-ui-string-catalog.js', 'redraw-screenshot.js'].map(
      (name) => base + name,
    );
    const loaded: unknown[] = await Promise.all(paths.map((path) => import(path)));
    const [pageModule, catalogModule, screenshotModule] = loaded;
    if (!isPageModule(pageModule) || !isCatalogModule(catalogModule) || !isScreenshotModule(screenshotModule))
      throw new Error('The redraw bundle is incomplete.');
    const clone = pageModule.redrawPage(document, catalogModule.loadUiStringCatalog(), Math.random).root;
    const blob = await screenshotModule.redrawScreenshot();
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return { markup: new XMLSerializer().serializeToString(clone), png: btoa(binary) };
  }, MODULE_PATH);
}

test.describe('Report screenshot redraw @AUDIT-SECURITY-PROBLEM-REPORT-REDRAW', () => {
  for (const viewport of VIEWPORTS) {
    test(`a seeded customer and job leave no seeded value in the redraw (${viewport.name})`, async ({
      adminPage,
      world,
    }, testInfo) => {
      const { values, clientId } = await seedRecords(world, viewport.name);
      await adminPage.setViewportSize({ width: viewport.width, height: viewport.height });
      await serveRedraw(adminPage);
      const pages = [
        { name: 'customer', path: `/kunden/${clientId}`, shown: values.customer },
        { name: 'job', path: `/auftraege/${encodeURIComponent(values.jobNumber)}`, shown: values.jobTitle },
      ];
      for (const target of pages) {
        await test.step(`${target.name} page at ${viewport.width} px`, async () => {
          await adminPage.goto(target.path);
          await expect(visibleText(adminPage, target.shown)).toBeVisible();
          const { markup, png } = await redraw(adminPage);
          const name = `redraw-${target.name}-${viewport.name}.png`;
          writeFileSync(resolve(artifactsDirectory(), name), Buffer.from(png, 'base64'));
          await testInfo.attach(name, { body: Buffer.from(png, 'base64'), contentType: 'image/png' });
          for (const [field, value] of Object.entries(values))
            expect(markup, `the seeded ${field} is not in the redrawn ${target.name} page`).not.toContain(
              value,
            );
          expect(markup, 'the redraw keeps no link').not.toContain('href=');
        });
      }
    });
  }
});
