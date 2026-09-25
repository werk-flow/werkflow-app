import { createWriteStream, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseRunnerArguments } from '../lib/testing/runner-arguments';
import { withWorkspaceTestLock } from '../lib/testing/workspace-test-lock';
import { resolveTestPrerequisites, validateDeclaredPrerequisites, validateDiagnosticProvenance, validateExecutedSelection } from '../lib/testing/test-evidence';
import { calculateCandidateFingerprint } from '../lib/testing/candidate-identity';
import { runSessionCommand, withLocalStackLease } from '../lib/testing/local-stack-lease';
import { resolveBusinessDate } from '../lib/testing/business-date';
import { runWithLogCleanup } from '../lib/testing/command-log';
import { getTestGroups, getGroupExecutionFiles, getGroupTimingRequirements } from '../lib/testing/test-groups';
import { checkLatencyEvidence } from '../lib/testing/latency-evidence';
import { recoveredEnvironmentRuns } from '../lib/testing/group-recovery';
import { captureInputSnapshot } from '../lib/testing/group-evidence';
import { createGroupQualification, directGroupRetryProblem } from '../lib/testing/group-qualification';
import { archiveSizeProblem, prunableArchiveBytes } from '../lib/testing/run-retention';
import { discoverPlaywrightSelection, selectionForFiles, SUITE_CONFIG } from '../lib/testing/playwright-discovery';
import { preparedGroupRun, readPreparedPlan } from '../lib/testing/prepared-plan';

import {
  PLAYWRIGHT_TARGETS,
  RUNNABLE_LANES,
  defaultTargetForSuite,
  evaluateFocusedIterationRerun,
  validateFocusedSelection,
  validateRunRequest,
  type PlaywrightLane,
  type PlaywrightSuite,
  type PlaywrightTarget,
} from '../lib/testing/run-policy';
import { runPlaywrightPreflight } from './playwright-preflight';
import { loadEnvLocal } from '../tests/golden/support/env';
import {
  archiveRunOutputs,
  currentBackendProvenance,
  configureRunEnvironment,
  createRunKey,
  createRunManifest,
  listRunManifests,
  manifestPath,
  readRunManifest,
  runDirectory,
  updateRunManifest,
} from '../tests/golden/support/run-state';


function focusedIterationAttemptsSinceLastPass(input: {
  suite: PlaywrightSuite;
  target: PlaywrightTarget;
  selectedTestIds: readonly string[];
}) {
  const attempts = listRunManifests().filter(
    (manifest) =>
      manifest.lane === 'iteration' &&
      manifest.suite === input.suite &&
      (manifest.target ?? 'cloud') === input.target &&
      JSON.stringify([...(manifest.selectedTestIds ?? [])].sort()) === JSON.stringify([...input.selectedTestIds].sort()) &&
      [
        'passed',
        'failed',
        'failed_retained',
        'timedout',
        'interrupted',
      ].includes(manifest.status),
  );
  const lastPassedIndex = attempts.findLastIndex(
    (manifest) => manifest.status === 'passed',
  );
  return attempts.slice(lastPassedIndex + 1).map((manifest) => ({
    runKey: manifest.runKey,
    status: 'failed' as const,
    classification: manifest.classification,
    classifiedAt: manifest.classifiedAt,
  }));
}

