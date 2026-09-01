import { loadEnvLocal } from './support/env';
import {
  activeRunFailed,
  archiveActiveState,
  currentRunKey,
  listRetainedWorlds,
  readRunManifest,
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
    let manifestHasWorld = false;
    try {
      manifestHasWorld = Boolean(readRunManifest(currentRunKey())?.world);
    } catch (manifestError) {
      console.log(
        `[golden] run manifest unreadable: ${
          manifestError instanceof Error
            ? manifestError.message
            : String(manifestError)
        }`
      );
      manifestHasWorld = false;
    }
    if ((failed || diagnostic || keepRequested) && manifestHasWorld) {
      archiveActiveState();
      updateRunManifest(currentRunKey(), {
        ...(failed ? { status: 'failed_retained' as const } : {}),
        retainedAt: new Date().toISOString(),
      });
      console.log('[golden] retained the unreadable active world for diagnosis');
      return;
    }
    if (failed || diagnostic || keepRequested) {
      if (!keepRequested) {
        const removed = await destroyLeftoverTestWorlds(listRetainedWorlds());
        console.log(`[golden] destroyed ${removed} unretained leftover test records`);
      }
      console.log('[golden] active world loading failed or its manifest has no usable world');
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
