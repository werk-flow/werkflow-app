import { execFileSync, spawnSync } from 'node:child_process';
import { createWriteStream, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseRunnerArguments } from '../lib/testing/runner-arguments';
import { activeCampaign, campaignBudgetProblem, campaignSummary, consumeRerunGrant, grantReferenceRunKey, validatedRerunGrant } from '../lib/testing/run-campaign';
import { withWorkspaceTestLock } from '../lib/testing/workspace-test-lock';
import { resolveTestPrerequisites, validateDeclaredPrerequisites, validateDiagnosticProvenance, validateExecutedSelection } from '../lib/testing/test-evidence';
import { calculateCandidateFingerprint } from '../lib/testing/candidate-identity';
import { runSessionCommand, withLocalStackLease } from '../lib/testing/local-stack-lease';
import { resolveBusinessDate } from '../lib/testing/business-date';
import { runWithLogCleanup } from '../lib/testing/command-log';
import { z } from 'zod';
import { getTestGroups, getGroupExecutionFiles, getGroupTimingRequirements } from '../lib/testing/test-groups';
import { checkLatencyEvidence } from '../lib/testing/latency-evidence';
import { recoveredEnvironmentRuns } from '../lib/testing/group-recovery';
import { captureInputSnapshot } from '../lib/testing/group-evidence';
import { calculateBuildInputs } from '../lib/testing/build-identity';
import { createGroupQualification, directGroupRetryProblem } from '../lib/testing/group-qualification';

import {
  PLAYWRIGHT_TARGETS,
  defaultTargetForSuite,
  evaluateFocusedIterationRerun,
  evaluateFullCertificationRerun,
  evaluateRequiredFocusedProofs,
  focusedProofTokenForFailure,
  requiredFocusedProofsForChangedFiles,
  validateFocusedSelection,
  validateRunRequest,
  type PlaywrightLane,
  type PlaywrightSuite,
  type PlaywrightTarget,
} from '../lib/testing/run-policy';
import { getSpawnFailureDetail } from '../lib/testing/spawn-result';
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

const SUITE_CONFIG: Record<PlaywrightSuite, string[]> = {
  golden: [],
  audit: ['--config', 'playwright.audit.config.ts'],
  canary: ['--config', 'playwright.canary.config.ts'],
};
const discoveredTestSchema = z.object({ id: z.string(), file: z.string(), title: z.string(), annotations: z.array(z.object({ type: z.string(), description: z.string().optional() })) });

