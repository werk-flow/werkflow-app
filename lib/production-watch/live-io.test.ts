// The watcher's live reads and writes print no body, header or token, and hand no child process the
// Vercel token (lib/production-watch/live-io.ts). The job's log is public.
import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

import { liveIo, TOKEN_VARIABLE } from './live-io';

const TOKEN = 'made-up-vercel-token-0123456789';
const ENV: NodeJS.ProcessEnv = {
  NODE_ENV: 'test',
  [TOKEN_VARIABLE]: TOKEN,
  GH_TOKEN: 'made-up-github-token',
  GH_REPO: 'owner/repo',
  PATH: '/usr/bin',
};

type Spawned = { command: string; args: readonly string[]; env: NodeJS.ProcessEnv; output: boolean };

function fakeSpawn(status: number, stdout = '') {
  const calls: Spawned[] = [];
  const spawn: Parameters<typeof liveIo>[2] = (command, args, { env, output }) => {
    calls.push({ command, args, env, output });
    return { status, stdout };
  };
  return { spawn, calls };
}

const answering =
  (status: number, body: string): Parameters<typeof liveIo>[1] =>
  async () =>
    new Response(body, { status });

async function failure(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return error instanceof Error ? error.message : 'not an Error';
  }
  throw new Error('the call did not fail');
}

test('a refused Vercel call names its path and status, never the body, the query or the token', async () => {
  const body = JSON.stringify({
    error: { code: 'forbidden', message: `token ${TOKEN} lacks access to secret-route` },
  });
  const io = liveIo(ENV, answering(403, body), fakeSpawn(0).spawn);
  const message = await failure(io.vercel('/v6/deployments?projectId=prj_x&teamId=team_y'));
  expect(message).toBe('Vercel answered 403 to /v6/deployments');
  const detail = await failure(io.vercel('/v13/deployments/dpl_not_for_the_log?teamId=team_y'));
  expect(detail).toBe('Vercel answered 403 to /v13/deployments/{id}');
});

test('an answer that is no JSON, a missing answer and a missing token fail with fixed text', async () => {
  const garbled = liveIo(ENV, answering(200, 'deployment log line of a customer'), fakeSpawn(0).spawn);
  expect(await failure(garbled.vercel('/v4/aliases/app.werk-flow.app?teamId=team_y'))).toBe(
    "Vercel's answer to /v4/aliases/app.werk-flow.app is no JSON",
  );
  const silent: Parameters<typeof liveIo>[1] = async () => {
    throw new TypeError(`fetch failed for ${TOKEN}`);
  };
  expect(await failure(liveIo(ENV, silent, fakeSpawn(0).spawn).vercel('/metrics/v1?teamId=team_y', {}))).toBe(
    'Vercel did not answer /metrics/v1: TypeError',
  );
  const unset = liveIo({ ...ENV, [TOKEN_VARIABLE]: '' }, answering(200, '{}'), fakeSpawn(0).spawn);
  expect(await failure(unset.vercel('/v6/deployments'))).toBe(
    'PROD_WATCH_VERCEL_TOKEN is not set; the GitHub environment production holds it',
  );
});

test('the token goes only in the Authorization header of a Vercel call', async () => {
  const seen: { url: string; init: RequestInit }[] = [];
  const recording: Parameters<typeof liveIo>[1] = async (url, init) => {
    seen.push({ url, init });
    return new Response('{"deploymentId":"dpl_a"}', { status: 200 });
  };
  const io = liveIo(ENV, recording, fakeSpawn(0).spawn);
  expect(await io.vercel('/v4/aliases/app.werk-flow.app?teamId=team_y')).toEqual({ deploymentId: 'dpl_a' });
  expect(seen[0]?.url).toBe('https://api.vercel.com/v4/aliases/app.werk-flow.app?teamId=team_y');
  expect(seen[0]?.url).not.toContain(TOKEN);
  expect(new Headers(seen[0]?.init?.headers).get('Authorization')).toBe(`Bearer ${TOKEN}`);
});

test('gh and the alert script get GitHub’s token, never the Vercel token, and an alert assigns the owner', async () => {
  const { spawn, calls } = fakeSpawn(0, 'Production alert: deploy\nCI alert: nightly\n');
  const io = liveIo(ENV, answering(200, '{}'), spawn);
  expect(await io.openTitles()).toEqual(new Set(['Production alert: deploy', 'CI alert: nightly']));
  await io.act('Production alert: deploy', 'keep', 'a note');
  expect(calls.map((call) => [call.command, ...call.args])).toEqual([
    [
      'gh',
      'api',
      '--paginate',
      'repos/owner/repo/issues?state=open&labels=ci-alert&per_page=100',
      '--jq',
      '.[].title',
    ],
    ['bash', '.github/scripts/alert-issue.sh', 'keep', 'Production alert: deploy', 'a note'],
  ]);
  for (const call of calls) {
    expect(JSON.stringify(call.env)).not.toContain(TOKEN);
    expect(call.env).toMatchObject({ GH_TOKEN: 'made-up-github-token', GH_REPO: 'owner/repo' });
  }
  expect(calls[1]?.env).toMatchObject({ AFFECTS_PRODUCTION: 'true' });
  // The alert script's own output stays out of the public log; only gh's answer is read.
  expect(calls.map((call) => call.output)).toEqual([true, false]);
});

test('a failed gh read or alert write fails with fixed text', async () => {
  const io = liveIo(ENV, answering(200, '{}'), fakeSpawn(1).spawn);
  expect(await failure(io.productionHead())).toBe('gh failed to read the head of production (exit 1)');
  expect(await failure(io.act('Production alert: watcher', 'close', 'a note'))).toBe(
    '.github/scripts/alert-issue.sh close "Production alert: watcher" failed (exit 1)',
  );
});

test('a program the watcher runs prints nothing to the log, and only an asked-for output is read', () => {
  const script =
    `import { runProgram } from ${JSON.stringify(join(import.meta.dir, 'live-io.ts'))};\n` +
    "const quiet = runProgram('bash', ['-c', 'echo out; echo err >&2'], { env: process.env, output: false });\n" +
    "const read = runProgram('bash', ['-c', 'echo answer; echo err >&2; exit 3'], { env: process.env, output: true });\n" +
    'console.log(JSON.stringify([quiet, read]));\n';
  const run = spawnSync('bun', ['-e', script], { encoding: 'utf8' });
  expect(run.stderr).toBe('');
  expect(run.stdout).toBe('[{"status":0,"stdout":""},{"status":3,"stdout":"answer\\n"}]\n');
});
