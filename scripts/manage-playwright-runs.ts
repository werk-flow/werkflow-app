import { INCIDENT_CLASSES, PLAYWRIGHT_SUITES, PLAYWRIGHT_TARGETS, type IncidentClass, type PlaywrightSuite, type PlaywrightTarget } from '../lib/testing/run-policy';
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
import { campaignSummary, closeCampaign, grantReferenceRunKey, issueRerunGrant, readCampaigns } from '../lib/testing/run-campaign';
import { currentBackendProvenance } from '../tests/golden/support/run-state';
import { calculateCandidateFingerprint } from '../lib/testing/candidate-identity';
import { validateDiagnosticProvenance } from '../lib/testing/test-evidence';

function printRuns(): void {
  for (const line of formatRunInventory(listRunManifests())) console.log(line);
  for (const campaign of readCampaigns()) {
    const summary = campaignSummary(campaign, listRunManifests());
    console.log(`Campaign ${campaign.id} (${campaign.closedAt ? 'closed' : 'active'}): ${summary.fullAttempts} complete attempts / ${summary.fullMinutes.toFixed(1)} min; ${summary.totalMinutes.toFixed(1)} min total, ${summary.diagnosticMinutes.toFixed(1)} min diagnostic`);
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
  const world = readRetainedWorldState(manifest, worldPath);
  if (manifest.backendProvenance) {
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
    console.log(`[werkflow-test] recovered ${runKey} as interrupted; preserved ${recovered.passed} passes and ${recovered.failed} failures. Campaign cost remains anchored to the first recovery at ${recovered.interruptionRecovery?.recoveredAt}. ${recovered.retainedAt && !recovered.cleanedAt ? 'Owned world retained; inspect and clean explicitly.' : 'No unclean owned world recorded.'}`);
    return;
  }
  if (command === 'campaign-extend') {
    const [campaignId, referenceRunKey, reason, ...boundary] = process.argv.slice(3);
    if (!campaignId || !referenceRunKey || !reason) throw new Error('Usage: test:runs campaign-extend <campaign-id> <latest-run-key> "<investigated reason>"');
    const reference = readRunManifest(referenceRunKey);
    if (boundary.length && (boundary.length !== 4 || boundary[0] !== '--suite' || !PLAYWRIGHT_SUITES.includes(boundary[1] as PlaywrightSuite) || boundary[2] !== '--target' || !PLAYWRIGHT_TARGETS.includes(boundary[3] as PlaywrightTarget))) throw new Error('A baseline grant requires --suite <golden|audit|canary> --target <local|cloud>.');
    const suite = (boundary[1] as PlaywrightSuite | undefined) ?? reference.suite;
    const target = (boundary[3] as PlaywrightTarget | undefined) ?? reference.target ?? 'cloud';
    const lane = boundary.length ? 'certification' : reference.lane;
    if (suite === 'canary' && target !== 'cloud') throw new Error('Canary grants require the cloud target.');
    if (reference.campaignId !== campaignId || !reference.completedAt) throw new Error('The reference must be a completed run in this campaign.');
    if (grantReferenceRunKey({ attempts: listRunManifests(), campaignId, suite, target, lane }) !== referenceRunKey) throw new Error('Reference the latest completed run for this boundary, or the latest completed campaign run before its first baseline.');
    if (!['passed', 'diagnostic_passed'].includes(reference.status) && (!reference.classification || !reference.classifiedAt)) throw new Error('Classify the reference failure before issuing a rerun grant.');
    const id = issueRerunGrant({ campaignId, referenceRunKey, suite, target, candidateFingerprint: calculateCandidateFingerprint(resolve(import.meta.dir, '..')), reason });
    console.log(`Single-use rerun grant ${id}; pass --rerun-grant ${id} on the reviewed retry. Classification and exact focused proof requirements still apply.`);
    return;
  }
  if (command === 'campaign-close') {
    const id = process.argv[3];
    if (!id) throw new Error('Usage: test:runs campaign-close <campaign-id>');
    const runs = listRunManifests().filter((manifest) => manifest.campaignId === id);
    if (runs.some((manifest) => !manifest.completedAt || (manifest.retainedAt && !manifest.cleanedAt))) throw new Error('Finish every run and clean retained worlds before closing a campaign.');
    const latest = new Map<string, (typeof runs)[number]>();
    for (const run of runs.filter((manifest) => manifest.lane === 'certification')) latest.set(`${run.suite}:${run.target}`, run);
    if ([...latest.values()].some((run) => run.status !== 'passed')) throw new Error('A campaign with unresolved failed certification cannot be closed to reset its budget. Diagnose and use an explicit single-run extension.');
    closeCampaign(id);
    console.log(`Closed campaign ${id}. The next browser run starts a new campaign.`);
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
  if ((process.argv[2] ?? 'list') === 'list') await main();
  else await withWorkspaceTestLock({ operation: `Playwright run management ${process.argv[2]}` }, main);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
