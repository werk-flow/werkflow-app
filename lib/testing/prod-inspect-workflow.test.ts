// Only the PROD inspection job reads PROD, with its own read-only token, and a workstation run of
// either PROD script fails naming that job (.github/workflows/prod-inspect.yml).
import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { readWorkflow, workflowsFolder } from './ci-workflow';
import { temporaryDirectory } from './temporary-directory';

const inspection = readWorkflow('prod-inspect.yml');
const repositoryRoot = resolve(import.meta.dir, '../..');
const INSPECT = "Inspect PROD's structure";
const AUTH = 'Compare or sync the Auth configuration';
const ALERT = 'Open, update or close the alert issue';
const TOKENS = {
  PROD_INSPECT_SUPABASE_TOKEN: '${{ secrets.PROD_INSPECT_SUPABASE_TOKEN }}',
  SUPABASE_ACCESS_TOKEN: '${{ secrets.SUPABASE_ACCESS_TOKEN }}',
};

const steps = (job: string): Record<string, unknown>[] => {
  const list = inspection.at('jobs', job, 'steps');
  return Array.isArray(list) ? list : [];
};

test('it runs daily and by hand, with the auth sync only by hand', () => {
  expect(inspection.at('on', 'schedule')).toEqual([{ cron: '0 6 * * *' }]);
  expect(inspection.at('on', 'workflow_dispatch', 'inputs', 'auth')).toMatchObject({
    type: 'choice',
    default: 'skip',
    options: ['skip', 'compare', 'apply'],
  });
  expect(inspection.text('jobs', 'inspect', 'steps', 3, 'if')).toBe(
    "${{ !cancelled() && (inputs.auth == 'compare' || inputs.auth == 'apply') }}",
  );
});

test('the PROD token stays in the production environment, on main, in the steps that run a script', () => {
  expect(inspection.at('permissions')).toEqual({});
  expect(inspection.at('jobs', 'inspect', 'environment')).toBe('production');
  expect(inspection.at('jobs', 'inspect', 'if')).toBe("github.ref == 'refs/heads/main'");
  expect(inspection.at('jobs', 'inspect', 'permissions')).toEqual({ contents: 'read' });
  expect(inspection.at('jobs', 'inspect', 'env')).toBeUndefined();
  expect(inspection.at('jobs', 'inspect', 'steps', 0, 'with')).toEqual({ 'persist-credentials': false });
  // The install runs dependency scripts, so it sees no secret.
  expect(inspection.at('jobs', 'inspect', 'steps', 1)).toEqual({ uses: './.github/actions/setup' });
  expect(inspection.step('inspect', INSPECT).env).toEqual(TOKENS);
  expect(inspection.step('inspect', INSPECT).run).toBe('bun run prod:inspect');
  expect(inspection.step('inspect', AUTH).env).toEqual({ ...TOKENS, AUTH: '${{ inputs.auth }}' });
  const workflow = readFileSync(join(repositoryRoot, workflowsFolder(), 'prod-inspect.yml'), 'utf8');
  expect(workflow.match(/secrets\.PROD_INSPECT_SUPABASE_TOKEN/g)).toHaveLength(2);
  for (const step of [...steps('inspect'), ...steps('report')])
    expect(String(step.run ?? '')).not.toContain('${{');
});

test('the auth input picks a compare or an apply, and an unknown one fails', () => {
  const stub = temporaryDirectory('prod-inspect-');
  writeFileSync(join(stub, 'bun'), '#!/usr/bin/env bash\necho "bun $*"\n');
  chmodSync(join(stub, 'bun'), 0o755);
  const run = (auth: string) =>
    inspection.runStep('inspect', AUTH, { env: { PATH: `${stub}:${process.env.PATH}`, AUTH: auth } });
  expect(run('compare')).toEqual({ passed: true, output: 'bun scripts/sync-dev-auth-from-prod.ts\n' });
  expect(run('apply')).toEqual({ passed: true, output: 'bun scripts/sync-dev-auth-from-prod.ts --apply\n' });
  const unknown = run('skip');
  expect(unknown.passed).toBe(false);
  expect(unknown.output).toContain("Unknown auth input 'skip'");
});

test('a failed or cancelled inspection opens the alert for the owner; a green one closes it', () => {
  expect(inspection.at('jobs', 'report', 'needs')).toBe('inspect');
  expect(inspection.at('jobs', 'report', 'if')).toBe("${{ always() && github.ref == 'refs/heads/main' }}");
  expect(inspection.at('jobs', 'report', 'environment')).toBeUndefined();
  expect(inspection.at('jobs', 'report', 'permissions')).toEqual({
    actions: 'read',
    contents: 'read',
    issues: 'write',
  });
  const alert = inspection.step('report', ALERT);
  expect(alert.run).toBe('bash .github/scripts/alert-issue.sh run "$TITLE" "$RESULT"');
  expect(alert.env).toMatchObject({
    GH_TOKEN: '${{ github.token }}',
    TITLE: 'CI alert: PROD inspection',
    RESULT: '${{ needs.inspect.result }}',
    AFFECTS_PRODUCTION: true,
  });
});

test('on a workstation both PROD scripts fail and name the job, before any call', () => {
  for (const script of ['scripts/inspect-production.ts', 'scripts/sync-dev-auth-from-prod.ts']) {
    const run = spawnSync('bun', [script], {
      cwd: repositoryRoot,
      encoding: 'utf8',
      // An empty value also keeps loadEnvLocal from taking one out of .env.local.
      env: {
        NODE_ENV: 'test',
        PATH: process.env.PATH,
        PROD_INSPECT_SUPABASE_TOKEN: '',
        SUPABASE_ACCESS_TOKEN: 'dev-token',
      },
    });
    expect(run.status, script).toBe(1);
    expect(run.stderr, script).toContain(
      'PROD_INSPECT_SUPABASE_TOKEN is not set. PROD is read only by the PROD inspection job: gh workflow run prod-inspect.yml',
    );
  }
});
