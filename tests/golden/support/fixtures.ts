import { expect, test as base, type BrowserContext, type Page } from '@playwright/test';

import { loadWorld, storageStatePath, type TestWorld } from './world';

type GoldenFixtures = {
  world: TestWorld;
  adminPage: Page;
  bueroPage: Page;
  employeePage: Page;
  outsiderPage: Page;
};

export async function ensureOutsiderSession(
  context: BrowserContext,
  page: Page
): Promise<void> {
  const world = loadWorld();
  await context.clearCookies();
  let loggedIn = false;
  for (let attempt = 1; attempt <= 3 && !loggedIn; attempt++) {
    await page.goto('/login');
    await page.waitForLoadState('networkidle');
    await page.locator('input[autocomplete="email"]').fill(world.outsider.admin.email);
    await page
      .locator('input[autocomplete="current-password"]')
      .fill(world.outsider.admin.password);
    await page.getByRole('button', { name: 'Anmelden' }).click();
    loggedIn = await page
      .waitForURL('**/dashboard', { timeout: 20_000 })
      .then(() => true)
      .catch(() => false);
  }
  if (!loggedIn) throw new Error('Outsider fixture could not restore its session.');
  await expect
    .poll(
      async () =>
        (await context.cookies()).find((cookie) => cookie.name === 'current_org_id')?.value,
      { timeout: 20_000 }
    )
    .toBe(world.outsider.orgId);
}

// Playwright fixture callbacks receive a `use` continuation; it is renamed to
// `provide` here so the react-hooks lint rule does not mistake it for a Hook.
async function rolePage(
  browser: import('@playwright/test').Browser,
  role: 'admin' | 'buero' | 'employee' | 'outsider',
  provide: (page: Page) => Promise<void>
): Promise<void> {
  const context: BrowserContext = await browser.newContext({
    storageState: storageStatePath(role),
  });
  const page = await context.newPage();
  if (role === 'outsider') await ensureOutsiderSession(context, page);
  await provide(page);
  await context.close();
}

export const test = base.extend<GoldenFixtures>({
  world: async ({}, provide) => {
    await provide(loadWorld());
  },
  adminPage: async ({ browser }, provide) => rolePage(browser, 'admin', provide),
  bueroPage: async ({ browser }, provide) => rolePage(browser, 'buero', provide),
  employeePage: async ({ browser }, provide) => rolePage(browser, 'employee', provide),
  outsiderPage: async ({ browser }, provide) => rolePage(browser, 'outsider', provide),
});

export { expect };
