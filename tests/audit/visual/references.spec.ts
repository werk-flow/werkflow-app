import type { Page } from '@playwright/test';

import { expect, test } from '../support/fixtures';
import { standaloneScreen } from '../../../lib/testing/selection/standalone-route-inventory';
import { openStandaloneScreen } from '../support/standalone-sessions';
import {
  APP_FAMILIES,
  STANDALONE_FAMILIES,
  type AppFamily,
  type StandaloneFamily,
} from '../support/visual-families';
import { DESKTOP, PHONE, expectReference, pageBody, settlePage } from '../support/visual-references';
import { prepareVisualWorld, standaloneReplacements, visualReplacements } from '../support/visual-fixtures';

// Visual references (release mode only): one reference per page family
// (tests/audit/support/visual-families.ts), so a change that alters how an
// accepted screen looks fails until the owner accepts the new picture. Each
// family renders its desktop reference in light and dark mode and its phone
// reference in light mode. docs/technical/standards-audit.md owns the
// acceptance and update rules. Tag: @AUDIT-VISUAL.

type Replacements = readonly (readonly [string, string])[];

/** The desktop in light and dark, then the phone in light, each opened anew at its width. */
async function expectFamilyReferences(
  page: Page,
  id: string,
  open: (viewport: { width: number; height: number }) => Promise<void>,
  replacements: Replacements,
  options: { clockText: boolean },
): Promise<void> {
  await page.emulateMedia({ colorScheme: 'light' });
  await open(DESKTOP);
  await expectReference(page, `${id}-desktop-light`, replacements, options);
  await page.emulateMedia({ colorScheme: 'dark' });
  await expectReference(page, `${id}-desktop-dark`, replacements, options);
  await page.emulateMedia({ colorScheme: 'light' });
  await open(PHONE);
  await expectReference(page, `${id}-phone-light`, replacements, options);
}

async function expectAppFamily(
  page: Page,
  family: AppFamily,
  route: string,
  replacements: Replacements,
): Promise<void> {
  const open = async (viewport: { width: number; height: number }): Promise<void> => {
    await page.setViewportSize(viewport);
    await page.goto(route);
    const main = page.getByRole('main');
    await expect(main.getByRole('heading', { level: 1, name: family.heading, exact: true })).toBeVisible();
    if (family.title)
      await expect(main.getByRole('heading', { level: 2, name: family.title, exact: true })).toBeVisible();
    await settlePage(page, pageBody(main));
  };
  await expectFamilyReferences(page, family.id, open, replacements, { clockText: family.clockText ?? true });
}

async function expectStandaloneFamily(
  page: Page,
  family: StandaloneFamily,
  path: string,
  replacements: Replacements,
): Promise<void> {
  const open = async (viewport: { width: number; height: number }): Promise<void> => {
    await page.setViewportSize(viewport);
    await page.goto(path);
    const main = page.getByRole('main');
    await expect(main.getByRole('heading', { level: 1, name: family.heading, exact: true })).toBeVisible();
    await settlePage(page, main);
  };
  await expectFamilyReferences(page, family.id, open, replacements, { clockText: true });
}

test.describe('@AUDIT-VISUAL rendered references of every page family', () => {
  for (const family of APP_FAMILIES.filter((entry) => entry.role === 'admin')) {
    test(`${family.id} matches its references`, async ({ adminPage, world }) => {
      const details = await prepareVisualWorld(world);
      const route = await family.route(details, adminPage, world);
      await expectAppFamily(adminPage, family, route, await visualReplacements(world));
    });
  }

  for (const family of APP_FAMILIES.filter((entry) => entry.role === 'employee')) {
    test(`${family.id} matches its references`, async ({ employeePage, world }) => {
      const details = await prepareVisualWorld(world);
      const route = await family.route(details, employeePage, world);
      await expectAppFamily(employeePage, family, route, await visualReplacements(world));
    });
  }

  for (const family of STANDALONE_FAMILIES) {
    test(`${family.id} matches its references`, async ({ browser, baseURL, world }) => {
      const screen = standaloneScreen(family.screen);
      const { context, page, email } = await openStandaloneScreen({ browser, baseURL, world, screen });
      try {
        const replacements = [...(await visualReplacements(world)), ...standaloneReplacements(world, email)];
        await expectStandaloneFamily(page, family, screen.path, replacements);
      } finally {
        await context.close();
      }
    });
  }
});
