import { INCIDENT_CLASSES, type IncidentClass } from '../lib/testing/runner/run-policy';
import { formatRunInventory } from '../lib/testing/runs/run-inventory';
import { loadEnvLocal } from '../tests/golden/support/env';
import { localMailpitUrl } from '../lib/testing/local-mailpit';
import { withStackLock } from '../lib/testing/runner/stack-lock';
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
import { readRetainedWorldState } from '../lib/testing/runs/archive-state';
import { resolve } from 'node:path';
import { withWorkspaceTestLock } from '../lib/testing/runner/workspace-test-lock';
import { currentBackendProvenance } from '../tests/golden/support/run-state';
import { validateDiagnosticProvenance } from '../lib/testing/evidence/test-evidence';
import { backendIdentity } from '../lib/testing/evidence/proof-environment';
import { pruneRunArchive } from '../lib/testing/runs/run-retention';
import { recordGroupDiagnosis } from '../lib/testing/evidence/group-diagnosis';
import { classificationProblem } from '../lib/testing/evidence/browser-group-evidence';
import { repositoryMechanismIndex, tierClaimProblem } from '../lib/testing/runs/incident-mechanisms';
import { readFileSync } from 'node:fs';
import { incidentPreventionProblem, recordsIncident } from '../lib/testing/runs/incident-record';

function printRuns(): void {
  for (const line of formatRunInventory(listRunManifests())) console.log(line);
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
  // leave the real rows behind; refuse instead. The exact-origin provenance
  // check below still governs replay.
  const currentProjectRef = backendIdentity(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    resolve(import.meta.dir, '..'),
  );
  if (manifest.projectRef && manifest.projectRef !== currentProjectRef) {
    throw new Error(
      `Run ${runKey} was recorded against project ${manifest.projectRef}, but .env.local points at ${currentProjectRef}. Switch env (bun run env:local / env:dev) before cleanup.`,
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

/** An incident entry's prevention names its tier and, for Tier 1 or 2, an existing mechanism. */
function incidentPrevention(prevention: string): string | null {
  return (
    incidentPreventionProblem(prevention) ??
    tierClaimProblem(prevention, repositoryMechanismIndex(resolve(import.meta.dir, '..')))
  );
}

const LOG_TAIL_LINES = 20;

/**
 * Classifies a failed attempt of a group without a browser run: `<group-id>` names its latest
 * attempt, `<group-id>@<report-id>` the failed attempt in that report, also after a later pass.
 * It prints the end of the attempt's log and keeps the diagnosis in the report's `diagnoses.json`.
 */
function classifyGroupAttempt(
  target: string,
  classification: IncidentClass,
  rootCause: string,
  prevention: string,
): void {
  if (classification === 'accepted-change')
    throw new Error('accepted-change applies to a failed audit:visual browser run only; give its run key.');
  const [groupId = '', reportId, ...extra] = target.split('@');
  if (extra.length)
    throw new Error(`Give the attempt as <group-id> or <group-id>@<report-id>, not ${target}.`);
  const preventionProblem = recordsIncident({ lane: 'group', groupId }, classification)
    ? incidentPrevention(prevention)
    : null;
  if (preventionProblem) throw new Error(preventionProblem);
  const { attempt, diagnosis } = recordGroupDiagnosis(
    resolve(import.meta.dir, '../.agent-logs/verification'),
    {
      groupId,
      ...(reportId === undefined ? {} : { reportId }),
      classification,
      rootCause,
      prevention,
      now: new Date(),
    },
  );
  const logPath = attempt.result.logPath;
  const logLines =
    logPath && existsSync(logPath)
      ? readFileSync(logPath, 'utf8')
          .split(/\r?\n/)
          .filter((line) => line.trim())
      : [];
  console.log(
    logLines.length
      ? `[werkflow-test] last lines of ${logPath}:\n${logLines.slice(-LOG_TAIL_LINES).join('\n')}`
      : `[werkflow-test] the attempt's log ${logPath ?? '(none recorded)'} is gone; its recorded reason stays the evidence.`,
  );
  console.log(
    `[werkflow-test] classified ${groupId} attempt ${diagnosis.startedAt} of report ${attempt.reportId} as ${classification}. ${
      classification === 'environment'
        ? 'One retry on unchanged inputs is allowed; a second failure on them needs a change.'
        : 'The group runs again once its inputs change.'
    }`,
  );
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
    if (!runKey || !reason || extra.length)
      throw new Error('Usage: test:runs recover-interrupted <run-key> "<observed interruption reason>"');
    const recovered = recoverInterruptedRun(runKey, reason);
    console.log(
      `[werkflow-test] recovered ${runKey} as interrupted; preserved ${recovered.passed} passes and ${recovered.failed} failures. Run cost remains anchored to the first recovery at ${recovered.interruptionRecovery?.recoveredAt}. ${recovered.retainedAt && !recovered.cleanedAt ? 'Owned world retained; inspect and clean explicitly.' : 'No unclean owned world recorded.'}`,
    );
    return;
  }
  if (command === 'prune') {
    const planOnly = process.argv[3] === '--plan';
    if (process.argv.length > (planOnly ? 4 : 3)) throw new Error('Usage: test:runs prune [--plan]');
    console.log(`[werkflow-test] ${pruneRunArchive(planOnly ? 'plan' : 'prune')}`);
    return;
  }
  if (command === 'cleanup') {
    const runKey = process.argv[3];
    if (!runKey) throw new Error('Usage: ... cleanup <run-key>');
    await cleanupRun(runKey);
    return;
  }
  if (command === 'cleanup-all') {
    const retained = listRunManifests().filter((manifest) => manifest.retainedAt && !manifest.cleanedAt);
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
          }`,
        );
      }
    }
    if (failedRunKeys.length > 0) {
      throw new Error(`Cleanup failed for run(s): ${failedRunKeys.join(', ')}`);
    }
    return;
  }
  if (command === 'classify') {
    const [runKey, classification, rootCause, prevention, ...extra] = process.argv.slice(3);
    if (!runKey || !classification || !rootCause?.trim() || !prevention?.trim() || extra.length) {
      throw new Error(
        `Usage: ... classify <run-key|group-id|group-id@report-id> <${INCIDENT_CLASSES.join('|')}> "<root-cause>" "<prevention>"`,
      );
    }
    if (!isIncidentClass(classification)) {
      throw new Error(`Unknown incident class: ${classification}`);
    }
    // A run key never holds a colon and a group id always does: a group without a browser run
    // (static, unit, SQL, component) records the diagnosis of a failed attempt.
    if (runKey.includes(':')) {
      classifyGroupAttempt(runKey, classification, rootCause, prevention);
      return;
    }
    const run = readRunManifest(runKey);
    const refusal = classificationProblem({ classification, run, runs: listRunManifests() });
    if (refusal) throw new Error(refusal);
    // The run manifest keeps the diagnosis beside the run's report (testing.md, "Failures").
    const preventionProblem = recordsIncident(run, classification) ? incidentPrevention(prevention) : null;
    if (preventionProblem) throw new Error(preventionProblem);
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
  const operation = `Playwright run management ${command}`;
  // Cleanup deletes worlds through the shared local gateway, which a measuring group counts.
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const local = supabaseUrl ? localMailpitUrl(supabaseUrl) !== null : false;
  if (command === 'list') await main();
  else
    await withWorkspaceTestLock({ operation }, () =>
      ['cleanup', 'cleanup-all'].includes(command) && local
        ? withStackLock({ mode: 'shared', operation, repositoryRoot: resolve(import.meta.dir, '..') }, main)
        : main(),
    );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
