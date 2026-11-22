// Rule test: the release promotes its production build through Vercel's REST API
// (.github/scripts/release-promote.sh). The token never reaches a program's arguments, no Vercel
// CLI runs, a failed build gets exactly one redeploy, and the last line names the deployment.
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const script = resolve(import.meta.dir, '../../.github/scripts/release-promote.sh');
const TOKEN = 'vercel-token-that-must-stay-off-argv';
const SHA = 'abc123';
const PROJECT = 'prj_a';

// Answers like Vercel by URL. The production list is $STUB/list.json, a deployment's state
// $STUB/state-<id> (a missing one is BUILDING), and the alias serves the id in $STUB/served. A
// redeploy answers the id in $STUB/redeploy-id; a promote moves the alias. Each call's arguments
// land in $STUB/arguments, its method and URL in $STUB/requests, and the configs it read in $STUB/config.
const CURL_STUB = `#!/usr/bin/env bash
output=
method=GET
previous=
printf '%s\\n' "$*" >> "$STUB/arguments"
for argument in "$@"; do
  if test "$previous" = --output; then output="$argument"; fi
  if test "$previous" = -X; then method="$argument"; fi
  if test "$previous" = --config; then cat "$argument" >> "$STUB/config"; fi
  previous="$argument"
done
url="\${!#}"
echo "$method \${url%%\\?*}" >> "$STUB/requests"
answer() { echo "$1" > "$output"; printf 200; }
case "$method $url" in
  'GET '*'/v6/deployments?'*) answer "$(cat "$STUB/list.json")" ;;
  'GET '*'/v13/deployments/'*)
    id="\${url##*/v13/deployments/}"; id="\${id%%\\?*}"
    answer "{\\"readyState\\": \\"$(cat "$STUB/state-$id" 2> /dev/null || echo BUILDING)\\"}" ;;
  'POST '*'/v13/deployments?'*) answer "{\\"id\\": \\"$(cat "$STUB/redeploy-id")\\"}" ;;
  'POST '*'/promote/'*)
    id="\${url##*/promote/}"; echo "\${id%%\\?*}" > "$STUB/served"; answer '{}' ;;
  'GET '*'/v4/aliases/'*) answer "{\\"deploymentId\\": \\"$(cat "$STUB/served")\\"}" ;;
  *) printf 000; exit 7 ;;
esac
`;

let stub = '';

beforeEach(() => {
  stub = mkdtempSync(join(tmpdir(), 'release-promote-'));
  const programs = [
    ['curl', CURL_STUB],
    ['sleep', '#!/usr/bin/env bash\n'],
    // A Vercel CLI would hold the token in a process that runs third-party code.
    ['npx', '#!/usr/bin/env bash\necho "npx $*" >> "$STUB/cli"\n'],
    ['vercel', '#!/usr/bin/env bash\necho "vercel $*" >> "$STUB/cli"\n'],
  ] as const;
  for (const [name, body] of programs) {
    writeFileSync(join(stub, name), body);
    chmodSync(join(stub, name), 0o755);
  }
  writeFileSync(join(stub, 'served'), 'dpl_old');
});

afterEach(() => rmSync(stub, { recursive: true, force: true }));

const read = (name: string) =>
  existsSync(join(stub, name)) ? readFileSync(join(stub, name), 'utf8').trim().split('\n') : [];

/** Promotes SHA, whose production build is `id`, with the given build states. */
function promote(id: string, states: Record<string, string>) {
  writeFileSync(
    join(stub, 'list.json'),
    JSON.stringify({ deployments: [{ uid: id, meta: { githubCommitSha: SHA } }] }),
  );
  for (const [deployment, state] of Object.entries(states))
    writeFileSync(join(stub, `state-${deployment}`), state);
  const result = spawnSync('bash', [script, SHA], {
    encoding: 'utf8',
    env: {
      NODE_ENV: 'test',
      PATH: `${stub}:${process.env.PATH}`,
      STUB: stub,
      VERCEL_TOKEN: TOKEN,
      VERCEL_TEAM_ID: 'team_a',
      VERCEL_PROJECT_ID: PROJECT,
    },
  });
  const output = `${result.stdout}${result.stderr}`;
  return { status: result.status, output, lastLine: result.stdout.trim().split('\n').at(-1) };
}

