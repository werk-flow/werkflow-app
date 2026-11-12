import { relative, resolve } from 'node:path';
import type { BrowserContext, Page } from '@playwright/test';
import { test as sharedTest, expect } from '../../golden/support/fixtures';
import { resetPersistedPreferences } from '../../golden/support/preferences-reset';
import { attachWorldToRun, currentRunKey, updateRunManifest } from '../../golden/support/run-state';
import { createRolePage } from '../../golden/support/sessions';
import { loadWorld, saveWorld, type TestRole } from '../../golden/support/world';

// One file owns one world until the parent qualifies all assertions and measurements.
// Multiple files run as separate verifier groups, never as world replacements here.
export const test = sharedTest.extend<{
  auditWorldReady: void;
  /**
   * Opens a page of the role a test names in data, such as an acceptance
   * capture's role, instead of one page fixture per role. Its teardown closes
   * every session it opened, as the page fixtures do.
   */
  rolePage: (role: TestRole) => Promise<Page>;
}>({
  auditWorldReady: [
    async ({}, provide, testInfo) => {
      const group = relative(resolve(__dirname, '..'), testInfo.file).replaceAll('\\', '/');
      const world = loadWorld();
      if (world.auditGroup && world.auditGroup !== group) {
        throw new Error(
          `World belongs to ${world.auditGroup}, not ${group}. Run files as separate verification groups.`,
        );
      }
      world.auditGroup = group;
      saveWorld(world);
      attachWorldToRun(world);
      updateRunManifest(currentRunKey(), { auditGroup: group });
      await provide();
    },
    { auto: true },
  ],
  rolePage: async ({ browser, baseURL }, provide) => {
    const sessions: BrowserContext[] = [];
    await provide(async (role) => {
      const { context, page } = await createRolePage({ browser, baseUrl: baseURL, world: loadWorld(), role });
      sessions.push(context);
      return page;
    });
    for (const session of sessions) await session.close();
  },
  freshPreferences: async ({ auditWorldReady }, provide) => {
    void auditWorldReady;
    const world = loadWorld();
    await resetPersistedPreferences([world.orgId, world.outsider.orgId]);
    await provide();
  },
});

export { expect };
