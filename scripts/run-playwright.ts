import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createWriteStream, existsSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  PLAYWRIGHT_TARGETS,
  defaultTargetForSuite,
  evaluateFocusedIterationRerun,
  evaluateFullCertificationRerun,
  evaluateRequiredFocusedProofs,
  focusedProofTokenForFailure,
  parsePlaywrightListOutput,
  requiredFocusedProofsForChangedFiles,
  validateFocusedSelection,
  validateRunRequest,
  validateSerialSelection,
  type PlaywrightLane,
  type PlaywrightSuite,
  type PlaywrightTarget,
} from '../lib/testing/run-policy';
import { runPlaywrightPreflight } from './playwright-preflight';
import { loadEnvLocal } from '../tests/golden/support/env';
import {
  calculateSourceFingerprint,
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

function argumentValue(args: string[], name: string): string | null {
  const inline = args.find((argument) => argument.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1) || null;
  const index = args.indexOf(name);
  if (index < 0) return null;
  const value = args[index + 1];
  if (!value || value.startsWith('-'))
    throw new Error(`${name} requires a value.`);
  return value;
}

function removeOption(args: string[], name: string): string[] {
  const inlineIndex = args.findIndex((argument) =>
    argument.startsWith(`${name}=`),
  );
  if (inlineIndex >= 0) return args.filter((_, index) => index !== inlineIndex);
  const index = args.indexOf(name);
  if (index < 0) return args;
  return [...args.slice(0, index), ...args.slice(index + 2)];
}

function certificationAttemptsSinceLastPass(suite: PlaywrightSuite) {
  // timedout and interrupted attempts count toward the budget: a Ctrl+C'd or
  // hung full run is still a consumed attempt, not a free retry.
  const attempts = listRunManifests().filter(
    (manifest) =>
      manifest.lane === 'certification' &&
      manifest.suite === suite &&
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
      focusedGrepToken: focusedProofTokenForFailure({
        suite: manifest.suite,
        failedTitle: failure?.title ?? null,
        failedSpecFile: failure?.file ?? null,
      }),
    };
  });
}

function normalizedGrep(value: string | null | undefined): string {
  return value?.trim() ?? '';
}

