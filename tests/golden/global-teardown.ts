import { loadEnvLocal } from './support/env';
import { completedWorldCleanup, finishOwnedWorldCleanup, retainUnreadableOwnedWorld } from '../../lib/testing/owned-world-lifecycle';
import {
  activeRunFailed,
  archiveActiveState,
  currentRunKey,
  markRunFailed,
  readRunManifest,
  updateRunManifest,
} from './support/run-state';
import { destroyTestWorld } from './support/seed';
import { loadWorld } from './support/world';

export default async function globalTeardown(): Promise<void> {
  loadEnvLocal();
  const failed = activeRunFailed();
  const diagnostic = Boolean(process.env.WERKFLOW_REUSE_RUN_KEY);
  const keepRequested = process.env.KEEP_WORLD === '1';
  const recordOwnedFailure = (error: unknown): void => {
    updateRunManifest(currentRunKey(), {
      status: 'failed_retained', retainedAt: new Date().toISOString(), cleanedAt: null,
    });
    markRunFailed({ title: 'Owned-world cleanup incomplete', file: null, message: error instanceof Error ? error.message : String(error) });
  };

  let world;
  try {
    world = loadWorld();
  } catch (error) {
    console.log(
      `[golden] no readable active world: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    let manifestWorld;
    try {
      manifestWorld = readRunManifest(currentRunKey()).world;
    } catch (manifestError) {
      console.log(
        `[golden] run manifest unreadable: ${
          manifestError instanceof Error
            ? manifestError.message
            : String(manifestError)
        }`
      );
      throw new AggregateError([error, manifestError], 'Active test world and ownership manifest are unreadable. No leftover sweep was attempted.');
    }
    retainUnreadableOwnedWorld(manifestWorld, error, {
      retain: recordOwnedFailure,
      archive: archiveActiveState,
    });
    console.log('[golden] manifest owns no active world; no unrelated records were swept');
    return;
  }

  if (failed || diagnostic || keepRequested) {
    updateRunManifest(currentRunKey(), {
      ...(failed ? { status: 'failed_retained' as const } : {}),
      retainedAt: new Date().toISOString(),
    });
    archiveActiveState();
    console.log(
      `[golden] retained world ${world.runId} for ${
        failed ? 'failure diagnosis' : keepRequested ? 'KEEP_WORLD request' : 'diagnostic reuse'
      }`
    );
    return;
  }

  await finishOwnedWorldCleanup({
    destroy: () => destroyTestWorld(world),
    recordCleaned: () => {
      updateRunManifest(currentRunKey(), (manifest) =>
        completedWorldCleanup(world, manifest, new Date().toISOString())
      );
      console.log(`[golden] destroyed world ${world.runId}`);
    },
    retain: recordOwnedFailure,
    archive: archiveActiveState,
  });
}
