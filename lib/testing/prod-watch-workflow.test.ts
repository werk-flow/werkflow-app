// The production watcher runs on GitHub, on main only, with its Vercel token in the environment
// `production` and in one step, without an install, and keeps its state between passes
// (.github/workflows/prod-watch.yml, docs/technical/recovery-and-incidents.md#monitoring).
import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { readWorkflow, workflowsFolder } from './ci-workflow';
import { temporaryDirectory } from './temporary-directory';

const watcher = readWorkflow('prod-watch.yml');
const repositoryRoot = resolve(import.meta.dir, '../..');
const PASS = 'Watch production';
// A variable, so knip reads no import of it here.
const SCRIPT = 'scripts/prod-watch.ts';
const STATE_KEY = 'prod-watch-${{ github.run_id }}-${{ github.run_attempt }}';

const steps = (): Record<string, unknown>[] => {
  const list = watcher.at('jobs', 'watch', 'steps');
  return Array.isArray(list) ? list : [];
};

test('it runs every 10 minutes and by hand, on main only, one pass at a time', () => {
  expect(watcher.at('on', 'schedule')).toEqual([{ cron: '*/10 * * * *' }]);
  expect(watcher.at('on', 'workflow_dispatch')).toBeNull();
  expect(watcher.at('jobs', 'watch', 'if')).toBe("github.ref == 'refs/heads/main'");
  expect(watcher.at('concurrency')).toEqual({ group: 'prod-watch', 'cancel-in-progress': false });
});

test('the token stays in the environment production and reaches only the pass', () => {
  expect(watcher.at('permissions')).toEqual({});
  expect(watcher.at('jobs', 'watch', 'environment')).toEqual({ name: 'production', deployment: false });
  expect(watcher.at('jobs', 'watch', 'permissions')).toEqual({ contents: 'read', issues: 'write' });
  expect(watcher.at('jobs', 'watch', 'env')).toBeUndefined();
  expect(watcher.step('watch', PASS).env).toEqual({
    PROD_WATCH_VERCEL_TOKEN: '${{ secrets.PROD_WATCH_VERCEL_TOKEN }}',
    GH_TOKEN: '${{ github.token }}',
    GH_REPO: '${{ github.repository }}',
  });
  expect(watcher.step('watch', PASS).run).toBe('bun scripts/prod-watch.ts .prod-watch/state.json');
  const workflow = readFileSync(join(repositoryRoot, workflowsFolder(), 'prod-watch.yml'), 'utf8');
  expect(workflow.match(/secrets\./g)).toHaveLength(1);
  // The repository's VERCEL_TOKEN deploys staging and promotes releases; the watcher never gets it.
  expect(workflow).not.toContain('secrets.VERCEL_TOKEN');
  for (const step of steps()) expect(String(step.run ?? '')).not.toContain('${{');
});

test('each pass restores the newest saved state and saves its own, a failed pass too', () => {
  const [checkout, bun, restore, pass, save] = steps();
  expect(checkout?.with).toMatchObject({ 'persist-credentials': false });
  expect(String(bun?.uses)).toStartWith('oven-sh/setup-bun@');
  expect(String(restore?.uses)).toStartWith('actions/cache/restore@');
  expect(restore?.with).toEqual({ path: '.prod-watch', key: STATE_KEY, 'restore-keys': 'prod-watch-' });
  expect(pass?.name).toBe(PASS);
  expect(String(save?.uses)).toStartWith('actions/cache/save@');
  expect(save?.with).toEqual({ path: '.prod-watch', key: STATE_KEY });
  expect(save?.if).toBe("${{ !cancelled() && steps.watch.outcome != 'skipped' }}");
  expect(steps()).toHaveLength(5);
});

test('the pass runs from the sparse checkout without an install: it imports only Node and its own folders', () => {
  const sparse = String(watcher.at('jobs', 'watch', 'steps', 0, 'with', 'sparse-checkout'))
    .trim()
    .split('\n');
  expect(sparse).toEqual(['.github/scripts', 'lib/production-watch', 'scripts']);
  const sources = [
    'scripts/prod-watch.ts',
    ...readdirSync(join(repositoryRoot, 'lib/production-watch'))
      .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
      .map((name) => `lib/production-watch/${name}`),
  ];
  for (const source of sources) {
    const imports = [...readFileSync(join(repositoryRoot, source), 'utf8').matchAll(/from '([^']+)'/g)].map(
      (m) => m[1] ?? '',
    );
    for (const target of imports) {
      if (target.startsWith('node:')) continue;
      const resolved = resolve(repositoryRoot, source, '..', target);
      expect(
        sparse.some((folder) => resolved.startsWith(join(repositoryRoot, folder))),
        `${source} imports ${target}`,
      ).toBe(true);
    }
  }
  expect(existsSync(join(repositoryRoot, '.github/scripts/alert-issue.sh'))).toBe(true);
});

test('without its token a pass fails with a fixed verdict, counts the failure and writes no alert', () => {
  const folder = temporaryDirectory('prod-watch-');
  const calls = join(folder, 'calls');
  // gh answers with no open alert; the pass must stop at the token before any Vercel call.
  writeFileSync(join(folder, 'gh'), `#!/usr/bin/env bash\necho "gh $*" >> '${calls}'\n`);
  chmodSync(join(folder, 'gh'), 0o755);
  const state = join(folder, 'state', 'state.json');
  const run = spawnSync('bun', [SCRIPT, state], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: {
      NODE_ENV: 'test',
      PATH: `${folder}:${process.env.PATH}`,
      GH_REPO: 'owner/repo',
      PROD_WATCH_VERCEL_TOKEN: '',
    },
  });
  expect(run.status).toBe(1);
  expect(run.stdout).toBe(
    'production: production watcher failed (1 in a row): PROD_WATCH_VERCEL_TOKEN is not set; the GitHub environment production holds it\n' +
      'production: the pass failed\n',
  );
  expect(JSON.parse(readFileSync(state, 'utf8'))).toMatchObject({ failures: 1, watcherReported: false });
  expect(readFileSync(calls, 'utf8')).toBe(
    'gh api --paginate repos/owner/repo/issues?state=open&labels=ci-alert&per_page=100 --jq .[].title\n',
  );
});
