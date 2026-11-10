// Rule test: a Boat run sends back every file a workstation command reads, and a browser run's
// traces and screenshots only when the run or its group did not pass, so diagnosis and
// classification work at home while a passed plan's download stays small.
import { expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { resultFiles } from './result-files';

/** Writes `files`, path to content, into a fresh checkout and returns it. */
function checkout(files: Record<string, string>): string {
  const repository = mkdtempSync(join(tmpdir(), 'boat-result-files-'));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(repository, dirname(path)), { recursive: true });
    writeFileSync(join(repository, path), content);
  }
  return repository;
}

/** A browser run's folder as a run writes it, with `status` in its manifest. */
function browserRun(key: string, status: string): Record<string, string> {
  const run = `.agent-logs/playwright-runs/${key}`;
  return {
    [`${run}/manifest.json`]: JSON.stringify({ runKey: key, status }),
    [`${run}/runner.log`]: 'log',
    [`${run}/latency-summary.json`]: '{}',
    [`${run}/lab.ndjson`]: '{}',
    [`${run}/performance-workload.json`]: '{}',
    [`${run}/state/world.json`]: '{}',
    [`${run}/acceptance/index.json`]: '{}',
    [`${run}/acceptance/set/screen-375-light.png`]: 'png',
    [`${run}/active/world.json`]: '{}',
    [`${run}/active/upload-fixture.pdf`]: 'x'.repeat(1000),
    [`${run}/playwright/report/index.html`]: 'x'.repeat(100),
    [`${run}/playwright/results/test-a/error-context.md`]: 'context',
    [`${run}/playwright/results/test-a/test-failed-1.png`]: 'png',
    [`${run}/playwright/results/test-a/trace.zip`]: 'x'.repeat(10),
  };
}

const KEPT_ALWAYS = [
  'manifest.json',
  'runner.log',
  'latency-summary.json',
  'lab.ndjson',
  'performance-workload.json',
  'state/world.json',
  'acceptance/index.json',
  'acceptance/set/screen-375-light.png',
];
const DIAGNOSTICS = [
  'playwright/results/test-a/error-context.md',
  'playwright/results/test-a/test-failed-1.png',
  'playwright/results/test-a/trace.zip',
];

function report(results: { status: string; runKey: string | null }[]): Record<string, string> {
  return {
    '.agent-logs/verification/r1/report.json': JSON.stringify({ results }),
    '.agent-logs/verification/r1/unit-all.log': 'log',
    '.agent-logs/verification/r1/diagnoses.json': '[]',
  };
}

const FOLDERS = [
  '.agent-logs/verification/r1',
  '.agent-logs/playwright-runs/ok',
  '.agent-logs/playwright-runs/bad',
  '.agent-logs/test-server',
];

test('a passed run returns its evidence without per-test output, a failed run with it', () => {
  const repository = checkout({
    ...report([
      { status: 'passed', runKey: 'ok' },
      { status: 'failed', runKey: 'bad' },
      { status: 'passed', runKey: null },
    ]),
    ...browserRun('ok', 'passed'),
    ...browserRun('bad', 'failed'),
    '.agent-logs/test-server/server.log': 'log',
  });
  const selection = resultFiles(repository, FOLDERS);
  expect(selection.files.sort()).toEqual(
    [
      '.agent-logs/verification/r1/report.json',
      '.agent-logs/verification/r1/unit-all.log',
      '.agent-logs/verification/r1/diagnoses.json',
      ...KEPT_ALWAYS.map((file) => `.agent-logs/playwright-runs/ok/${file}`),
      ...[...KEPT_ALWAYS, ...DIAGNOSTICS].map((file) => `.agent-logs/playwright-runs/bad/${file}`),
      '.agent-logs/test-server/server.log',
    ].sort(),
  );
  expect(selection.passedRuns).toBe(1);
  // Both runs leave their active world (1002 bytes) and report (100); the passed one its output (20).
  expect(selection.leftOutBytes).toBe(2 * 1102 + 20);
});

test('a run whose Playwright passed but whose group failed returns its per-test output', () => {
  const repository = checkout({
    ...report([{ status: 'failed', runKey: 'ok' }]),
    ...browserRun('ok', 'passed'),
  });
  const files = resultFiles(repository, FOLDERS.slice(0, 2)).files;
  for (const file of DIAGNOSTICS) expect(files).toContain(`.agent-logs/playwright-runs/ok/${file}`);
});

test('a run without a readable manifest returns its per-test output', () => {
  const run = browserRun('ok', 'passed');
  run['.agent-logs/playwright-runs/ok/manifest.json'] = '{';
  const repository = checkout(run);
  const files = resultFiles(repository, ['.agent-logs/playwright-runs/ok']).files;
  for (const file of DIAGNOSTICS) expect(files).toContain(`.agent-logs/playwright-runs/ok/${file}`);
});

test('a symbolic link is listed, so the import still refuses it', () => {
  const repository = checkout(browserRun('ok', 'passed'));
  symlinkSync('/etc/passwd', join(repository, '.agent-logs/playwright-runs/ok/state/link'));
  expect(resultFiles(repository, ['.agent-logs/playwright-runs/ok']).files).toContain(
    '.agent-logs/playwright-runs/ok/state/link',
  );
});

test('an unreadable report stops the choice, so the machine returns every new folder whole', () => {
  const repository = checkout({ '.agent-logs/verification/r1/report.json': '{"results":[{}]}' });
  expect(() => resultFiles(repository, ['.agent-logs/verification/r1'])).toThrow();
});
