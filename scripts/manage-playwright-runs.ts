import { createClient } from '@supabase/supabase-js';
import type { Database } from '../lib/supabase/database.types';
import { testSupabaseClientOptions } from '../tests/golden/support/client-options';
import { requireEnv } from '../tests/golden/support/env';
import { assertLocalCleanupRelocation, assertRelocatedWorldOwnership } from '../lib/testing/local-cleanup-relocation';
import { INCIDENT_CLASSES, type IncidentClass } from '../lib/testing/run-policy';
import { formatRunInventory } from '../lib/testing/run-inventory';
import { loadEnvLocal } from '../tests/golden/support/env';
import {
  listRunManifests,
  markWorldCleaned,
  readRunManifest,
  recoverInterruptedRun,
  runDirectory,
  updateRunManifest,
} from '../tests/golden/support/run-state';
import { destroyTestWorld } from '../tests/golden/support/seed';
import { existsSync } from 'node:fs';
import { readRetainedWorldState } from '../lib/testing/archive-state';
import { resolve } from 'node:path';
import { withWorkspaceTestLock } from '../lib/testing/workspace-test-lock';
import { currentBackendProvenance } from '../tests/golden/support/run-state';
import { runSessionCommand, withLocalStackLease } from '../lib/testing/local-stack-lease';
import { localMailpitUrl } from '../lib/testing/local-mailpit';
import { validateDiagnosticProvenance } from '../lib/testing/test-evidence';
import { backendIdentity } from '../lib/testing/proof-environment';
import { citedRunKeys, prunableArchiveBytes, prunableRunKeys, PRUNABLE_RUN_DIRECTORIES } from '../lib/testing/run-retention';
import { readPerformanceBaselines } from '../lib/testing/performance-baselines';
import { readdirSync, readFileSync, rmSync } from 'node:fs';

function printRuns(): void {
  for (const line of formatRunInventory(listRunManifests())) console.log(line);
}

function isIncidentClass(value: string): value is IncidentClass {
  return (INCIDENT_CLASSES as readonly string[]).includes(value);
}

