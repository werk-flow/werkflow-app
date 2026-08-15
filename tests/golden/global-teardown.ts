import { loadEnvLocal } from './support/env';
import { destroyLeftoverTestWorlds, destroyTestWorld } from './support/seed';
import { loadWorld } from './support/world';

export default async function globalTeardown(): Promise<void> {
  loadEnvLocal();

  // Debug escape hatch: keep the seeded world for manual inspection.
  // The next normal run's leftover sweeper removes it.
  if (process.env.KEEP_WORLD === '1') {
    console.log('[golden] KEEP_WORLD=1 — skipping world teardown');
    return;
  }

  let world;
  try {
    world = loadWorld();
  } catch {
    const removed = await destroyLeftoverTestWorlds();
    console.log(`[golden] destroyed ${removed} leftover test records`);
    return;
  }

  let teardownError: unknown;
  try {
    await destroyTestWorld(world);
    console.log(`[golden] destroyed world ${world.runId}`);
  } catch (error) {
    teardownError = error;
  }

  const removed = await destroyLeftoverTestWorlds();
  console.log(`[golden] destroyed ${removed} leftover test records`);

  if (teardownError) throw teardownError;
}
