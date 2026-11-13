// Rule test: the staging deploy (.github/scripts/staging-deploy.sh, through vercel-api.sh) never
// polls a deployment Vercel refused to create. A refusal fails at once with Vercel's error code
// and message, a rate limit waits and retries within its budget, and a failed poll stops the step.
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const script = resolve(import.meta.dir, '../../.github/scripts/staging-deploy.sh');
const TOKEN = 'token-that-must-never-print';
const SHA = 'abc123';

// Answers like curl with --output, --dump-header and --write-out: the n-th request gets
// $STUB/answer-<n>.json ({status, headers, body, takes, exit}); a request without an answer fails
// to connect. A request moves the fake clock ($STUB/clock, read by the date stub) by its `takes`
// seconds, and the sleep stub moves it by the seconds it was asked to wait.
const CURL_STUB = `#!/usr/bin/env bash
output=
headers=
previous=
for argument in "$@"; do
  if test "$previous" = --output; then output="$argument"; fi
  if test "$previous" = --dump-header; then headers="$argument"; fi
  previous="$argument"
done
echo "\${!#}" >> "$STUB/requests.log"
count=$(($(cat "$STUB/count" 2> /dev/null || echo 0) + 1))
echo "$count" > "$STUB/count"
answer="$STUB/answer-$count.json"
test -f "$answer" || { printf 000; exit 7; }
echo $(($(cat "$STUB/clock") + $(jq '.takes' "$answer"))) > "$STUB/clock"
jq -r '.headers[]' "$answer" > "$headers"
jq -c '.body' "$answer" > "$output"
jq -j '.status' "$answer"
exit "$(jq '.exit' "$answer")"
`;

const SLEEP_STUB = `#!/usr/bin/env bash
echo "$1" >> "$STUB/sleep.log"
echo $(($(cat "$STUB/clock") + $1)) > "$STUB/clock"
`;

type Answer = { status: number; headers?: string[]; body: unknown; takes?: number; exit?: number };

let stub = '';

beforeEach(() => {
  stub = mkdtempSync(join(tmpdir(), 'staging-deploy-'));
  writeFileSync(join(stub, 'curl'), CURL_STUB);
  writeFileSync(join(stub, 'sleep'), SLEEP_STUB);
  writeFileSync(join(stub, 'date'), '#!/usr/bin/env bash\ncat "$STUB/clock"\n');
  for (const name of ['curl', 'sleep', 'date']) chmodSync(join(stub, name), 0o755);
  writeFileSync(join(stub, 'clock'), '1000');
});

afterEach(() => rmSync(stub, { recursive: true, force: true }));

/** Runs the deploy against the given answers, in request order, and fails the test if the token prints. */
function deploy(answers: Answer[]) {
  for (const [index, answer] of answers.entries())
    writeFileSync(
      join(stub, `answer-${index + 1}.json`),
      JSON.stringify({ headers: [], takes: 0, exit: 0, ...answer }),
    );
  const result = spawnSync('bash', [script, SHA], {
    encoding: 'utf8',
    env: {
      NODE_ENV: 'test',
      PATH: `${stub}:${process.env.PATH}`,
      STUB: stub,
      VERCEL_TOKEN: TOKEN,
      GITHUB_REPOSITORY_ID: '42',
    },
  });
  const output = `${result.stdout}${result.stderr}`;
  expect(output).not.toContain(TOKEN);
  const read = (name: string) =>
    existsSync(join(stub, name)) ? readFileSync(join(stub, name), 'utf8').trim().split('\n') : [];
  return { status: result.status, output, requests: read('requests.log'), sleeps: read('sleep.log') };
}

const created = { status: 200, body: { id: 'dpl_new', readyState: 'QUEUED' } };
const ready = { status: 200, body: { id: 'dpl_new', readyState: 'READY' } };
const rateLimited = (headers: string[] = []) => ({
  status: 429,
  headers,
  body: { error: { code: 'rate_limited', message: 'GitHub API rate limit exceeded.' } },
});

