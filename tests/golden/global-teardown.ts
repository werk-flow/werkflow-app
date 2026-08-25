import { loadEnvLocal } from './support/env';
import {
  activeRunFailed,
  archiveActiveState,
  currentRunKey,
  listRetainedWorlds,
  updateRunManifest,
} from './support/run-state';
import { destroyLeftoverTestWorlds, destroyTestWorld } from './support/seed';
import { loadWorld } from './support/world';

export default async function globalTeardown(): Promise<void> {
  loadEnvLocal();
  const failed = activeRunFailed();
  const diagnostic = Boolean(process.env.WERKFLOW_REUSE_RUN_KEY);
  const keepRequested = process.env.KEEP_WORLD === '1';

  let world;
  try {
    world = loadWorld();
  } catch (error) {
    console.log(
      `[golden] no readable active world: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    if (failed || diagnostic || keepRequested) {
      archiveActiveState();
      updateRunManifest(currentRunKey(), {
        ...(failed ? { status: 'failed_retained' as const } : {}),
        retainedAt: new Date().toISOString(),
      });
      console.log('[golden] retained the unreadable active world for diagnosis');
      return;
    }
    const removed = await destroyLeftoverTestWorlds(listRetainedWorlds());
    console.log(`[golden] destroyed ${removed} unretained leftover test records`);
    return;
  }

  if (failed || diagnostic || keepRequested) {
    archiveActiveState();
    updateRunManifest(currentRunKey(), {
      ...(failed ? { status: 'failed_retained' as const } : {}),
      retainedAt: new Date().toISOString(),
    });
    console.log(
      `[golden] retained world ${world.runId} for ${
        failed ? 'failure diagnosis' : keepRequested ? 'KEEP_WORLD request' : 'diagnostic reuse'
      }`
    );
    return;
  }

  let teardownError: unknown;
  try {
    await destroyTestWorld(world);
    console.log(`[golden] destroyed world ${world.runId}`);
  } catch (error) {
    teardownError = error;
  }

  const removed = await destroyLeftoverTestWorlds(listRetainedWorlds());
  console.log(`[golden] destroyed ${removed} unretained leftover test records`);
  if (teardownError) throw teardownError;
}
