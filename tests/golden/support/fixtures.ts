import { expect, test as base, type Browser, type Page } from '@playwright/test';

import { createRolePage, type SessionRole } from './sessions';
import { resetPersistedPreferences } from './preferences-reset';
import { loadWorld, storageStatePath, type TestWorld } from './world';

type GoldenFixtures = {
  world: TestWorld;
  /** Automatic: the world's persisted per-user preferences are gone before every test. */
  freshPreferences: void;
  adminPage: Page;
  bueroPage: Page;
  employeePage: Page;
  outsiderPage: Page;
};

const DEFAULT_BASE_URL = process.env.GOLDEN_BASE_URL ?? 'http://localhost:3000';

async function rolePage(
  browser: Browser,
  baseUrl: string,
  role: SessionRole,
  provide: (page: Page) => Promise<void>
): Promise<void> {
  const { context, page } = await createRolePage({
    browser,
    baseUrl,
    world: loadWorld(),
    role,
  });
  let provideError: unknown;
  try {
    await provide(page);
  } catch (error) {
    provideError = error;
  }

  let cleanupError: unknown;
  if (!provideError) {
    try {
      // Protected-route middleware can rotate Supabase cookies while a role
      // fixture is in use. Persist only a successful fixture's final state;
      // global setup force-refreshes every role before retained diagnostics.
      await context.storageState({ path: storageStatePath(role) });
    } catch (error) {
      cleanupError = error;
    }
  }
  try {
    await context.close();
  } catch (error) {
    cleanupError ??= error;
  }

  if (provideError) {
    if (cleanupError) console.warn(`[golden] ${role} fixture cleanup also failed: ${String(cleanupError)}`);
    throw provideError;
  }
  if (cleanupError) throw cleanupError;
}

export const test = base.extend<GoldenFixtures>({
  world: async ({}, provide) => {
    await provide(loadWorld());
  },
  freshPreferences: [async ({}, provide) => {
    // Reads the world itself: the audit lane replaces the world in its own automatic fixture first.
    const world = loadWorld();
    await resetPersistedPreferences([world.orgId, world.outsider.orgId]);
    await provide();
  }, { auto: true }],
  adminPage: async ({ browser, baseURL }, provide) =>
    rolePage(browser, baseURL ?? DEFAULT_BASE_URL, 'admin', provide),
  bueroPage: async ({ browser, baseURL }, provide) =>
    rolePage(browser, baseURL ?? DEFAULT_BASE_URL, 'buero', provide),
  employeePage: async ({ browser, baseURL }, provide) =>
    rolePage(browser, baseURL ?? DEFAULT_BASE_URL, 'employee', provide),
  outsiderPage: async ({ browser, baseURL }, provide) =>
    rolePage(browser, baseURL ?? DEFAULT_BASE_URL, 'outsider', provide),
});

export { expect };
