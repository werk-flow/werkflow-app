// Rule test: the daily ruleset watch (.github/scripts/ruleset-check.sh) fails when a live GitHub
// ruleset stops holding a protection decision 0012 rests on, and passes on today's settings.
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const script = resolve(import.meta.dir, '../../.github/scripts/ruleset-check.sh');

type Rule = { type: string; parameters?: Record<string, unknown> };
type Ruleset = {
  enforcement: string;
  conditions: { ref_name: { include: string[]; exclude: string[] } };
  rules: Rule[];
  current_user_can_bypass?: string;
};

// The live rulesets as the job token reads them (2026-11-28): rules and its own bypass, no bypass list.
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
    current_user_can_bypass: 'never',
  };
}

function liveProduction(): Ruleset {
  return {
    enforcement: 'active',
    conditions: { ref_name: { exclude: [], include: ['refs/heads/production'] } },
    rules: [{ type: 'update' }, { type: 'deletion' }, { type: 'non_fast_forward' }],
    current_user_can_bypass: 'never',
  };
}

// Answers `gh api repos/<repo>/rulesets/<id>` from $STUB/<id>.json, or fails while $STUB/down exists.
const GH_STUB = `#!/usr/bin/env bash
test ! -e "$STUB/down" || exit 1
cat "$STUB/\${2##*/}.json"
`;

let stub = '';

beforeEach(() => {
  stub = mkdtempSync(join(tmpdir(), 'ruleset-check-'));
  writeFileSync(join(stub, 'gh'), GH_STUB);
  chmodSync(join(stub, 'gh'), 0o755);
});

afterEach(() => rmSync(stub, { recursive: true, force: true }));

function check(main: Ruleset, production: Ruleset) {
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
    },
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

const without = (ruleset: Ruleset, type: string): Ruleset => ({
  ...ruleset,
  rules: ruleset.rules.filter((rule) => rule.type !== type),
});

test('today’s rulesets hold', () => {
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

test('an exclusion that takes the branch out of its ruleset is drift, for main and production', () => {
  const main = liveMain();
  main.conditions = { ref_name: { include: ['refs/heads/main'], exclude: ['refs/heads/main'] } };
  expect(check(main, liveProduction()).output).toContain(
    'main: targets refs/heads/main and excludes nothing',
  );
  const production = liveProduction();
  production.conditions = {
    ref_name: { include: ['refs/heads/production'], exclude: ['refs/heads/production'] },
  };
  expect(check(liveMain(), production).output).toContain(
    'production: targets refs/heads/production and excludes nothing',
  );
});

test('GitHub Actions allowed to bypass, or a production ruleset that stops refusing updates, is drift', () => {
  expect(check(liveMain(), { ...liveProduction(), current_user_can_bypass: 'always' }).output).toContain(
    'production: lets GitHub Actions bypass nothing',
  );
  expect(
    check({ ...liveMain(), current_user_can_bypass: 'pull_requests_only' }, liveProduction()).output,
  ).toContain('main: lets GitHub Actions bypass nothing');
  expect(check(liveMain(), { ...liveProduction(), enforcement: 'evaluate' }).output).toContain(
    'production: is active',
  );
  expect(check(liveMain(), without(liveProduction(), 'update')).output).toContain(
    'production: refuses every update',
  );
});

test('an unreadable ruleset proves nothing and says so with its own exit code', () => {
  writeFileSync(join(stub, 'down'), '');
  const result = check(liveMain(), liveProduction());
  expect(result.status).toBe(2);
  expect(result.output).toContain('GitHub did not return the main ruleset');
});

test('an answer without the caller’s bypass, or one that is no JSON, proves nothing (exit 2), never drift', () => {
  const unread = liveMain();
  delete unread.current_user_can_bypass;
  const missing = check(unread, liveProduction());
  expect(missing.status).toBe(2);
  expect(missing.output).toContain('not a whole ruleset');
  writeFileSync(join(stub, 'gh'), '#!/usr/bin/env bash\necho \'{"rules": [\'\n');
  expect(check(liveMain(), liveProduction()).status).toBe(2);
});

test('a rule whose value has an unexpected shape proves nothing (exit 2), never drift', () => {
  const shaped = liveMain();
  shaped.rules = shaped.rules.map((rule) =>
    rule.type === 'merge_queue'
      ? { type: 'merge_queue', parameters: { grouping_strategy: ['ALLGREEN'] } }
      : rule,
  );
  // jq cannot index a string: the merge queue's parameters arrive as one.
  const raw = JSON.stringify(shaped).replace('{"grouping_strategy":["ALLGREEN"]}', '"squash"');
  writeFileSync(join(stub, '25878425.json'), raw);
  writeFileSync(join(stub, '25878432.json'), JSON.stringify(liveProduction()));
  const result = spawnSync('bash', [script], {
    encoding: 'utf8',
    env: {
      NODE_ENV: 'test',
      PATH: `${stub}:${process.env.PATH}`,
      STUB: stub,
      GH_TOKEN: 'job-token',
      GH_REPO: 'werk-flow/werkflow-app',
    },
  });
  const output = `${result.stdout}${result.stderr}`;
  expect(result.status, output).toBe(2);
  expect(output).toContain('unexpected shape');
});
