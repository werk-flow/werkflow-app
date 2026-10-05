import { relative, resolve } from 'node:path';
import { test as sharedTest, expect } from '../../golden/support/fixtures';
import { resetPersistedPreferences } from '../../golden/support/preferences-reset';
import { attachWorldToRun, currentRunKey, updateRunManifest } from '../../golden/support/run-state';
import { loadWorld, saveWorld } from '../../golden/support/world';

// One file owns one world until the parent qualifies all assertions and measurements.
// Multiple files run as separate verifier groups, never as world replacements here.
export const test = sharedTest.extend<{ auditWorldReady: void }>({
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
  freshPreferences: async ({ auditWorldReady }, provide) => {
    void auditWorldReady;
    const world = loadWorld();
    await resetPersistedPreferences([world.orgId, world.outsider.orgId]);
    await provide();
  },
});

export { expect };
