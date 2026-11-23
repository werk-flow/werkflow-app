// The merge queue as the CI App (lib/testing/ci/check-app.ts): its `Queue` mark is the App's check
// run, and it reads a PR head's `Check` only from the App's newest check run.
import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { appCheckStateOf, postCheckRun, queueCheckRunOf } from './check-app';

const repositoryRoot = resolve(import.meta.dir, '../../..');
const APP = 4242;
const OTHER_APP = 999;
const TOKEN = 'ghs_installation-token-under-test';
const RUN_URL = 'https://ci.test/queue/7';
const HEAD = 'b'.repeat(40);

test("the queue's mark is the App's completed Queue check run on the PR head, passed or withdrawn", async () => {
  const now = new Date('2026-11-21T09:00:00Z');
  for (const passed of [true, false]) {
    const mark = queueCheckRunOf({ runUrl: RUN_URL, head: HEAD, passed, now });
    if (!('request' in mark)) throw new Error(mark.problem);
    const conclusion = passed ? 'success' : 'failure';
    expect(mark.request).toMatchObject({
      name: 'Queue',
      head_sha: HEAD,
      status: 'completed',
      conclusion,
      details_url: RUN_URL,
      external_id: RUN_URL,
    });
    const post = async (appId: number) => {
      const sent: string[] = [];
      const posted = await postCheckRun({
        request: mark.request,
        appId: APP,
        token: TOKEN,
        repository: 'owner/repo',
        fetch: async (url, init) => {
          sent.push(`${init.method} ${url}`);
          const answer = { id: 77, name: 'Queue', head_sha: HEAD, conclusion, app: { id: appId } };
          return Response.json(answer, { status: 201 });
        },
      });
      return { posted, sent };
    };
    expect(await post(APP)).toEqual({
      posted: { id: 77 },
      sent: ['POST https://api.github.com/repos/owner/repo/check-runs'],
    });
    expect((await post(OTHER_APP)).posted).toHaveProperty('problem');
  }
  expect(queueCheckRunOf({ runUrl: RUN_URL, head: 'main', passed: true, now })).toEqual({
    problem: 'main is no commit id',
  });
});

test("the queue reads a PR head's Check from the App's newest check run, never another app's", () => {
  const run = (id: number, status: string, conclusion: string | null, appId = APP) => ({
    id,
    status,
    conclusion,
    app: { id: appId },
  });
  const pages = (...runs: ReturnType<typeof run>[][]) =>
    runs.map((page) => ({ total_count: runs.flat().length, check_runs: page }));
  expect(appCheckStateOf(pages([]), APP)).toBe('MISSING');
  expect(appCheckStateOf(pages([run(9, 'completed', 'success', OTHER_APP)]), APP)).toBe('MISSING');
  // A newer queued start withdraws an older pass; the newest decides across pages and in any order.
  expect(appCheckStateOf(pages([run(4, 'completed', 'success')], [run(6, 'queued', null)]), APP)).toBe(
    'PENDING',
  );
  const newerPass = [run(6, 'completed', 'success'), run(4, 'completed', 'failure')];
  expect(appCheckStateOf(pages([...newerPass, run(8, 'completed', 'failure', OTHER_APP)]), APP)).toBe(
    'SUCCESS',
  );
  const newerCancel = [run(4, 'completed', 'success'), run(6, 'completed', 'cancelled')];
  expect(appCheckStateOf(pages(newerCancel), APP)).toBe('FAILURE');
  // A list GitHub cut short could hide the newest run.
  expect(() =>
    appCheckStateOf([{ total_count: 2, check_runs: [run(4, 'completed', 'success')] }], APP),
  ).toThrow('GitHub listed 1 of 2 Check runs.');
  expect(() => appCheckStateOf([], APP)).toThrow();
});

test("the publisher's queue mode takes only success or failure and prints no token", () => {
  for (const state of [undefined, 'passed']) {
    const run = spawnSync(
      process.execPath,
      [join(repositoryRoot, 'scripts/ci/publish-check.ts'), 'queue', ...(state ? [state] : [])],
      {
        encoding: 'utf8',
        env: {
          NODE_ENV: 'test',
          PATH: process.env.PATH,
          CI_RUN_URL: RUN_URL,
          CI_COMMIT: HEAD,
          CI_CHECK_APP_TOKEN: TOKEN,
          GITHUB_REPOSITORY: 'owner/repo',
        },
      },
    );
    expect(run.status, String(state)).not.toBe(0);
    expect(run.stderr, String(state)).toContain('Usage: bun scripts/ci/publish-check.ts');
    expect(run.stdout + run.stderr).not.toContain(TOKEN);
  }
});
