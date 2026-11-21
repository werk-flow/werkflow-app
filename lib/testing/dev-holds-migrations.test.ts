// Rule test: the release applies migrations to PROD only when DEV's ledger, read through the
// read-only endpoint, holds every migration of the candidate, out-of-order ones included.
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const script = resolve(import.meta.dir, '../../.github/scripts/dev-holds-migrations.sh');

// Answers like the Management API from $STUB/ledger.json, or fails as `curl --fail` does without it,
// and records the URL it was asked for.
const CURL_STUB = `#!/usr/bin/env bash
printf '%s' "\${!#}" > "$STUB/url"
test -f "$STUB/ledger.json" || exit 22
cat "$STUB/ledger.json"
`;

let checkout = '';
let stub = '';

beforeEach(() => {
  checkout = mkdtempSync(join(tmpdir(), 'dev-holds-checkout-'));
  stub = mkdtempSync(join(tmpdir(), 'dev-holds-stub-'));
  mkdirSync(join(checkout, 'supabase/migrations'), { recursive: true });
  // The second sorts before the first but merged after it: an out-of-order migration.
  for (const name of ['20261210120000_newer.sql', '20261114100000_merged_later.sql', 'README.md'])
    writeFileSync(join(checkout, 'supabase/migrations', name), 'select 1;\n');
  writeFileSync(join(stub, 'curl'), CURL_STUB);
  chmodSync(join(stub, 'curl'), 0o755);
});

afterEach(() => {
  rmSync(checkout, { recursive: true, force: true });
  rmSync(stub, { recursive: true, force: true });
});

function run(ledger: unknown) {
  if (ledger !== undefined) writeFileSync(join(stub, 'ledger.json'), JSON.stringify(ledger));
  const result = spawnSync('bash', [script], {
    cwd: checkout,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${stub}:${process.env.PATH ?? ''}`,
      STUB: stub,
      SUPABASE_ACCESS_TOKEN: 'token',
      DEV_PROJECT_REF: 'devref',
    },
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

const rows = (...versions: string[]) => versions.map((version) => ({ version }));

test('DEV holding every migration, and newer ones, passes through the read-only endpoint', () => {
  const result = run(rows('20261114100000', '20261210120000', '20261211000000'));
  expect(result).toEqual({ status: 0, output: 'DEV holds all 2 migrations of this commit.\n' });
  expect(readFileSync(join(stub, 'url'), 'utf8')).toBe(
    'https://api.supabase.com/v1/projects/devref/database/query/read-only',
  );
});

test('an out-of-order migration DEV lacks stops the release and is named', () => {
  const result = run(rows('20261210120000'));
  expect(result.status).toBe(1);
  expect(result.output).toContain('DEV lacks 1 migrations of this commit: 20261114100000.');
});

test('an unreadable ledger stops the release without printing the answer', () => {
  const unreadable = run(undefined);
  expect(unreadable.status).toBe(1);
  expect(unreadable.output).toContain("DEV's migration ledger could not be read");
  const odd = run({ message: 'secret detail' });
  expect(odd.status).toBe(1);
  expect(odd.output).not.toContain('secret detail');
});