async function main(signal: AbortSignal): Promise<number> {
  signal.throwIfAborted();
  loadEnvLocal();
  if (process.env.GOLDEN_BASE_URL && process.env.GOLDEN_BASE_URL !== 'http://localhost:3000') throw new Error('Browser runs require http://localhost:3000. Remove the GOLDEN_BASE_URL override before continuing.');
  const lane = process.argv[2] as PlaywrightLane | undefined;
  const suite = process.argv[3] as PlaywrightSuite | undefined;
  if (!lane || !(RUNNABLE_LANES as readonly string[]).includes(lane)) {
    throw new Error(
      'Usage: bun scripts/run-playwright.ts <group|iteration|diagnostic> <golden|audit|canary> [--target local|cloud] [--group <id> | --grep <pattern>]',
    );
  }
  if (!suite || !['golden', 'audit', 'canary'].includes(suite)) {
    throw new Error('Suite must be golden, audit, or canary.');
  }

  const argumentsByName = parseRunnerArguments(lane, process.argv.slice(4));
  const repositoryRoot = resolve(import.meta.dir, '..');
  const groupId = argumentsByName['--group'];
  const groups = groupId ? getTestGroups(repositoryRoot) : [];
  const group = groupId ? groups.find((entry) => entry.id === groupId) : undefined;
  if (groupId && (!group || group.kind !== suite)) throw new Error(`Group ${groupId} does not belong to suite ${suite}.`);
  // A verification run prepared the shared work (preflight, discovery, qualification, the run
  // identity) once for every group it starts; a direct lane does that work here.
  const preparedPlan = lane === 'group' ? readPreparedPlan() : null;
  if (!preparedPlan) {
    const archiveProblem = archiveSizeProblem(prunableArchiveBytes(resolve(repositoryRoot, '.agent-logs/playwright-runs')));
    if (archiveProblem) throw new Error(archiveProblem);
  }
  const groupFiles = group ? getGroupExecutionFiles(group, groups) : [];
  if (groupId) process.env.WERKFLOW_TEST_GROUP = groupId;
  else delete process.env.WERKFLOW_TEST_GROUP;
  // Baseline validation runs after Playwright exits. Keep traces even when its
  // assertions pass, otherwise a later comparison failure loses its diagnosis.
  process.env.WERKFLOW_RETAIN_PERFORMANCE_TRACE =
    lane === 'diagnostic' || Boolean(group?.timing.requiredScenarios?.length) ? '1' : '0';
  const reuseRunKey = argumentsByName['--reuse-run'] ?? null;
  const targetArgument = argumentsByName['--target'] ?? null;
  if (
    targetArgument &&
    !PLAYWRIGHT_TARGETS.includes(targetArgument as PlaywrightTarget)
  ) {
    throw new Error(
      `--target must be one of ${PLAYWRIGHT_TARGETS.join(', ')}.`,
    );
  }
  const target =
    (targetArgument as PlaywrightTarget | null) ?? defaultTargetForSuite(suite);
  const preparedRun = preparedPlan && group ? preparedGroupRun(preparedPlan, { groupId: group.id, suite, target }) : null;
  const grep = argumentsByName['--grep'] ?? null;
  const playwrightArgs = group ? groupFiles.map((file) => file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$') : grep ? ['--grep', grep] : [];
  const requestErrors = validateRunRequest({
    lane,
    suite,
    target,
    grep,
    reuseRunKey,
  });
  if (requestErrors.length > 0) throw new Error(requestErrors.join('\n'));

  process.env.WERKFLOW_TEST_SUITE = suite;
  process.env.WERKFLOW_TEST_TARGET = target;
  process.env.WERKFLOW_TEST_LANE = lane;
  const retainedSource = reuseRunKey ? readRunManifest(reuseRunKey) : null;
  if (lane === 'diagnostic' && retainedSource) {
    // A replay on another build still explains a failure, but only a replay on
    // the failed run's build can count as environment recovery (group-recovery.ts).
    const buildIdPath = resolve(import.meta.dir, '../.next/BUILD_ID');
    const servedBuildId = existsSync(buildIdPath) ? readFileSync(buildIdPath, 'utf8').trim() : null;
    if (!retainedSource.buildId || retainedSource.buildId !== servedBuildId) {
      console.warn(`[werkflow-test] ${reuseRunKey} was recorded on build ${retainedSource.buildId ?? 'unknown'}; the served build is ${servedBuildId ?? 'unknown'}. This diagnostic cannot count as environment recovery for that run.`);
    }
  }
  if (retainedSource) {
    const errors = validateDiagnosticProvenance(retainedSource.backendProvenance, currentBackendProvenance(suite));
    if (!retainedSource.retainedAt || retainedSource.cleanedAt) errors.push('Diagnostic source has no live retained world.');
    if (!retainedSource.businessDate) errors.push('Diagnostic source has no recorded business date.');
    if (errors.length) throw new Error(errors.join('\n'));
  }
  const businessDate = resolveBusinessDate(retainedSource?.businessDate);
  process.env.WERKFLOW_TEST_BUSINESS_DATE = businessDate;

  const fullSelection = preparedRun?.selection ?? discoverPlaywrightSelection({ suite, playwrightArgs: [], repositoryRoot, signal });
  if (!fullSelection.total) throw new Error(`The ${suite} suite contains no tests. Refusing to create a world.`);
  // A group's selection is its registered files; only a grep needs Playwright's own filtering.
  const requestedSelection = group
    ? selectionForFiles(fullSelection, groupFiles)
    : grep ? discoverPlaywrightSelection({ suite, playwrightArgs, repositoryRoot, signal }) : fullSelection;
  const declaredTests = resolveTestPrerequisites(fullSelection.tests);
  const selectionErrors = [
    ...(lane === 'iteration' || lane === 'group' ? validateDeclaredPrerequisites({ selectedTestIds: requestedSelection.titles, tests: declaredTests }) : []),
    ...validateFocusedSelection({
      lane,
      suite,
      selectedTestCount: requestedSelection.total,
      fullSuiteTestCount: fullSelection.total,
    }),
  ];
  if (selectionErrors.length > 0) throw new Error(selectionErrors.join('\n'));
  if (!requestedSelection.total || (group && requestedSelection.tests.some((test) => !groupFiles.includes(test.file)))) throw new Error('Group discovery did not match its registered files.');

  const candidateFingerprint = calculateCandidateFingerprint(repositoryRoot);
  let groupFingerprint: string | undefined = preparedRun?.fingerprint;
  if (group && !preparedRun) {
    const manifests = listRunManifests();
    const snapshot = captureInputSnapshot(repositoryRoot);
    groupFingerprint = createGroupQualification(repositoryRoot, groups, snapshot).qualify(group).fingerprint;
    const problem = directGroupRetryProblem({
      groupId: group.id, target, fingerprint: groupFingerprint, runs: manifests,
      recoveredRunKeys: recoveredEnvironmentRuns(manifests),
    });
    if (problem) throw new Error(problem);
  }
  if (lane === 'iteration' && grep) {
    const policy = evaluateFocusedIterationRerun({
      attemptsSinceLastPass: focusedIterationAttemptsSinceLastPass({
        suite,
        target,
        selectedTestIds: requestedSelection.titles,
      }),
    });
    if (!policy.allowed)
      throw new Error(policy.reason ?? 'Focused iteration rerun blocked.');
  }

  if (!preparedRun) await runPlaywrightPreflight({ lane, target, repositoryRoot });
  signal.throwIfAborted();
  const runKey = preparedRun?.runKey ?? createRunKey();
  process.env.WERKFLOW_RUN_KEY = runKey;
  process.env.WERKFLOW_TEST_LANE = lane;
  process.env.WERKFLOW_TEST_SUITE = suite;
  process.env.WERKFLOW_TEST_TARGET = target;
  process.env.WERKFLOW_TEST_GREP = grep ?? '';
  if (reuseRunKey) process.env.WERKFLOW_REUSE_RUN_KEY = reuseRunKey;
  else delete process.env.WERKFLOW_REUSE_RUN_KEY;
  process.env.WERKFLOW_QUIET_REPORTER = '1';
  const commandArgs = [
    'x',
    'playwright',
    'test',
    ...SUITE_CONFIG[suite],
    ...playwrightArgs,
  ];
  process.env.WERKFLOW_TEST_COMMAND = `bun ${commandArgs.join(' ')}`;
  configureRunEnvironment(suite);
  createRunManifest({
    command: process.env.WERKFLOW_TEST_COMMAND,
    grep,
    selectedTestIds: requestedSelection.titles,
    candidateFingerprint,
    ...(groupFingerprint !== undefined ? { groupFingerprint } : {}),
  });

  const logPath = resolve(runDirectory(runKey), 'runner.log');
  const log = createWriteStream(logPath, { flags: 'a' });
  log.on('error', () => undefined);
  console.log(
    `[werkflow-test] started ${lane} ${suite} run ${runKey} (target ${target}); output: ${logPath}`,
  );
  const progress = setInterval(() => {
    try {
      const current = readRunManifest(runKey);
      console.log(`[werkflow-test] ${current.passed}/${current.total} passed; ${(Math.max(0, Date.now() - Date.parse(current.startedAt)) / 60_000).toFixed(1)} min; ${current.currentTestId ?? 'setup or teardown'}`);
    } catch { /* Manifest publication can race the first status tick. */ }
  }, 60_000);
  const exitCode = await runWithLogCleanup({
    command: () => runSessionCommand([process.execPath, ...commandArgs], {
      signal, cwd: repositoryRoot, env: process.env,
      onStdout: (chunk) => { log.write(chunk); },
      onStderr: (chunk) => { log.write(chunk); },
    }),
    closeLog: async () => {
      clearInterval(progress);
      await new Promise<void>((resolveLog, rejectLog) => {
        log.end((error?: Error | null) => { if (error) rejectLog(error); else resolveLog(); });
      });
    },
    reportSecondaryFailure: (error) => { console.error(`[werkflow-test] Log cleanup also failed: ${error instanceof Error ? error.message : String(error)}`); },
  });

  let manifest;
  try {
    manifest = readRunManifest(runKey);
  } catch {
    throw new Error(
      `Playwright exited ${exitCode} without manifest ${manifestPath(runKey)}.`,
    );
  }
  const timing = group ? getGroupTimingRequirements(group, groups, repositoryRoot) : { requireFreshness: requestedSelection.titles.some((title) => title.includes('@FRESHNESS')), requireReadiness: requestedSelection.titles.some((title) => title.includes('@READINESS')) };
  const latencyEvidence = checkLatencyEvidence({ directory: runDirectory(runKey), ...timing });
  writeFileSync(resolve(runDirectory(runKey), 'latency-summary.json'), JSON.stringify(latencyEvidence, null, 2));
  for (const measured of latencyEvidence.comparisons) console.log(`[werkflow-test] ${measured.scenarioId} ${measured.basis === "median" ? `median of ${measured.samples.length} samples` : `sample ${measured.sample}`}: correctness=${measured.correctness}; responsiveness=${measured.responsiveness}; baseline=${measured.comparison.status}`);
  if (['passed', 'diagnostic_passed'].includes(manifest.status)) {
    const evidenceErrors = validateExecutedSelection({ selectedTestIds: requestedSelection.titles, outcomes: manifest.outcomes ?? [], candidateBefore: candidateFingerprint, candidateAfter: calculateCandidateFingerprint(repositoryRoot) });
    evidenceErrors.push(...latencyEvidence.problems);
    if (evidenceErrors.length) manifest = updateRunManifest(runKey, (current) => ({ status: 'failed', failures: [...current.failures, { title: 'Execution evidence', file: null, message: evidenceErrors.join('\n') }] }));
  }
  if (['starting', 'running'].includes(manifest.status) || (exitCode !== 0 && ['passed', 'diagnostic_passed'].includes(manifest.status))) {
    recordRunnerFailure(new Error(`Playwright exited with code ${exitCode} and run status ${manifest.status}.`));
    manifest = readRunManifest(runKey);
  }
  console.log(
    `[werkflow-test] ${manifest.status}; ${manifest.passed}/${manifest.total} passed; run ${runKey}`,
  );
  if (manifest.failures[0])
    console.log(`[werkflow-test] failure: ${manifest.failures[0].message}`);
  return ['passed', 'diagnostic_passed'].includes(manifest.status)
    ? exitCode
    : 1;
}

function recordRunnerFailure(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  const runKey = process.env.WERKFLOW_RUN_KEY;
  if (runKey && existsSync(manifestPath(runKey))) {
    try {
      updateRunManifest(runKey, (current) => ({
        status: current.world && !current.cleanedAt ? 'failed_retained' : 'failed',
        retainedAt: current.world && !current.cleanedAt ? current.retainedAt ?? new Date().toISOString() : current.retainedAt,
        completedAt: new Date().toISOString(),
        failures: [
          ...current.failures,
          { title: 'Test runner', file: current.currentTestId?.split(' › ')[0] ?? 'scripts/run-playwright.ts', ...(current.currentTestId ? { testId: current.currentTestId } : {}), message },
        ],
      }));
      archiveRunOutputs(runKey);
    } catch (manifestError) {
      console.error(
        `Could not record runner failure: ${String(manifestError)}`,
      );
    }
  }
}

try {
  const requestedOptions = parseRunnerArguments(process.argv[2] as PlaywrightLane, process.argv.slice(4));
  const localTarget = process.argv[3] !== 'canary' && requestedOptions['--target'] !== 'cloud';
  process.exitCode = await withWorkspaceTestLock({ operation: `Playwright ${process.argv.slice(2, 4).join(' ')}` }, async () => {
    try { return await withLocalStackLease(localTarget, main); }
    catch (error) { recordRunnerFailure(error); throw error; }
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
