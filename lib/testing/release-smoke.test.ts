// Rule test: the production smoke check counts a build's server errors from Vercel's request
// counts, and a response that holds no counts fails it instead of passing as zero errors.
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { z } from '../zod';

const repositoryRoot = resolve(import.meta.dir, '../..');
const smokeScript = join(repositoryRoot, '.github/scripts/release-smoke.sh');
const SERVED = 'dpl_served';

// Answers like Vercel, the login page and the health function; the metrics answer comes from
// $STUB/metrics.json, and its absence fails the request as `curl --fail` does. The metrics
// query it received lands in $STUB/query.json.
const CURL_STUB = `#!/usr/bin/env bash
output=
data=
previous=
for argument in "$@"; do
  if test "$previous" = --output; then output="$argument"; fi
  if test "$previous" = --data; then data="$argument"; fi
  previous="$argument"
done
url="\${!#}"
case "$url" in
  *'/v4/aliases/'*) echo '{"deploymentId":"${SERVED}"}' ;;
  *'/login') printf '<title>Anmelden</title><input type="password">' > "$output"; printf 200 ;;
  *'/health') printf 200 ;;
  *'/metrics/v1'*)
    printf '%s' "$data" > "$STUB/query.json"
    test -f "$STUB/metrics.json" || { touch "$STUB/metrics-refused"; exit 22; }
    cat "$STUB/metrics.json" ;;
  *) exit 7 ;;
esac
`;

let stub = '';

// The instant the stubbed `date +%s` reports: the window must end at its minute and start 15 minutes earlier.
const NOW_SECONDS = Date.UTC(2026, 10, 8, 13, 37, 42) / 1000;

beforeEach(() => {
  stub = mkdtempSync(join(tmpdir(), 'release-smoke-'));
  for (const [name, body] of [
    ['curl', CURL_STUB],
    ['sleep', '#!/usr/bin/env bash\n'],
    ['date', `#!/usr/bin/env bash\necho ${NOW_SECONDS}\n`],
  ] as const) {
    writeFileSync(join(stub, name), body);
    chmodSync(join(stub, name), 0o755);
  }
});

afterEach(() => rmSync(stub, { recursive: true, force: true }));

/** Runs the smoke check of the served build against a metrics answer, or a failed request without one. */
function smoke(metrics: unknown) {
  if (metrics === undefined) rmSync(join(stub, 'metrics.json'), { force: true });
  else writeFileSync(join(stub, 'metrics.json'), JSON.stringify(metrics));
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
  ] as const) {
    const result = smoke(metrics);
    expect(result.status, JSON.stringify(metrics)).toBe(1);
    expect(result.output, JSON.stringify(metrics)).toContain(reason);
    expect(result.output).not.toContain('answered no request with a server error');
  }
});

test('a failed metrics request fails the check', () => {
  // A response an earlier call left behind must not stand in for the failed request.
  writeFileSync(join(stub, 'metrics.json'), JSON.stringify({ queryId: 'left over' }));
  const result = smoke(undefined);
  expect(existsSync(join(stub, 'metrics-refused')), 'the stub refused the metrics request').toBe(true);
  expect(result.status).toBe(1);
  expect(result.output).toContain(`Vercel's request counts for ${SERVED} could not be read.`);
});

// The count is this build's alone, per status: without the filter it counts other builds, and
// without the grouping it cannot tell a server error from any other answer.
test('the query counts the served build per status', () => {
  expect(smoke({ summary: [row('200', 1)] }).status).toBe(0);
  const query = z
    .object({
      filter: z.string(),
      groupBy: z.array(z.string()),
      metrics: z.object({ value: z.object({ metric: z.string(), aggregation: z.string() }) }),
    })
    .parse(JSON.parse(readFileSync(join(stub, 'query.json'), 'utf8')));
  expect(query.filter).toBe(`deploymentId:${SERVED}`);
  expect(query.groupBy).toEqual(['httpStatus']);
  expect(query.metrics.value).toEqual({ metric: 'vercel.request.count', aggregation: 'count' });
});

// The window ends at the minute of the clock the script reads and starts 15 minutes earlier. GNU-only
// `date -d` left it empty on macOS while every other test still passed.
test('the query counts the last 15 minutes to the minute', () => {
  expect(smoke({ summary: [row('200', 1)] }).status).toBe(0);
  const { timeRange } = z
    .object({ timeRange: z.object({ start: z.string(), end: z.string() }) })
    .parse(JSON.parse(readFileSync(join(stub, 'query.json'), 'utf8')));
  expect(timeRange).toEqual({ start: '2026-11-08T13:22:00Z', end: '2026-11-08T13:37:00Z' });
});

test('the wait and the counted window are named as they run', () => {
  expect(smoke({ summary: [row('200', 1)] }).output).toContain(
    `Waiting 5 minutes, then counting the server errors of ${SERVED} in the last 15 minutes.`,
  );
});
