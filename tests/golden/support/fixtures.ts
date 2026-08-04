import { test as base, type BrowserContext, type Page } from '@playwright/test';

import { loadWorld, storageStatePath, type TestWorld } from './world';

type GoldenFixtures = {
  world: TestWorld;
  adminPage: Page;
  bueroPage: Page;
  employeePage: Page;
  outsiderPage: Page;
};

async function rolePage(
  browser: import('@playwright/test').Browser,
  role: 'admin' | 'buero' | 'employee' | 'outsider',
  use: (page: Page) => Promise<void>
): Promise<void> {
  const context: BrowserContext = await browser.newContext({
    storageState: storageStatePath(role),
  });
  const page = await context.newPage();
  await use(page);
  await context.close();
}

export const test = base.extend<GoldenFixtures>({
  world: async ({}, use) => {
    await use(loadWorld());
  },
  adminPage: async ({ browser }, use) => rolePage(browser, 'admin', use),
  bueroPage: async ({ browser }, use) => rolePage(browser, 'buero', use),
  employeePage: async ({ browser }, use) => rolePage(browser, 'employee', use),
  outsiderPage: async ({ browser }, use) => rolePage(browser, 'outsider', use),
});

export { expect } from '@playwright/test';
