import { loadEnvLocal } from './support/env';
import { destroyTestWorld } from './support/seed';
import { loadWorld } from './support/world';

export default async function globalTeardown(): Promise<void> {
  loadEnvLocal();

  let world;
  try {
    world = loadWorld();
  } catch {
    return;
  }

  await destroyTestWorld(world);
  console.log(`[golden] destroyed world ${world.runId}`);
}
