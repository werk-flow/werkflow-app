// Rule test: the release reads DEV's migration ledger before it touches PROD
// (.github/scripts/dev-holds-migrations.sh). A refused read names its HTTP status and cause but
// never Supabase's body, curl's error text or the token, and only a list of versions counts as
// the ledger.
import { beforeEach, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { temporaryDirectory } from './temporary-directory';

const script = resolve(import.meta.dir, '../../.github/scripts/dev-holds-migrations.sh');
const TOKEN = 'supabase-token-value';
const BODY_MARKER = 'provider-body-text';
const CURL_ERROR_MARKER = 'curl-error-text';
const VERSIONS = ['20261101090000', '20261102090000'];

// Answers like the Management API: the body from $STUB/body, the status from $STUB/status, and
// curl's exit code from $STUB/exit, with error text on stderr. Arguments land in
// $STUB/arguments, configs in $STUB/config, and the token curl's environment holds in
// $STUB/environment.
const CURL_STUB = `#!/usr/bin/env bash
output=
previous=
printf '%s\\n' "$*" >> "$STUB/arguments"
printf '%s' "\${SUPABASE_ACCESS_TOKEN-unset}" > "$STUB/environment"
for argument in "$@"; do
  if test "$previous" = --output; then output="$argument"; fi
  if test "$previous" = --config; then cat "$argument" >> "$STUB/config"; fi
  previous="$argument"
done
echo "curl: (56) ${CURL_ERROR_MARKER}" >&2
cp "$STUB/body" "$output"
printf '%s' "$(cat "$STUB/status")"
exit "$(cat "$STUB/exit")"
`;

// Every other program the script starts records the token its environment holds in
// $STUB/children, then runs the real program (the stub folder is PATH's first entry).
const CHILDREN = ['dirname', 'ls', 'sed', 'sort', 'mktemp', 'jq', 'comm', 'wc', 'paste', 'tr', 'rm'];
const CHILD_STUB = `#!/usr/bin/env bash
printf '%s %s\\n' "\${0##*/}" "\${SUPABASE_ACCESS_TOKEN-unset}" >> "$STUB/children"
PATH="\${PATH#*:}" exec "\${0##*/}" "$@"
`;

let stub = '';
let checkout = '';

beforeEach(() => {
  stub = temporaryDirectory('dev-holds-stub-');
  checkout = temporaryDirectory('dev-holds-checkout-');
  writeFileSync(join(stub, 'curl'), CURL_STUB);
  chmodSync(join(stub, 'curl'), 0o755);
  for (const child of CHILDREN) {
    writeFileSync(join(stub, child), CHILD_STUB);
    chmodSync(join(stub, child), 0o755);
  }
  mkdirSync(join(checkout, 'supabase/migrations'), { recursive: true });
  for (const version of VERSIONS)
    writeFileSync(join(checkout, `supabase/migrations/${version}_change.sql`), '');
});

/** Runs the script, under `bash -x` when `trace`; no run may print the token, a body or curl's error text. */
function check(status: string, body: string, { exit = 0, trace = false } = {}) {
  writeFileSync(join(stub, 'status'), status);
  writeFileSync(join(stub, 'body'), body);
  writeFileSync(join(stub, 'exit'), String(exit));
  const result = spawnSync('bash', [...(trace ? ['-x'] : []), script], {
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
  const output = `${result.stdout}${result.stderr}`;
  for (const secret of [TOKEN, BODY_MARKER, CURL_ERROR_MARKER])
    expect(output, `${status} ${body}`).not.toContain(secret);
  return {
    status: result.status,
    output,
    arguments: read('arguments'),
    config: read('config'),
    environment: read('environment'),
    children: read('children'),
  };
}

const rows = (versions: string[]) =>
  JSON.stringify(versions.map((version) => ({ version, note: BODY_MARKER })));
const LEDGER = rows([...VERSIONS, '20261001090000']);

test('a ledger that holds every committed version passes, and the token reaches curl in its config only', () => {
  const result = check('201', LEDGER);
  expect(result.status, result.output).toBe(0);
  expect(result.output).toContain('DEV holds all 2 migrations');
  expect(result.arguments).toStartWith('--disable ');
  expect(result.arguments).toContain('https://api.supabase.com/v1/projects/devref/database/query/read-only');
  expect(result.arguments).not.toContain(TOKEN);
  expect(result.environment).toBe('unset');
  const children = result.children.trim().split('\n');
  expect(children.map((line) => line.split(' ')[0])).toContain('dirname');
  expect(children.filter((line) => !line.endsWith(' unset'))).toEqual([]);
  expect(result.config).toContain(`Authorization: Bearer ${TOKEN}`);
});

test('HTTP 200 counts as success too', () => {
  const result = check('200', LEDGER);
  expect(result.status, result.output).toBe(0);
});

test('under bash -x neither a pass nor a refusal traces the token', () => {
  const passed = check('201', LEDGER, { trace: true });
  expect(passed.status, passed.output).toBe(0);
  expect(passed.output).toContain('+ curl --disable');
  expect(check('403', LEDGER, { trace: true }).status).toBe(1);
});

test('a ledger without a committed version names it and fails', () => {
  const result = check('201', rows([VERSIONS[0] ?? '']));
  expect(result.status).toBe(1);
  expect(result.output).toContain(`DEV lacks 1 migrations of this commit: ${VERSIONS[1]}`);
});

test('a refused read names its status and cause', () => {
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
  }
});

test('an answer that did not arrive whole fails with curl’s exit code, even after a success status', () => {
  for (const [status, exit, body] of [
    ['000', 28, ''],
    ['201', 56, LEDGER],
  ] as const) {
    const result = check(status, body, { exit });
    expect(result.status, status).toBe(1);
    expect(result.output).toContain(
      `(HTTP ${status}): Supabase's answer did not arrive (curl exit ${exit}).`,
    );
  }
});

test('a successful answer that is not one list of versions never reads as a ledger', () => {
  for (const body of [
    '[]',
    JSON.stringify({ result: [] }),
    '[{"version":20261101090000}]',
    `[{"version":"${BODY_MARKER}"}]`,
    `${rows([VERSIONS[0] ?? ''])}\n${rows([VERSIONS[1] ?? ''])}`,
    rows([`${VERSIONS[0]}\n`, VERSIONS[1] ?? '']),
    'not json',
  ]) {
    const result = check('201', body);
    expect(result.status, body).toBe(1);
    expect(result.output, body).toContain(
      "(HTTP 201): Supabase's answer holds no list of migration versions.",
    );
  }
});
