import { INCIDENT_CLASSES, type IncidentClass } from '../lib/testing/run-policy';
import { loadEnvLocal } from '../tests/golden/support/env';
import {
  listRunManifests,
  markWorldCleaned,
  readRunManifest,
  runDirectory,
  updateRunManifest,
} from '../tests/golden/support/run-state';
import { destroyTestWorld } from '../tests/golden/support/seed';
import type { TestWorld } from '../tests/golden/support/world';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function printRuns(): void {
  for (const manifest of listRunManifests().slice(-30)) {
    console.log(
      [
        manifest.runKey,
        manifest.status,
        `${manifest.lane}/${manifest.suite}/${manifest.target ?? 'cloud'}`,
        manifest.grep ?? 'full',
        manifest.world?.runId ?? 'no-world',
        manifest.classification ?? 'unclassified',
      ].join(' | ')
    );
  }
}

function isIncidentClass(value: string): value is IncidentClass {
  return (INCIDENT_CLASSES as readonly string[]).includes(value);
}

async function cleanupRun(runKey: string): Promise<void> {
  const manifest = readRunManifest(runKey);
  if (manifest.cleanedAt) {
    console.log(`[werkflow-test] ${runKey} was already cleaned`);
    return;
  }
  const worldPath = resolve(runDirectory(runKey), 'state/world.json');
  if (!manifest.world || !existsSync(worldPath)) {
    throw new Error(`Run ${runKey} has no retained world at ${worldPath}.`);
  }
  // The seeder follows .env.local. Destroying a world recorded against a
  // different backend would silently "succeed" against the wrong project and
  // leave the real rows behind — refuse instead.
  const currentProjectRef = new URL(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'invalid://missing'
  ).hostname.split('.')[0];
  if (manifest.projectRef && manifest.projectRef !== currentProjectRef) {
    throw new Error(
      `Run ${runKey} was recorded against project ${manifest.projectRef}, but .env.local points at ${currentProjectRef}. Switch env (bun run env:local / env:dev) before cleanup.`
    );
  }
  const world = JSON.parse(readFileSync(worldPath, 'utf8')) as TestWorld;
  await destroyTestWorld(world);
  markWorldCleaned(world);
  console.log(`[werkflow-test] cleaned retained world ${world.runId}`);
}

async function main(): Promise<void> {
  loadEnvLocal();
  const command = process.argv[2] ?? 'list';
  if (command === 'list') {
    printRuns();
    return;
  }
  if (command === 'cleanup') {
    const runKey = process.argv[3];
    if (!runKey) throw new Error('Usage: ... cleanup <run-key>');
    await cleanupRun(runKey);
    return;
  }
  if (command === 'cleanup-all') {
    const retained = listRunManifests().filter(
      (manifest) => manifest.retainedAt && !manifest.cleanedAt
    );
    const processedOrganizations = new Set<string>();
    const failedRunKeys: string[] = [];
    for (const manifest of retained) {
      const organizationId = manifest.world?.organizationIds[0];
      if (!organizationId || processedOrganizations.has(organizationId)) continue;
      processedOrganizations.add(organizationId);
      try {
        await cleanupRun(manifest.runKey);
      } catch (error) {
        failedRunKeys.push(manifest.runKey);
        console.error(
          `[werkflow-test] cleanup failed for ${manifest.runKey}: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }
    if (failedRunKeys.length > 0) {
      throw new Error(`Cleanup failed for run(s): ${failedRunKeys.join(', ')}`);
    }
    return;
  }
  if (command === 'classify') {
    const [runKey, classification, rootCause, prevention] = process.argv.slice(3);
    if (!runKey || !classification || !rootCause || !prevention) {
      throw new Error('Usage: ... classify <run-key> <product|harness|environment|transient> <root-cause> <prevention>');
    }
    if (!isIncidentClass(classification)) {
      throw new Error(`Unknown incident class: ${classification}`);
    }
    updateRunManifest(runKey, {
      classification,
      classifiedAt: new Date().toISOString(),
      rootCause,
      prevention,
    });
    console.log(`[werkflow-test] classified ${runKey} as ${classification}`);
    return;
  }
  throw new Error(`Unknown command: ${command}`);
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
