// Rule test: the daily ruleset watch (.github/scripts/ruleset-check.sh) fails when a live GitHub
// ruleset stops holding a protection decision 0012 rests on, and passes on today's settings.
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const script = resolve(import.meta.dir, '../../.github/scripts/ruleset-check.sh');

type Rule = { type: string; parameters?: Record<string, unknown> };
type Ruleset = { enforcement: string; conditions: unknown; rules: Rule[]; bypass_actors?: unknown[] };

// The live rulesets as an admin reads them (2026-11-28); the job token gets them without bypass_actors.
function liveMain(): Ruleset {
  return {
    enforcement: 'active',
    conditions: { ref_name: { exclude: [], include: ['refs/heads/main'] } },
    rules: [
      { type: 'deletion' },
      { type: 'non_fast_forward' },
      { type: 'required_linear_history' },
      {
        type: 'pull_request',
        parameters: { allowed_merge_methods: ['squash'], required_approving_review_count: 0 },
      },
      {
        type: 'required_status_checks',
        parameters: { required_status_checks: [{ context: 'Check', integration_id: 15368 }] },
      },
      {
        type: 'merge_queue',
        parameters: { grouping_strategy: 'ALLGREEN', merge_method: 'SQUASH', max_entries_to_build: 2 },
      },
    ],
    bypass_actors: [],
  };
}

function liveProduction(): Ruleset {
  return {
    enforcement: 'active',
    conditions: { ref_name: { exclude: [], include: ['refs/heads/production'] } },
    rules: [{ type: 'update' }, { type: 'deletion' }, { type: 'non_fast_forward' }],
    bypass_actors: [{ actor_id: null, actor_type: 'DeployKey', bypass_mode: 'always' }],
  };
}

// Answers `gh api repos/<repo>/rulesets/<id>` from $STUB/<id>.json, without bypass_actors unless the
// call carries the admin token.
const GH_STUB = `#!/usr/bin/env bash
id="\${2##*/}"
if test "$GH_TOKEN" = admin-token; then cat "$STUB/$id.json"; else jq 'del(.bypass_actors)' "$STUB/$id.json"; fi
`;

let stub = '';

beforeEach(() => {
  stub = mkdtempSync(join(tmpdir(), 'ruleset-check-'));
  writeFileSync(join(stub, 'gh'), GH_STUB);
  chmodSync(join(stub, 'gh'), 0o755);
});

afterEach(() => rmSync(stub, { recursive: true, force: true }));

function check(main: Ruleset, production: Ruleset, adminToken = 'admin-token') {
  writeFileSync(join(stub, '25878425.json'), JSON.stringify(main));
  writeFileSync(join(stub, '25878432.json'), JSON.stringify(production));
  const result = spawnSync('bash', [script], {
    encoding: 'utf8',
    env: {
      NODE_ENV: 'test',
      PATH: `${stub}:${process.env.PATH}`,
      STUB: stub,
      GH_TOKEN: 'job-token',
      GH_REPO: 'werk-flow/werkflow-app',
      RULESET_ADMIN_TOKEN: adminToken,
    },
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

const without = (ruleset: Ruleset, type: string): Ruleset => ({
  ...ruleset,
  rules: ruleset.rules.filter((rule) => rule.type !== type),
});

test('today’s rulesets hold, bypass lists included', () => {
  const result = check(liveMain(), liveProduction());
  expect(result.status, result.output).toBe(0);
  expect(result.output).toContain('The main and production rulesets hold.');
});

test('the merge queue off, Check no longer required, or a merge other than squash is drift', () => {
  expect(check(without(liveMain(), 'merge_queue'), liveProduction()).output).toContain(
    'main: lands every PR through the merge queue',
  );
  expect(check(without(liveMain(), 'required_status_checks'), liveProduction()).output).toContain(
    'main: requires the check Check from GitHub Actions',
  );
  const merges = liveMain();
  merges.rules = merges.rules.map((rule) =>
    rule.type === 'pull_request'
      ? { ...rule, parameters: { allowed_merge_methods: ['squash', 'merge'] } }
      : rule,
  );
  const result = check(merges, liveProduction());
  expect(result.status).toBe(1);
  expect(result.output).toContain('main: requires a pull request that merges by squash only');
});

test('a production ruleset that lets another actor through, or stops refusing updates, is drift', () => {
  const widened = liveProduction();
  widened.bypass_actors = [
    ...(widened.bypass_actors ?? []),
    { actor_id: 5, actor_type: 'RepositoryRole', bypass_mode: 'always' },
  ];
  expect(check(liveMain(), widened).output).toContain('production: lets only a deploy key bypass it');
  const disabled = { ...liveProduction(), enforcement: 'evaluate' };
  expect(check(liveMain(), disabled).output).toContain('production: is active');
  expect(check(liveMain(), without(liveProduction(), 'update')).output).toContain(
    'production: refuses every update',
  );
});

test('an admin token that cannot see the bypass lists fails instead of passing unseen', () => {
  const unread = liveMain();
  delete unread.bypass_actors;
  const result = check(unread, liveProduction());
  expect(result.status).toBe(1);
  expect(result.output).toContain('main: shows its bypass list to RULESET_ADMIN_TOKEN');
});

test('without the admin token the rules are checked and the unchecked bypass lists are named', () => {
  const result = check(liveMain(), liveProduction(), '');
  expect(result.status, result.output).toBe(0);
  expect(result.output).toContain('RULESET_ADMIN_TOKEN is not set');
});