test('the token reaches curl only as a config, never in a program argument, and no Vercel CLI runs', () => {
  writeFileSync(join(stub, 'redeploy-id'), 'dpl_again');
  const result = promote('dpl_new', { dpl_new: 'ERROR', dpl_again: 'READY' });
  expect(result.status, result.output).toBe(0);
  expect(read('arguments').length).toBeGreaterThan(0);
  for (const call of read('arguments')) expect(call).not.toContain(TOKEN);
  expect(read('config')).toContain(`header = "Authorization: Bearer ${TOKEN}"`);
  expect(read('cli')).toEqual([]);
  expect(result.output).not.toContain(TOKEN);
});

test('a ready build that production does not serve is promoted, and its id is the last line', () => {
  const result = promote('dpl_new', { dpl_new: 'READY' });
  expect(result.status, result.output).toBe(0);
  expect(read('requests')).toContain(`POST https://api.vercel.com/v10/projects/${PROJECT}/promote/dpl_new`);
  expect(result.output).toContain(`Production serves ${SHA} (dpl_new).`);
  expect(result.lastLine).toBe('dpl_new');
});

test('a build production serves already is not promoted again, and its id is the last line', () => {
  writeFileSync(join(stub, 'served'), 'dpl_new');
  const result = promote('dpl_new', { dpl_new: 'READY' });
  expect(result.status, result.output).toBe(0);
  expect(read('requests').filter((request) => request.includes('/promote/'))).toEqual([]);
  expect(result.output).toContain(`Production already serves ${SHA} (dpl_new).`);
  expect(result.lastLine).toBe('dpl_new');
});

test('a failed build is redeployed once to production, and the redeploy is promoted and named last', () => {
  writeFileSync(join(stub, 'redeploy-id'), 'dpl_again');
  const result = promote('dpl_new', { dpl_new: 'CANCELED', dpl_again: 'READY' });
  expect(result.status, result.output).toBe(0);
  const redeploys = read('arguments').filter((call) => call.includes('-X POST') && call.includes('/v13/'));
  expect(redeploys).toHaveLength(1);
  expect(redeploys[0]).toContain('"deploymentId":"dpl_new"');
  expect(redeploys[0]).toContain('"target":"production"');
  expect(read('requests')).toContain(`POST https://api.vercel.com/v10/projects/${PROJECT}/promote/dpl_again`);
  expect(result.lastLine).toBe('dpl_again');
});

test('a redeploy that fails too stops the release without a promote', () => {
  writeFileSync(join(stub, 'redeploy-id'), 'dpl_again');
  const result = promote('dpl_new', { dpl_new: 'ERROR', dpl_again: 'ERROR' });
  expect(result.status).toBe(1);
  expect(result.output).toContain(`The production build of ${SHA} failed twice (dpl_again).`);
  expect(read('requests').filter((request) => request.includes('/promote/'))).toEqual([]);
});

test('a refused promote fails the step instead of naming a deployment', () => {
  const refusing = CURL_STUB.replace(
    "'POST '*'/promote/'*)",
    "'POST '*'/promote/'*) printf 409; exit 0 ;;\n  'never')",
  );
  writeFileSync(join(stub, 'curl'), refusing);
  const result = promote('dpl_new', { dpl_new: 'READY' });
  expect(result.status).toBe(1);
  expect(result.output).toContain('Vercel did not promote dpl_new.');
  expect(result.lastLine).not.toBe('dpl_new');
});

test('a promote refused because production already serves the build passes when the alias, asked again, names it', () => {
  // The optional first lookup fails, so the script promotes the build production serves already;
  // Vercel refuses that, and the retried lookup shows the domain serves it.
  const refusing = CURL_STUB.replace(
    "'POST '*'/promote/'*)",
    "'POST '*'/promote/'*) printf 409; exit 0 ;;\n  'never')",
  ).replace(
    "'GET '*'/v4/aliases/'*)",
    '\'GET \'*\'/v4/aliases/\'*) if ! test -e "$STUB/looked"; then touch "$STUB/looked"; printf 503; exit 0; fi;',
  );
  writeFileSync(join(stub, 'curl'), refusing);
  writeFileSync(join(stub, 'served'), 'dpl_new');
  const result = promote('dpl_new', { dpl_new: 'READY' });
  expect(result.status, result.output).toBe(0);
  expect(result.output).toContain(
    'Vercel refused the promote, but app.werk-flow.app already serves dpl_new.',
  );
  expect(result.lastLine).toBe('dpl_new');
});
