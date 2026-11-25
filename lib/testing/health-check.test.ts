// Rule test: a health check hands its credential to curl and psql outside their arguments, which
// any local user of a shared runner reads in /proc/<pid>/cmdline.
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const script = resolve(import.meta.dir, '../../.github/scripts/health-check.sh');

// Records each program's arguments, psql's PGPASSWORD, and the curl configs it read.
const STUBS = {
  psql: `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$STUB/arguments"
printf '%s' "$PGPASSWORD" > "$STUB/pgpassword"
`,
  curl: `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$STUB/arguments"
previous=
for argument in "$@"; do
  if test "$previous" = --config; then cat "$argument" >> "$STUB/config"; fi
  previous="$argument"
done
printf 200
`,
};

let stub = '';

beforeEach(() => {
  stub = mkdtempSync(join(tmpdir(), 'health-check-'));
  for (const [name, body] of Object.entries(STUBS)) {
    writeFileSync(join(stub, name), body);
    chmodSync(join(stub, name), 0o755);
  }
});

afterEach(() => rmSync(stub, { recursive: true, force: true }));

function check(kind: string, value: string, argument = '') {
  const result = spawnSync('bash', [script, 'dev', 'proof', kind, 'CREDENTIAL', argument], {
    encoding: 'utf8',
    env: {
      NODE_ENV: 'test',
      PATH: `${stub}:${process.env.PATH ?? ''}`,
      STUB: stub,
      RUNNER_TEMP: stub,
      CREDENTIAL: value,
    },
  });
  const read = (name: string) => (existsSync(join(stub, name)) ? readFileSync(join(stub, name), 'utf8') : '');
  return {
    status: result.status,
    output: `${result.stdout}${result.stderr}`,
    arguments: read('arguments'),
    pgpassword: read('pgpassword'),
    config: read('config'),
  };
}

test('psql gets the URL without its password, and the decoded password through PGPASSWORD', () => {
  const result = check(
    'database',
    'postgresql://user.ref:p%40ss%5Cw%0A@db.example.test:5432/postgres?sslmode=require',
  );
  expect(result.status, result.output).toBe(0);
  expect(result.arguments).toStartWith(
    'postgresql://user.ref@db.example.test:5432/postgres?sslmode=require ',
  );
  expect(result.arguments).not.toContain('p%40ss');
  expect(result.pgpassword).toBe('p@ss\\w\n');
});

test('a connection string that could carry a credential elsewhere fails before psql runs', () => {
  for (const value of [
    'postgresql://user@db.example.test/postgres?password=secret',
    'postgresql://user@db.example.test/postgres?%70assword=secret',
    'postgresql://user@db.example.test/postgres?sslpassword=secret',
    'host=db.example.test user=user password=secret',
    'postgresql://user:se@cret@db.example.test/postgres',
    'postgresql://:secret@db.example.test/postgres',
    'postgresql://user:sec\nret@db.example.test/postgres',
  ]) {
    const result = check('database', value);
    expect(result.status, value).toBe(1);
    expect(result.arguments, value).toBe('');
  }
});

test('a bearer token and an endpoint token reach curl in its config, never in its arguments', () => {
  const bearer = check('bearer', 'bearer-token-value', 'https://api.example.test/');
  expect(bearer.status, bearer.output).toBe(0);
  const endpoint = check('endpoint', 'endpoint-token-value', 'https://app.example.test/api/health');
  expect(endpoint.status, endpoint.output).toBe(0);
  expect(endpoint.arguments).not.toContain('token-value');
  expect(endpoint.config).toBe(
    'header = "Authorization: Bearer bearer-token-value"\nheader = "x-health-check-token: endpoint-token-value"\n',
  );
});
