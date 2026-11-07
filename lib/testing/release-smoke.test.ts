// Rule test: the production smoke check counts a build's server errors from Vercel's request
// counts, and a response that holds no counts fails it instead of passing as zero errors.
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const repositoryRoot = resolve(import.meta.dir, '../..');
const smokeScript = join(repositoryRoot, '.github/scripts/release-smoke.sh');
const SERVED = 'dpl_served';

// Answers like Vercel, the login page and the health function; the metrics answer comes from
// $STUB/metrics.json, and its absence fails the request as `curl --fail` does.
const CURL_STUB = `#!/usr/bin/env bash
output=
previous=
for argument in "$@"; do
  if test "$previous" = --output; then output="$argument"; fi
  previous="$argument"
done
url="\${!#}"
case "$url" in
  *'/v4/aliases/'*) echo '{"deploymentId":"${SERVED}"}' ;;
  *'/login') printf '<title>Anmelden</title><input type="password">' > "$output"; printf 200 ;;
  *'/health') printf 200 ;;
  *'/metrics/v1'*) test -f "$STUB/metrics.json" || exit 22; cat "$STUB/metrics.json" ;;
  *) exit 7 ;;
esac
`;

let stub = '';

beforeEach(() => {
  stub = mkdtempSync(join(tmpdir(), 'release-smoke-'));
  for (const [name, body] of [
    ['curl', CURL_STUB],
    ['sleep', '#!/usr/bin/env bash\n'],
  ] as const) {
    writeFileSync(join(stub, name), body);
    chmodSync(join(stub, name), 0o755);
  }
});

afterEach(() => rmSync(stub, { recursive: true, force: true }));

/** Runs the smoke check of the served build against a metrics answer, or none. */
function smoke(metrics: unknown) {
  if (metrics !== undefined) writeFileSync(join(stub, 'metrics.json'), JSON.stringify(metrics));
  const result = spawnSync('bash', [smokeScript, SERVED], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: {
      NODE_ENV: 'test',
      PATH: `${stub}:${process.env.PATH}`,
      STUB: stub,
      RUNNER_TEMP: stub,
      VERCEL_TOKEN: 'token',
      VERCEL_TEAM_ID: 'team_a',
      VERCEL_PROJECT_ID: 'prj_a',
      APP_URL: 'https://app.example.test',
      HEALTH_URL: 'https://functions.example.test/health',
      HEALTH_CHECK_TOKEN: 'health',
    },
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

const row = (httpStatus: string, value: unknown) => ({ dimensions: { httpStatus }, values: { value } });

test('a build that answered only without server errors passes', () => {
  const result = smoke({ summary: [row('200', 3), row('307', 1)] });
  expect(result.output).toContain(
    `${SERVED} answered no request with a server error in the last 15 minutes.`,
  );
  expect(result.status, result.output).toBe(0);
});

test('server errors of the build fail the check with their count', () => {
  const result = smoke({ summary: [row('200', 3), row('500', 2), row('504', 1)] });
  expect(result.output).toContain(
    `${SERVED} answered 3 requests with a server error in the last 15 minutes.`,
  );
  expect(result.status).toBe(1);
});

test('a response without counts fails the check, never as zero errors', () => {
  for (const [metrics, reason] of [
    [{ summary: [] }, 'Vercel counts no request of'],
    [{ queryId: 'q' }, 'could not be read'],
    [{ summary: [row('200', null)] }, 'could not be read'],
    [{ summary: [{ dimensions: {}, values: { value: 1 } }] }, 'could not be read'],
    [undefined, 'could not be read'],
  ] as const) {
    const result = smoke(metrics);
    expect(result.status, JSON.stringify(metrics)).toBe(1);
    expect(result.output, JSON.stringify(metrics)).toContain(reason);
    expect(result.output).not.toContain('answered no request with a server error');
  }
});

test('the wait and the counted window are named as they run', () => {
  expect(smoke({ summary: [row('200', 1)] }).output).toContain(
    `Waiting 5 minutes, then counting the server errors of ${SERVED} in the last 15 minutes.`,
  );
});