function certificationAttemptsSinceLastPass(suite: PlaywrightSuite, target: PlaywrightTarget) {
  // timedout and interrupted attempts count toward the budget: a Ctrl+C'd or
  // hung full run is still a consumed attempt, not a free retry.
  const attempts = listRunManifests().filter(
    (manifest) =>
      manifest.lane === 'certification' &&
      manifest.suite === suite &&
      (manifest.target ?? 'cloud') === target &&
      !manifest.grep &&
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
  return attempts.slice(lastPassedIndex + 1).map((manifest) => {
    const failure = manifest.failures[0] ?? null;
    return {
      runKey: manifest.runKey,
      status:
        manifest.status === 'passed'
          ? ('passed' as const)
          : ('failed' as const),
      startedAt: manifest.startedAt,
      classification: manifest.classification,
      classifiedAt: manifest.classifiedAt,
      failedSpecFile: failure?.file ?? null,
      failedTestId: failure?.testId ?? null,
      focusedGrepToken: focusedProofTokenForFailure({
        suite: manifest.suite,
        failedTitle: failure?.title ?? null,
        failedSpecFile: failure?.file ?? null,
      }),
    };
  });
}

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

function discoverPlaywrightSelection(
  suite: PlaywrightSuite,
  playwrightArgs: readonly string[],
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  const commandArgs = [
    'x',
    'playwright',
    'test',
    ...SUITE_CONFIG[suite],
    ...playwrightArgs,
    '--list',
    '--reporter', './tests/golden/support/discovery-reporter.ts',
  ];
  const result = spawnSync(process.execPath, commandArgs, {
    cwd: resolve(import.meta.dir, '..'),
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    timeout: 60_000,
    windowsHide: true,
  });
  signal.throwIfAborted();
  if (result.error) throw new Error(`Playwright discovery failed or exceeded its 60-second deadline: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(
      `Could not discover ${suite} tests: ${getSpawnFailureDetail(result, `Playwright exited ${result.status}`)}`,
    );
  }
  const line = result.stdout.split(/\r?\n/).findLast((candidate) => candidate.startsWith('['));
  const tests = z.array(discoveredTestSchema).parse(line ? JSON.parse(line) : null);
  const titles = tests.map((test) => test.id);
  if (new Set(titles).size !== titles.length) throw new Error('Playwright discovery did not return unique test identities.');
  return { tests, titles, total: titles.length };
}

function changedCandidateFiles(): string[] {
  const repositoryRoot = resolve(import.meta.dir, '..');
  const tracked = execFileSync(
    'git',
    ['diff', '--name-only', '--diff-filter=ACMRTUXB', '-z', 'HEAD'],
    { cwd: repositoryRoot, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
  );
  const untracked = execFileSync(
    'git',
    ['ls-files', '--others', '--exclude-standard', '-z'],
    { cwd: repositoryRoot, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
  );
  return [...tracked.split('\0'), ...untracked.split('\0')].filter(Boolean);
}

async function main(signal: AbortSignal): Promise<number> {
  signal.throwIfAborted();
  loadEnvLocal();
  if (process.env.GOLDEN_BASE_URL && process.env.GOLDEN_BASE_URL !== 'http://localhost:3000') throw new Error('Browser runs require http://localhost:3000. Remove the GOLDEN_BASE_URL override before continuing.');
  const lane = process.argv[2] as PlaywrightLane | undefined;
  const suite = process.argv[3] as PlaywrightSuite | undefined;
  if (!lane || !['group', 'iteration', 'certification', 'diagnostic'].includes(lane)) {
    throw new Error(
      'Usage: bun scripts/run-playwright.ts <iteration|certification|diagnostic> <golden|audit|canary> [--target local|cloud] [Playwright args]',
    );
  }
  if (!suite || !['golden', 'audit', 'canary'].includes(suite)) {
    throw new Error('Suite must be golden, audit, or canary.');
  }

  const argumentsByName = parseRunnerArguments(lane, process.argv.slice(4));
  const groupId = argumentsByName['--group'];
  const groups = groupId ? getTestGroups(resolve(import.meta.dir, '..')) : [];
  const group = groupId ? groups.find((entry) => entry.id === groupId) : undefined;
  if (groupId && (!group || group.kind !== suite)) throw new Error(`Group ${groupId} does not belong to suite ${suite}.`);
  const groupFiles = group ? getGroupExecutionFiles(group, groups) : [];
  if (groupId) process.env.WERKFLOW_TEST_GROUP = groupId;
  else delete process.env.WERKFLOW_TEST_GROUP;
  const reuseRunKey = argumentsByName['--reuse-run'] ?? null;
  const grantId = argumentsByName['--rerun-grant'] ?? null;
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
  if (retainedSource) {
    const errors = validateDiagnosticProvenance(retainedSource.backendProvenance, currentBackendProvenance(suite));
    if (!retainedSource.retainedAt || retainedSource.cleanedAt) errors.push('Diagnostic source has no live retained world.');
    if (!retainedSource.businessDate) errors.push('Diagnostic source has no recorded business date.');
    if (errors.length) throw new Error(errors.join('\n'));
  }
  const businessDate = resolveBusinessDate(retainedSource?.businessDate);
  process.env.WERKFLOW_TEST_BUSINESS_DATE = businessDate;

  const fullSelection = discoverPlaywrightSelection(
    suite,
    [],
    signal,
  );
  if (!fullSelection.total) throw new Error(`The ${suite} suite contains no tests. Refusing to create a world.`);
  const requestedSelection = grep || group
    ? discoverPlaywrightSelection(suite, playwrightArgs, signal)
    : fullSelection;
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

  const candidateFingerprint = calculateCandidateFingerprint(resolve(import.meta.dir, '..'));
  const manifests = listRunManifests();
  let groupFingerprint: string | undefined;
  if (group) {
    const repositoryRoot = resolve(import.meta.dir, '..');
    const snapshot = captureInputSnapshot(repositoryRoot, calculateBuildInputs(repositoryRoot).environmentDigest);
    groupFingerprint = createGroupQualification(repositoryRoot, groups, snapshot).qualify(group).fingerprint;
    const problem = directGroupRetryProblem({
      groupId: group.id, target, fingerprint: groupFingerprint, runs: manifests,
      recoveredRunKeys: recoveredEnvironmentRuns(manifests),
    });
    if (problem) throw new Error(problem);
  }
  const campaign = activeCampaign();
  const latestRunKey = grantReferenceRunKey({ attempts: manifests, campaignId: campaign.id, suite, target, lane });
  const grant = validatedRerunGrant({ campaign, grantId, suite, target, candidateFingerprint, latestRunKey });
  const overrideReason = grant?.reason ?? null;
  const summary = campaignSummary(campaign, manifests);
  console.log(`[werkflow-test] campaign ${campaign.id}: ${summary.fullAttempts} complete attempts / ${summary.fullMinutes.toFixed(1)} min; ${summary.totalMinutes.toFixed(1)} min across all runs, including ${summary.diagnosticMinutes.toFixed(1)} diagnostic min`);
  if (lane === 'iteration' && grep) {
    const policy = evaluateFocusedIterationRerun({
      attemptsSinceLastPass: focusedIterationAttemptsSinceLastPass({
        suite,
        target,
        selectedTestIds: requestedSelection.titles,
      }),
      overrideReason,
    });
    if (!policy.allowed)
      throw new Error(policy.reason ?? 'Focused iteration rerun blocked.');
  }
  // The rerun budget guards every full certification, per suite: Stage A's
  // local-battery campaign ran eight same-class audit certification retries
  // with no mechanical gate because this block was golden-only (2026-08-28).
  if (lane === 'certification' && !grep) {
    const budgetProblem = campaignBudgetProblem({ campaign, attempts: manifests, suite, target });
    if (budgetProblem && !grant) throw new Error(budgetProblem);
    const focusedVerifications = manifests
      .filter(
        (manifest) =>
          manifest.grep &&
          manifest.lane === 'iteration' &&
          manifest.suite === suite,
      )
      .map((manifest) => ({
        status:
          manifest.status === 'passed'
            ? ('passed' as const)
            : ('failed' as const),
        startedAt: manifest.startedAt,
        candidateFingerprint: manifest.candidateFingerprint ?? '',
        suite: manifest.suite,
        grep: manifest.grep ?? '',
        total: manifest.total,
        target: manifest.target ?? 'cloud',
        passedTestIds: (manifest.outcomes ?? []).filter((outcome) => outcome.status === 'passed').map((outcome) => outcome.id),
      }));
    const policy = evaluateFullCertificationRerun({
      currentSuite: suite,
      attemptsSinceLastPass: certificationAttemptsSinceLastPass(suite, target),
      focusedVerifications,
      currentCandidateFingerprint: candidateFingerprint,
      fullSuiteTestCount: fullSelection.total,
      overrideReason,
      currentTarget: target,
    });
    if (!policy.allowed)
      throw new Error(policy.reason ?? 'Full certification rerun blocked.');

    const allFocusedVerifications = manifests
      .filter((manifest) => manifest.grep && manifest.lane === 'iteration')
      .map((manifest) => ({
        status:
          manifest.status === 'passed'
            ? ('passed' as const)
            : ('failed' as const),
        startedAt: manifest.startedAt,
        candidateFingerprint: manifest.candidateFingerprint ?? '',
        suite: manifest.suite,
        grep: manifest.grep ?? '',
        total: manifest.total,
        target: manifest.target ?? 'cloud',
        passedTestIds: (manifest.outcomes ?? []).filter((outcome) => outcome.status === 'passed').map((outcome) => outcome.id),
      }));
    const missingProofs = evaluateRequiredFocusedProofs({
      requirements: requiredFocusedProofsForChangedFiles(
        changedCandidateFiles(),
      ),
      focusedVerifications: allFocusedVerifications,
      currentCandidateFingerprint: candidateFingerprint,
      currentTarget: target,
    });
    if (missingProofs.length > 0) {
      throw new Error(
        [
          'Certification requires focused proofs for affected inherited behavior:',
          ...missingProofs.map(
            (requirement) =>
              `  - ${requirement.reason} Run bun run test:${requirement.suite}:focused --grep "@${requirement.token.toUpperCase()}" on the current source.`,
          ),
        ].join('\n'),
      );
    }
  }

  await runPlaywrightPreflight({ lane, target });
  signal.throwIfAborted();
  const runKey = createRunKey();
  if (grant) consumeRerunGrant(campaign.id, grant.id, runKey);
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
    rerunOverrideReason: overrideReason,
    campaignId: campaign.id,
    rerunGrantId: grant?.id ?? null,
    selectedTestIds: requestedSelection.titles,
    candidateFingerprint,
    groupFingerprint,
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
      signal, cwd: resolve(import.meta.dir, '..'), env: process.env,
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
  if (['passed', 'diagnostic_passed'].includes(manifest.status)) {
    const evidenceErrors = validateExecutedSelection({ selectedTestIds: requestedSelection.titles, outcomes: manifest.outcomes ?? [], candidateBefore: candidateFingerprint, candidateAfter: calculateCandidateFingerprint(resolve(import.meta.dir, '..')) });
    const timing = group ? getGroupTimingRequirements(group, groups, resolve(import.meta.dir, '..')) : { requireFreshness: requestedSelection.titles.some((title) => title.includes('@FRESHNESS')), requireReadiness: requestedSelection.titles.some((title) => title.includes('@READINESS')) };
    evidenceErrors.push(...checkLatencyEvidence({ directory: runDirectory(runKey), ...timing }).problems);
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
