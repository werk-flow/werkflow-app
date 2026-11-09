// The Vercel project builds only production and staging: its Ignored Build Step is the committed
// command (.github/vercel/ignored-build-step.sh), and the weekly check (.github/scripts/vercel-build-step.sh)
// fails when the project's setting drifts from it.
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const script = resolve(import.meta.dir, '../../.github/scripts/vercel-build-step.sh');
const commandFile = resolve(import.meta.dir, '../../.github/vercel/ignored-build-step.sh');
const committed = readFileSync(commandFile, 'utf8')
  .split('\n')
  .filter((line) => line !== '' && !line.startsWith('#'));

// Answers like curl: the project body goes to --output, the status to stdout.
const CURL_STUB = `#!/usr/bin/env bash
previous=
for argument in "$@"; do
  if test "$previous" = --output; then cp "$STUB/project.json" "$argument"; fi
  previous="$argument"
done
cat "$STUB/status"
`;

const TOKEN = 'token-that-must-never-print';
let stub = '';

beforeEach(() => {
  stub = mkdtempSync(join(tmpdir(), 'vercel-build-step-'));
  writeFileSync(join(stub, 'curl'), CURL_STUB);
  chmodSync(join(stub, 'curl'), 0o755);
  writeFileSync(join(stub, 'output'), '');
  answer(200, { id: 'prj_test', commandForIgnoringBuildStep: committed[0] });
});

afterEach(() => rmSync(stub, { recursive: true, force: true }));

function answer(status: number, project: Record<string, unknown>) {
  writeFileSync(join(stub, 'status'), String(status));
  writeFileSync(join(stub, 'project.json'), JSON.stringify(project));
}

function check(extraEnv: Record<string, string> = {}) {
  const result = spawnSync('bash', [script, 'https://api.vercel.com/v9/projects/prj_test'], {
    encoding: 'utf8',
    env: {
      NODE_ENV: 'test',
      PATH: `${stub}:${process.env.PATH}`,
      STUB: stub,
      VERCEL_TOKEN: TOKEN,
      GITHUB_OUTPUT: join(stub, 'output'),
      ...extraEnv,
    },
  });
  const printed = `${result.stdout}${result.stderr}`;
  expect(printed).not.toContain(TOKEN);
  return { status: result.status, printed };
}

describe('the committed command', () => {
  test('is one line, the only one the project setting holds', () => {
    expect(committed).toHaveLength(1);
  });

  // Vercel's convention: exit 1 builds, exit 0 skips.
  function decides(env: Record<string, string>) {
    return spawnSync('sh', ['-c', committed[0] ?? 'exit 2'], {
      encoding: 'utf8',
      env: { NODE_ENV: 'test', ...env },
    }).status;
  }

  test('builds production from the production branch', () => {
    expect(decides({ VERCEL_ENV: 'production', VERCEL_GIT_COMMIT_REF: 'production' })).toBe(1);
  });

  test('builds staging, a preview of main', () => {
    expect(decides({ VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'main' })).toBe(1);
  });

  test('skips every other branch, an orphan pr-assets branch included', () => {
    expect(decides({ VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'pr-assets/e7-c2-app-shell' })).toBe(0);
    expect(decides({ VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 't3/feature' })).toBe(0);
  });
});

describe('the drift check', () => {
  test('passes when the project setting equals the committed command, as a prod check', () => {
    const { status, printed } = check();
    expect(printed).toContain('vercel-build-step: ok');
    expect(status).toBe(0);
    expect(readFileSync(join(stub, 'output'), 'utf8')).toBe('environment=prod\n');
  });

  test('fails when the project setting differs, without printing it', () => {
    answer(200, { commandForIgnoringBuildStep: 'echo drifted-command; exit 1' });
    const { status, printed } = check();
    expect(printed).toContain('differs from .github/vercel/ignored-build-step.sh');
    expect(printed).not.toContain('drifted-command');
    expect(status).toBe(1);
  });

  test('fails when the project has no Ignored Build Step', () => {
    answer(200, { commandForIgnoringBuildStep: null });
    const { status, printed } = check();
    expect(printed).toContain('has no Ignored Build Step');
    expect(status).toBe(1);
  });

  test('fails with the HTTP status when the token cannot read the project', () => {
    answer(403, { error: { code: 'forbidden' } });
    const { status, printed } = check();
    expect(printed).toContain('could not read the project (HTTP 403)');
    expect(printed).not.toContain('forbidden');
    expect(status).toBe(1);
  });

  test('fails without a token', () => {
    const { status, printed } = check({ VERCEL_TOKEN: '' });
    expect(printed).toContain('VERCEL_TOKEN is not configured');
    expect(status).toBe(1);
  });

  test('BREAK_CHECK proves that drift fails the step', () => {
    const { status, printed } = check({ BREAK_CHECK: 'vercel-build-step' });
    expect(printed).toContain('Manual proof run');
    expect(printed).toContain('differs');
    expect(status).toBe(1);
  });

  test('another check id leaves this check alone', () => {
    expect(check({ BREAK_CHECK: 'vercel-token' }).status).toBe(0);
  });
});
