import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import type { RunManifest } from '../../tests/golden/support/run-state';
import type { TestWorld } from '../../tests/golden/support/world';

export function readRetainedWorldState(
  manifest: Pick<RunManifest, 'runKey' | 'world'>,
  path: string,
): TestWorld {
  if (!existsSync(path)) throw new Error(`Retained run ${manifest.runKey} is missing archived world.json. Refusing to omit its owned resources from cleanup protection.`);
  const world = JSON.parse(readFileSync(path, 'utf8')) as TestWorld;
  validateRetainedWorldIdentity(manifest.world, world);
  return world;
}

/** Mirror only named state files, so a retired world's credentials cannot survive rotation. */
export function mirrorOwnedStateFiles(sources: readonly string[], targetDirectory: string): void {
  mkdirSync(targetDirectory, { recursive: true });
  for (const source of sources) {
    const target = resolve(targetDirectory, basename(source));
    if (existsSync(source)) copyFileSync(source, target);
    else rmSync(target, { force: true });
  }
}

/** Restore workload inputs, never outcomes that could masquerade as diagnostic evidence. */
export function restoreRetainedWorkloads(sourceDirectory: string, targetDirectory: string): void {
  mirrorOwnedStateFiles([
    resolve(sourceDirectory, 'performance-workload.json'),
    resolve(sourceDirectory, 'planning-benchmark-workload.json'),
  ], targetDirectory);
}

export function validateRetainedWorldIdentity(
  manifestWorld: { runId: string; organizationIds: string[] } | null,
  world: { runId: string; orgId: string; outsider: { orgId: string } },
): void {
  if (!manifestWorld || manifestWorld.runId !== world.runId || !manifestWorld.organizationIds.includes(world.orgId) || !manifestWorld.organizationIds.includes(world.outsider.orgId)) {
    throw new Error('Retained world identities do not match the run manifest. Refusing to restore stale or unrelated state.');
  }
}