test('a created deployment is polled by its id until it is ready', () => {
  const result = deploy([created, { status: 200, body: { readyState: 'BUILDING' } }, ready]);
  expect(result.status, result.output).toBe(0);
  expect(result.output).toContain(`Staging deployment dpl_new of ${SHA}.`);
  expect(result.output).toContain(`Staging serves ${SHA}.`);
  expect(result.requests[0]).toStartWith('https://api.vercel.com/v13/deployments?teamId=');
  expect(result.requests.slice(1)).toEqual([
    expect.stringContaining('/v13/deployments/dpl_new?'),
    expect.stringContaining('/v13/deployments/dpl_new?'),
  ]);
});

test('a refused create fails at once with Vercel’s error code and message, and polls nothing', () => {
  const result = deploy([
    { status: 400, body: { error: { code: 'bad_request', message: 'Invalid gitSource.' } } },
  ]);
  expect(result.status).toBe(1);
  expect(result.output).toContain('Vercel answered HTTP 400 (bad_request: Invalid gitSource.).');
  expect(result.output).toContain(`Vercel did not create the staging deployment of ${SHA}.`);
  expect(result.requests).toHaveLength(1);
  expect(result.sleeps).toEqual([]);
});

test('a rate-limited create waits the retry-after seconds, says why, and goes on', () => {
  const result = deploy([rateLimited(['HTTP/2 429\r', 'retry-after: 7\r']), created, ready]);
  expect(result.status, result.output).toBe(0);
  expect(result.output).toContain(
    'Vercel answered HTTP 429 (rate_limited: GitHub API rate limit exceeded.); retrying in 7 seconds.',
  );
  expect(result.sleeps).toEqual(['7']);
});

test('a create still rate-limited after about 20 minutes of backoff fails with the reason', () => {
  const result = deploy(Array.from({ length: 5 }, () => rateLimited()));
  expect(result.status).toBe(1);
  expect(result.sleeps).toEqual(['60', '120', '240', '480']);
  expect(result.output).toContain(
    'Vercel answered HTTP 429 (rate_limited: GitHub API rate limit exceeded., still after 900 seconds).',
  );
  expect(result.requests).toHaveLength(5);
});

test('the retry budget counts the time requests take, not only the waits', () => {
  const slow = { ...rateLimited(['retry-after: 1']), takes: 400 };
  const result = deploy([slow, slow, slow, created]);
  expect(result.status).toBe(1);
  expect(result.sleeps).toEqual(['1', '1']);
  expect(result.output).toContain('still after 1202 seconds).');
  expect(result.requests).toHaveLength(3);
});

test('an answer that did not arrive whole fails, even with a 2xx status', () => {
  const result = deploy([{ ...created, exit: 18 }]);
  expect(result.status).toBe(1);
  expect(result.output).toContain("Vercel's answer did not arrive (HTTP 200, curl exit 18).");
  expect(result.output).not.toContain('Staging deployment dpl_new');
});

test('an answer without an id fails instead of polling an empty one', () => {
  for (const body of [{}, { id: null }]) {
    rmSync(join(stub, 'count'), { force: true });
    rmSync(join(stub, 'requests.log'), { force: true });
    const result = deploy([{ status: 200, body }]);
    expect(result.status, JSON.stringify(body)).toBe(1);
    expect(result.output).toContain(`Vercel's answer names no staging deployment of ${SHA}.`);
    expect(result.requests).toHaveLength(1);
  }
});

test('a refused or unreachable poll stops the deploy at once', () => {
  const refused = deploy([
    created,
    { status: 404, body: { error: { code: 'not_found', message: 'Not found.' } } },
  ]);
  expect(refused.status).toBe(1);
  expect(refused.output).toContain('Vercel answered HTTP 404 (not_found: Not found.).');
  expect(refused.output).toContain('Vercel did not report the staging build dpl_new.');
  expect(refused.requests).toHaveLength(2);

  rmSync(join(stub, 'answer-2.json'));
  rmSync(join(stub, 'count'));
  rmSync(join(stub, 'requests.log'));
  const unreachable = deploy([created]);
  expect(unreachable.status).toBe(1);
  expect(unreachable.output).toContain("Vercel's answer did not arrive (HTTP 000, curl exit 7).");
  expect(unreachable.requests).toHaveLength(2);
});

test('a build that ends in an error fails the deploy', () => {
  const result = deploy([created, { status: 200, body: { readyState: 'ERROR' } }]);
  expect(result.status).toBe(1);
  expect(result.output).toContain('The staging build dpl_new ended ERROR.');
});
