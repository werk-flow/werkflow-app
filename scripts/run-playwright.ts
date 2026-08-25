import { spawn } from 'node:child_process';
import { createWriteStream, existsSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  evaluateFullCertificationRerun,
  validateRunRequest,
  type PlaywrightLane,
  type PlaywrightSuite,
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

function argumentValue(args: string[], name: string): string | null {
  const inline = args.find((argument) => argument.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1) || null;
  const index = args.indexOf(name);
  if (index < 0) return null;
  const value = args[index + 1];
  if (!value || value.startsWith('-')) throw new Error(`${name} requires a value.`);
  return value;
}

function removeOption(args: string[], name: string): string[] {
  const inlineIndex = args.findIndex((argument) => argument.startsWith(`${name}=`));
  if (inlineIndex >= 0) return args.filter((_, index) => index !== inlineIndex);
  const index = args.indexOf(name);
  if (index < 0) return args;
  return [...args.slice(0, index), ...args.slice(index + 2)];
}

function certificationAttemptsSinceLastPass() {
  const attempts = listRunManifests().filter(
    (manifest) =>
      manifest.lane === 'certification' &&
      manifest.suite === 'golden' &&
      !manifest.grep &&
      ['passed', 'failed', 'failed_retained', 'cleaned'].includes(manifest.status)
  );
  const lastPassedIndex = attempts.findLastIndex((manifest) => manifest.status === 'passed');
  return attempts.slice(lastPassedIndex + 1).map((manifest) => ({
    runKey: manifest.runKey,
    status: manifest.status === 'passed' ? ('passed' as const) : ('failed' as const),
    startedAt: manifest.startedAt,
    classification: manifest.classification,
    classifiedAt: manifest.classifiedAt,
  }));
}

async function main(): Promise<number> {
  loadEnvLocal();
  const lane = process.argv[2] as PlaywrightLane | undefined;
  const suite = process.argv[3] as PlaywrightSuite | undefined;
  if (!lane || !['iteration', 'certification', 'diagnostic'].includes(lane)) {
    throw new Error('Usage: bun scripts/run-playwright.ts <iteration|certification|diagnostic> <golden|audit> [Playwright args]');
  }
  if (!suite || !['golden', 'audit'].includes(suite)) throw new Error('Suite must be golden or audit.');

  let playwrightArgs = process.argv.slice(4);
  const reuseRunKey = argumentValue(playwrightArgs, '--reuse-run');
  const overrideReason = argumentValue(playwrightArgs, '--override-rerun-budget');
  playwrightArgs = removeOption(playwrightArgs, '--reuse-run');
  playwrightArgs = removeOption(playwrightArgs, '--override-rerun-budget');
  const grep = argumentValue(playwrightArgs, '--grep');
  const requestErrors = validateRunRequest({ lane, suite, grep, reuseRunKey });
  if (requestErrors.length > 0) throw new Error(requestErrors.join('\n'));

  const sourceFingerprint = calculateSourceFingerprint();
  if (lane === 'certification' && suite === 'golden' && !grep) {
    const focusedVerifications = listRunManifests()
      .filter(
        (manifest) =>
          manifest.grep && manifest.lane === 'iteration' && manifest.suite === 'golden'
      )
      .map((manifest) => ({
        status: manifest.status === 'passed' ? ('passed' as const) : ('failed' as const),
        startedAt: manifest.startedAt,
        sourceFingerprint: manifest.sourceFingerprint,
      }));
    const policy = evaluateFullCertificationRerun({
      attemptsSinceLastPass: certificationAttemptsSinceLastPass(),
      focusedVerifications,
      currentSourceFingerprint: sourceFingerprint,
      overrideReason,
    });
    if (!policy.allowed) throw new Error(policy.reason ?? 'Full certification rerun blocked.');
  }

  await runPlaywrightPreflight({ lane });
  const runKey = createRunKey();
  process.env.WERKFLOW_RUN_KEY = runKey;
  process.env.WERKFLOW_TEST_LANE = lane;
  process.env.WERKFLOW_TEST_SUITE = suite;
  process.env.WERKFLOW_TEST_GREP = grep ?? '';
  if (reuseRunKey) process.env.WERKFLOW_REUSE_RUN_KEY = reuseRunKey;
  else delete process.env.WERKFLOW_REUSE_RUN_KEY;
  process.env.WERKFLOW_QUIET_REPORTER = '1';
  const commandArgs = [
    'x',
    'playwright',
    'test',
    ...(suite === 'audit' ? ['--config', 'playwright.audit.config.ts'] : []),
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
  console.log(`[werkflow-test] started ${lane} ${suite} run ${runKey}; output: ${logPath}`);
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
    throw new Error(`Playwright exited ${exitCode} without manifest ${manifestPath(runKey)}.`);
  }
  if (exitCode !== 0 && !['failed', 'failed_retained', 'timedout', 'interrupted'].includes(manifest.status)) {
    manifest = updateRunManifest(runKey, {
      status: 'failed',
      completedAt: new Date().toISOString(),
      failures: [
        ...manifest.failures,
        { title: 'Playwright process', file: null, message: `Process exited with code ${exitCode}.` },
      ],
    });
  }
  console.log(
    `[werkflow-test] ${manifest.status}; ${manifest.passed}/${manifest.total} passed; run ${runKey}`
  );
  if (manifest.failures[0]) console.log(`[werkflow-test] failure: ${manifest.failures[0].message}`);
  return ['passed', 'diagnostic_passed'].includes(manifest.status) ? exitCode : 1;
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
      console.error(`Could not record runner failure: ${String(manifestError)}`);
    }
  }
  process.exitCode = 1;
}