async function cleanupRun(runKey: string, relocationReason?: string): Promise<void> {
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
  // leave the real rows behind; refuse instead. The identity ignores the WSL
  // address; the exact-origin provenance check below still governs replay.
  const currentProjectRef = backendIdentity(process.env.NEXT_PUBLIC_SUPABASE_URL, resolve(import.meta.dir, '..'));
  if (!relocationReason && manifest.projectRef && manifest.projectRef !== currentProjectRef) {
    throw new Error(
      `Run ${runKey} was recorded against project ${manifest.projectRef}, but .env.local points at ${currentProjectRef}. Switch env (bun run env:local / env:dev) before cleanup.`
    );
  }
  const world = readRetainedWorldState(manifest, worldPath);
  if (relocationReason) {
    const requested = currentBackendProvenance(manifest.suite);
    requested.target = manifest.target ?? 'cloud';
    assertLocalCleanupRelocation(manifest.backendProvenance, requested);
    // A verified cleanup may have removed one organization before another resource failed.
    // Resume only against the exact backend previously verified for that cleanup.
    if (!manifest.cleanupRelocation || validateDiagnosticProvenance(manifest.cleanupRelocation.backend, requested).length) {
    const admin = createClient<Database>(requireEnv('NEXT_PUBLIC_SUPABASE_URL'), requireEnv('SUPABASE_SECRET_KEY'), testSupabaseClientOptions);
    const { data, error } = await admin.from('organizations').select('id,name,admin_id').in('id', [world.orgId, world.outsider.orgId]);
    if (error) throw new Error('Could not verify relocated test organization ownership.');
    assertRelocatedWorldOwnership(world, data ?? []);
    updateRunManifest(runKey, { cleanupRelocation: { verifiedAt: new Date().toISOString(), reason: relocationReason, backend: requested } });
    }
  } else if (manifest.backendProvenance) {
    const requested = currentBackendProvenance(manifest.suite);
    requested.target = manifest.target ?? 'cloud';
    const problems = validateDiagnosticProvenance(manifest.backendProvenance, requested);
    if (problems.length) throw new Error(problems.join('\n'));
  }
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
  if (command === 'recover-interrupted') {
    const [runKey, reason, ...extra] = process.argv.slice(3);
    if (!runKey || !reason || extra.length) throw new Error('Usage: test:runs recover-interrupted <run-key> "<observed interruption reason>"');
    const recovered = recoverInterruptedRun(runKey, reason);
    console.log(`[werkflow-test] recovered ${runKey} as interrupted; preserved ${recovered.passed} passes and ${recovered.failed} failures. Run cost remains anchored to the first recovery at ${recovered.interruptionRecovery?.recoveredAt}. ${recovered.retainedAt && !recovered.cleanedAt ? 'Owned world retained; inspect and clean explicitly.' : 'No unclean owned world recorded.'}`);
    return;
  }
  if (command === 'prune') {
    const planOnly = process.argv[3] === '--plan';
    if (process.argv.length > (planOnly ? 4 : 3)) throw new Error('Usage: test:runs prune [--plan]');
    const repositoryRoot = resolve(import.meta.dir, '..');
    const archiveRoot = resolve(repositoryRoot, '.agent-logs/playwright-runs');
    const verificationRoot = resolve(repositoryRoot, '.agent-logs/verification');
    const reports = existsSync(verificationRoot) ? readdirSync(verificationRoot).flatMap((directory) => {
      const file = resolve(verificationRoot, directory, 'report.json');
      return existsSync(file) ? [JSON.parse(readFileSync(file, 'utf8')) as { target: string; results: { groupId: string; status: string; startedAt: string; runKey: string | null }[] }] : [];
    }) : [];
    const cited = citedRunKeys({ reports, baselineRunKeys: readPerformanceBaselines().baselines.flatMap((baseline) => baseline.source.runKeys) });
    const runKeys = prunableRunKeys({ runs: listRunManifests(), cited, now: Date.now() });
    const bytes = prunableArchiveBytes(archiveRoot, runKeys);
    console.log(`[werkflow-test] ${runKeys.length} runs hold ${(bytes / 1024 ** 3).toFixed(2)} GB of prunable traces, reports and active state; ${cited.size} cited runs and every retained or unfinished run are kept.`);
    if (planOnly) return;
    const prunedAt = new Date().toISOString();
    for (const runKey of runKeys) {
      for (const name of PRUNABLE_RUN_DIRECTORIES) rmSync(resolve(runDirectory(runKey), name), { recursive: true, force: true });
      updateRunManifest(runKey, { prunedAt });
    }
    console.log(`[werkflow-test] pruned ${runKeys.length} runs; manifests, logs, latency and workload archives and archived state stay.`);
    return;
  }
  if (command === 'cleanup-local-relocated') {
    const [runKey, reason, ...extra] = process.argv.slice(3);
    if (!runKey || !reason?.trim() || extra.length) throw new Error('Usage: test:runs cleanup-local-relocated <run-key> "<observed local address change>"');
    await cleanupRun(runKey, reason);
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
  const command = process.argv[2] ?? 'list';
  loadEnvLocal();
  const localCleanup = ['cleanup', 'cleanup-all', 'cleanup-local-relocated'].includes(command)
    && localMailpitUrl(requireEnv('NEXT_PUBLIC_SUPABASE_URL')) !== null;
  if (localCleanup && process.env.WERKFLOW_CLEANUP_STACK_LEASE !== 'owned') {
    // The child owns cleanup/lock; cancellation stops it before releasing WSL.
    process.exitCode = await withLocalStackLease(true, (signal) => runSessionCommand(
      [process.execPath, import.meta.filename, ...process.argv.slice(2)],
      { signal, env: { ...process.env, WERKFLOW_CLEANUP_STACK_LEASE: 'owned' } },
    ), { signal: AbortSignal.timeout(180_000) });
  } else if (command === 'list') await main();
  else await withWorkspaceTestLock({ operation: `Playwright run management ${command}` }, main);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
