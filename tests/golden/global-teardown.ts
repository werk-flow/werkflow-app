import { loadEnvLocal } from './support/env';
import { destroyTestWorld } from './support/seed';
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
    return;
  }

  await destroyTestWorld(world);
  console.log(`[golden] destroyed world ${world.runId}`);
}