function focusedIterationAttemptsSinceLastPass(input: {
  suite: PlaywrightSuite;
  target: PlaywrightTarget;
  grep: string;
}) {
  const attempts = listRunManifests().filter(
    (manifest) =>
      manifest.lane === 'iteration' &&
      manifest.suite === input.suite &&
      (manifest.target ?? 'cloud') === input.target &&
      normalizedGrep(manifest.grep) === normalizedGrep(input.grep) &&
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
) {
  const commandArgs = [
    'x',
    'playwright',
    'test',
    ...SUITE_CONFIG[suite],
    ...playwrightArgs,
    '--list',
  ];
  const result = spawnSync(process.execPath, commandArgs, {
    cwd: resolve(import.meta.dir, '..'),
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `Could not discover ${suite} tests: ${result.stderr.trim() || `Playwright exited ${result.status}`}`,
    );
  }
  return parsePlaywrightListOutput(result.stdout);
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

async function main(): Promise<number> {
  loadEnvLocal();
  const lane = process.argv[2] as PlaywrightLane | undefined;
  const suite = process.argv[3] as PlaywrightSuite | undefined;
  if (!lane || !['iteration', 'certification', 'diagnostic'].includes(lane)) {
    throw new Error(
      'Usage: bun scripts/run-playwright.ts <iteration|certification|diagnostic> <golden|audit|canary> [--target local|cloud] [Playwright args]',
    );
  }
  if (!suite || !['golden', 'audit', 'canary'].includes(suite)) {
    throw new Error('Suite must be golden, audit, or canary.');
  }

  let playwrightArgs = process.argv.slice(4);
  const reuseRunKey = argumentValue(playwrightArgs, '--reuse-run');
  const overrideReason = argumentValue(
    playwrightArgs,
    '--override-rerun-budget',
  );
  const targetArgument = argumentValue(playwrightArgs, '--target');
  playwrightArgs = removeOption(playwrightArgs, '--reuse-run');
  playwrightArgs = removeOption(playwrightArgs, '--override-rerun-budget');
  playwrightArgs = removeOption(playwrightArgs, '--target');
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
  const grep = argumentValue(playwrightArgs, '--grep');
  const requestErrors = validateRunRequest({
    lane,
    suite,
    target,
    grep,
    reuseRunKey,
  });
  if (requestErrors.length > 0) throw new Error(requestErrors.join('\n'));

  const fullSelection = discoverPlaywrightSelection(
    suite,
    removeOption(playwrightArgs, '--grep'),
  );
  const requestedSelection = grep
    ? discoverPlaywrightSelection(suite, playwrightArgs)
    : fullSelection;
  const selectionErrors = [
    ...validateFocusedSelection({
      lane,
      suite,
      selectedTestCount: requestedSelection.total,
      fullSuiteTestCount: fullSelection.total,
    }),
    ...validateSerialSelection({
      lane,
      suite,
      selectedTitles: requestedSelection.titles,
    }),
  ];
  if (selectionErrors.length > 0) throw new Error(selectionErrors.join('\n'));

  const sourceFingerprint = calculateSourceFingerprint();
  const manifests = listRunManifests();
  if (lane === 'iteration' && grep) {
    const policy = evaluateFocusedIterationRerun({
      attemptsSinceLastPass: focusedIterationAttemptsSinceLastPass({
        suite,
        target,
        grep,
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
        sourceFingerprint: manifest.sourceFingerprint,
        suite: manifest.suite,
        grep: manifest.grep ?? '',
        total: manifest.total,
      }));
    const policy = evaluateFullCertificationRerun({
      attemptsSinceLastPass: certificationAttemptsSinceLastPass(suite),
      focusedVerifications,
      currentSourceFingerprint: sourceFingerprint,
      fullSuiteTestCount: fullSelection.total,
      overrideReason,
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
        sourceFingerprint: manifest.sourceFingerprint,
        suite: manifest.suite,
        grep: manifest.grep ?? '',
        total: manifest.total,
      }));
    const missingProofs = evaluateRequiredFocusedProofs({
      requirements: requiredFocusedProofsForChangedFiles(
        changedCandidateFiles(),
      ),
      focusedVerifications: allFocusedVerifications,
      currentSourceFingerprint: sourceFingerprint,
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
  const runKey = createRunKey();
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
  });

  const logPath = resolve(runDirectory(runKey), 'runner.log');
  const log = createWriteStream(logPath, { flags: 'a' });
  log.on('error', () => undefined);
  console.log(
    `[werkflow-test] started ${lane} ${suite} run ${runKey} (target ${target}); output: ${logPath}`,
  );
  const child = spawn(process.execPath, commandArgs, {
    cwd: resolve(import.meta.dir, '..'),
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  child.stdout.pipe(log, { end: false });
  child.stderr.pipe(log, { end: false });
  const exitCode = await new Promise<number>((resolveExit, rejectExit) => {
    child.once('error', (error) => {
      log.end();
      rejectExit(error);
    });
    child.once('close', (code) => resolveExit(code ?? 1));
  });
  await new Promise<void>((resolveLog, rejectLog) => {
    log.end((error?: Error | null) => {
      if (error) rejectLog(error);
      else resolveLog();
    });
  });

  let manifest;
  try {
    manifest = readRunManifest(runKey);
  } catch {
    throw new Error(
      `Playwright exited ${exitCode} without manifest ${manifestPath(runKey)}.`,
    );
  }
  if (
    exitCode !== 0 &&
    !['failed', 'failed_retained', 'timedout', 'interrupted'].includes(
      manifest.status,
    )
  ) {
    manifest = updateRunManifest(runKey, {
      status: 'failed',
      completedAt: new Date().toISOString(),
      failures: [
        ...manifest.failures,
        {
          title: 'Playwright process',
          file: null,
          message: `Process exited with code ${exitCode}.`,
        },
      ],
    });
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

try {
  process.exitCode = await main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  const runKey = process.env.WERKFLOW_RUN_KEY;
  if (runKey && existsSync(manifestPath(runKey))) {
    try {
      updateRunManifest(runKey, (current) => ({
        status: 'failed',
        completedAt: new Date().toISOString(),
        failures: [
          ...current.failures,
          { title: 'Test runner', file: 'scripts/run-playwright.ts', message },
        ],
      }));
    } catch (manifestError) {
      console.error(
        `Could not record runner failure: ${String(manifestError)}`,
      );
    }
  }
  process.exitCode = 1;
}
