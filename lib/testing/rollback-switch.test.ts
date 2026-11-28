// Rule test: a rollback switches the domain to exactly the planned build with Vercel's Instant
// Rollback (.github/scripts/rollback-switch.sh): never a promote, never a rebuild, only a ready
// build, and a build that serves already is left alone so a retry resumes.
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const script = resolve(import.meta.dir, '../../.github/scripts/rollback-switch.sh');

// Answers like Vercel: a build's state is $STUB/state, the alias serves $STUB/served, and a rollback
// moves the alias. Each method and URL lands in $STUB/requests.
const CURL_STUB = `#!/usr/bin/env bash
output=
method=GET
previous=
for argument in "$@"; do
  if test "$previous" = --output; then output="$argument"; fi
  if test "$previous" = -X; then method="$argument"; fi
  previous="$argument"
done
url="\${!#}"
echo "$method \${url%%\\?*}" >> "$STUB/requests"
answer() { echo "$1" > "$output"; printf 200; }
case "$method $url" in
  'GET '*'/v13/deployments/'*) answer "{\\"readyState\\": \\"$(cat "$STUB/state")\\"}" ;;
  'GET '*'/v4/aliases/'*) answer "{\\"deploymentId\\": \\"$(cat "$STUB/served")\\"}" ;;
  'POST '*'/rollback/'*)
    id="\${url##*/rollback/}"; echo "\${id%%\\?*}" > "$STUB/served"; answer '{}' ;;
  *) printf 000; exit 7 ;;
esac
`;

let stub = '';

beforeEach(() => {
  stub = mkdtempSync(join(tmpdir(), 'rollback-switch-'));
  for (const [name, body] of [
    ['curl', CURL_STUB],
    ['sleep', '#!/usr/bin/env bash\n'],
  ] as const) {
    writeFileSync(join(stub, name), body);
    chmodSync(join(stub, name), 0o755);
  }
});

afterEach(() => rmSync(stub, { recursive: true, force: true }));

function rollBack(state: string, served: string) {
  writeFileSync(join(stub, 'state'), state);
  writeFileSync(join(stub, 'served'), served);
  const result = spawnSync('bash', [script, 'dpl_old'], {
    encoding: 'utf8',
    env: {
      NODE_ENV: 'test',
      PATH: `${stub}:${process.env.PATH}`,
      STUB: stub,
      VERCEL_TOKEN: 'token',
      VERCEL_TEAM_ID: 'team_a',
      VERCEL_PROJECT_ID: 'prj_a',
    },
  });
  const requests = existsSync(join(stub, 'requests'))
    ? readFileSync(join(stub, 'requests'), 'utf8').trim().split('\n')
    : [];
  return { status: result.status, output: `${result.stdout}${result.stderr}`, requests };
}

test('a ready build is switched to with an Instant Rollback, never a promote or a rebuild', () => {
  const result = rollBack('READY', 'dpl_bad');
  expect(result.status, result.output).toBe(0);
  expect(result.requests).toContain('POST https://api.vercel.com/v1/projects/prj_a/rollback/dpl_old');
  expect(
    result.requests.filter(
      (request) => request.includes('/promote/') || request.startsWith('POST https://api.vercel.com/v13'),
    ),
  ).toEqual([]);
  expect(result.output).toContain('app.werk-flow.app serves dpl_old.');
});

test('a build that serves already is left alone, so a retry resumes', () => {
  const result = rollBack('READY', 'dpl_old');
  expect(result.status, result.output).toBe(0);
  expect(result.requests.filter((request) => request.startsWith('POST'))).toEqual([]);
});

test('a build that is not ready is refused before any switch', () => {
  const result = rollBack('ERROR', 'dpl_bad');
  expect(result.status).toBe(1);
  expect(result.output).toContain('not READY');
  expect(result.requests.filter((request) => request.startsWith('POST'))).toEqual([]);
});
