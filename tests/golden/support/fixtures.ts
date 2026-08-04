import { test as base, type BrowserContext, type Page } from '@playwright/test';

import { loadWorld, storageStatePath, type TestWorld } from './world';

type GoldenFixtures = {
  world: TestWorld;
  adminPage: Page;
  bueroPage: Page;
  employeePage: Page;
  outsiderPage: Page;
};

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

export { expect } from '@playwright/test';
