// Rule test: the release reads DEV's migration ledger before it touches PROD
// (.github/scripts/dev-holds-migrations.sh). A refused read names its HTTP status and cause but
// never Supabase's body or the token, and only a list of versions counts as the ledger.
import { beforeEach, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { temporaryDirectory } from './temporary-directory';

const script = resolve(import.meta.dir, '../../.github/scripts/dev-holds-migrations.sh');
const TOKEN = 'supabase-token-value';
const BODY_MARKER = 'provider-body-text';
const VERSIONS = ['20261101090000', '20261102090000'];

// Answers like the Management API: the body from $STUB/body, the status from $STUB/status, and
// curl's exit code from $STUB/exit. Arguments land in $STUB/arguments, configs in $STUB/config.
const CURL_STUB = `#!/usr/bin/env bash
output=
previous=
printf '%s\\n' "$*" >> "$STUB/arguments"
for argument in "$@"; do
  if test "$previous" = --output; then output="$argument"; fi
  if test "$previous" = --config; then cat "$argument" >> "$STUB/config"; fi
  previous="$argument"
done
cp "$STUB/body" "$output"
printf '%s' "$(cat "$STUB/status")"
exit "$(cat "$STUB/exit")"
`;

let stub = '';
let checkout = '';

beforeEach(() => {
  stub = temporaryDirectory('dev-holds-stub-');
  checkout = temporaryDirectory('dev-holds-checkout-');
  writeFileSync(join(stub, 'curl'), CURL_STUB);
  chmodSync(join(stub, 'curl'), 0o755);
  mkdirSync(join(checkout, 'supabase/migrations'), { recursive: true });
  for (const version of VERSIONS)
    writeFileSync(join(checkout, `supabase/migrations/${version}_change.sql`), '');
});

function check(status: string, body: string, exit = 0) {
  writeFileSync(join(stub, 'status'), status);
  writeFileSync(join(stub, 'body'), body);
  writeFileSync(join(stub, 'exit'), String(exit));
  const result = spawnSync('bash', [script], {
    cwd: checkout,
    encoding: 'utf8',
    env: {
      NODE_ENV: 'test',
      PATH: `${stub}:${process.env.PATH ?? ''}`,
      STUB: stub,
      SUPABASE_ACCESS_TOKEN: TOKEN,
      DEV_PROJECT_REF: 'devref',
    },
  });
  const read = (name: string) => (existsSync(join(stub, name)) ? readFileSync(join(stub, name), 'utf8') : '');
  return {
    status: result.status,
    output: `${result.stdout}${result.stderr}`,
    arguments: read('arguments'),
    config: read('config'),
  };
}

const rows = (versions: string[]) => JSON.stringify(versions.map((version) => ({ version })));

test('a ledger that holds every committed version passes, and the token reaches curl in its config only', () => {
  const result = check('201', rows([...VERSIONS, '20261001090000']));
  expect(result.status, result.output).toBe(0);
  expect(result.output).toContain('DEV holds all 2 migrations');
  expect(result.arguments).toContain('https://api.supabase.com/v1/projects/devref/database/query/read-only');
  expect(result.arguments).not.toContain(TOKEN);
  expect(result.config).toContain(`Authorization: Bearer ${TOKEN}`);
});

test('a ledger without a committed version names it and fails', () => {
  const result = check('201', rows([VERSIONS[0] ?? '']));
  expect(result.status).toBe(1);
  expect(result.output).toContain(`DEV lacks 1 migrations of this commit: ${VERSIONS[1]}`);
});

test('a refused read names its status and cause, never the body or the token', () => {
  const body = JSON.stringify({ message: `${BODY_MARKER} ${TOKEN}` });
  for (const [status, cause] of [
    ['401', 'expired, revoked or malformed'],
    ['403', 'needs the permission database_read on project devref'],
    ['404', 'found no project devref'],
    ['429', 'rate-limited'],
    ['500', 'failed to run the query'],
    ['302', 'does not expect'],
  ] as const) {
    const result = check(status, body);
    expect(result.status, status).toBe(1);
    expect(result.output, status).toContain(`could not be read (HTTP ${status}): `);
    expect(result.output, status).toContain(cause);
    expect(result.output, status).toContain('applies nothing to PROD');
    expect(result.output, status).not.toContain(BODY_MARKER);
    expect(result.output, status).not.toContain(TOKEN);
  }
});

test('an answer that did not arrive names curl’s exit code', () => {
  const result = check('000', '', 28);
  expect(result.status).toBe(1);
  expect(result.output).toContain("(HTTP 000): Supabase's answer did not arrive (curl exit 28).");
});

test('a successful answer that is not a list of versions never reads as a ledger', () => {
  for (const body of [
    '[]',
    JSON.stringify({ result: [] }),
    '[{"version":20261101090000}]',
    `[{"version":"${BODY_MARKER}"}]`,
    'not json',
  ]) {
    const result = check('201', body);
    expect(result.status, body).toBe(1);
    expect(result.output, body).toContain(
      "(HTTP 201): Supabase's answer holds no list of migration versions.",
    );
    expect(result.output, body).not.toContain(BODY_MARKER);
  }
});
