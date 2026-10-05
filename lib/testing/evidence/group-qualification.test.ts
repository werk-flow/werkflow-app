import { expect, test } from 'bun:test';
import { Glob } from 'bun';
import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createGroupQualification, directGroupRetryProblem } from './group-qualification';
import {
  hashValue,
  sourceImportGraph,
  UNKNOWN_IMPORT_DEPENDENCY,
  type InputSnapshot,
} from './group-evidence';
import { BROWSER_INPUT_DRIFT_MESSAGE } from './test-evidence';
import type { TestGroup } from '../selection/test-groups';

const groups: [TestGroup, TestGroup] = [
  {
    id: 'golden:people',
    kind: 'golden',
    files: ['tests/people.spec.ts'],
    scopes: ['personnel'],
    isolation: 'group-world',
    timing: { requireFreshness: false, requireReadiness: false, exclusive: false },
  },
  {
    id: 'golden:inventory',
    kind: 'golden',
    files: ['tests/inventory.spec.ts'],
    scopes: ['inventory'],
    isolation: 'group-world',
    timing: { requireFreshness: false, requireReadiness: false, exclusive: false },
  },
];
const failed = {
  runKey: 'direct-failure',
  groupId: 'golden:people',
  target: 'local' as const,
  candidateFingerprint: 'failed-tree',
  status: 'failed' as const,
  startedAt: '2026-09-06T10:00:00.000Z',
  retainedAt: null,
  cleanedAt: '2026-09-06T10:01:00.000Z',
};
const retry = {
  groupId: failed.groupId,
  target: 'local' as const,
  candidateFingerprint: failed.candidateFingerprint,
  recoveredRunKeys: [] as string[],
};

test('real freshness helper imports stay independent of scenario references', () => {
  const root = resolve(import.meta.dir, '../../..');
  // Read actual imports without launching Git or depending on local provider settings.
  const files = [
    ...readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name),
    ...[
      'app',
      'components',
      'hooks',
      'lib',
      'tests',
      'scripts',
      'supabase',
      'public',
      'eslint-rules',
    ].flatMap((directory) =>
      [...new Glob('**/*').scanSync({ cwd: join(root, directory), onlyFiles: true })].map(
        (file) => `${directory}/${file.replaceAll('\\', '/')}`,
      ),
    ),
  ];
  const graph = sourceImportGraph(root, files);
  for (const [entry, measured] of [
    ['tests/golden/support/live.ts', false],
    ['tests/golden/support/calendar-change-observation.ts', false],
    ['tests/golden/support/scenario-measurement.ts', true],
  ] as const) {
    const reachable = new Set<string>();
    const pending: string[] = [entry];
    while (pending.length) {
      const file = pending.pop();
      if (!file || reachable.has(file)) continue;
      reachable.add(file);
      pending.push(...(graph.get(file) ?? []));
    }
    expect(reachable.has(UNKNOWN_IMPORT_DEPENDENCY)).toBe(false);
    expect(reachable.has('lib/testing/responsiveness-tolerance.ts')).toBe(true);
    expect(reachable.has('lib/testing/performance-baselines.json')).toBe(measured);
  }
  // This reads and parses repository sources; its deadline is not an app latency contract.
}, 30_000);

test('a browser proof covers its spec, the test support it imports and the dependency manifests, never product code', () => {
  const root = mkdtempSync(join(tmpdir(), 'werkflow-group-qualification-'));
  const sources: Record<string, string> = {
    'tests/people.spec.ts':
      "import './support/people'; import '../lib/personnel/rule'; export const people = true;",
    'tests/support/people.ts':
      "import '../../lib/testing/people-fixture'; import '../../lib/supabase/database.types';",
    'lib/testing/people-fixture.ts': 'export const fixture = true;',
    'tests/inventory.spec.ts': 'export const inventory = true;',
    'lib/personnel/rule.ts': "import '../testing/unreached-helper'; export const rule = 1;",
    'lib/testing/unreached-helper.ts': 'export const helper = true;',
    'lib/supabase/database.types.ts': 'export type Database = object;',
    'components/ui/button.tsx': 'export const Button = null;',
    'app/globals.css': ':root {}',
    'supabase/migrations/20261001000000_people.sql': 'select 1;',
    'package.json': '{}',
    'bun.lock': '{}',
  };
  try {
    for (const [file, contents] of Object.entries(sources)) {
      mkdirSync(dirname(join(root, file)), { recursive: true });
      writeFileSync(join(root, file), contents);
    }
    const snapshot: InputSnapshot = {
      version: 1,
      environment: hashValue('local'),
      files: Object.fromEntries(
        Object.entries(sources).map(([file, contents]) => [file, hashValue(contents)]),
      ),
    };
    const original = createGroupQualification(root, groups, snapshot).qualify(groups[0]);
    expect(original.inputs).toEqual([
      'bun.lock',
      'lib/testing/people-fixture.ts',
      'package.json',
      'tests/people.spec.ts',
      'tests/support/people.ts',
    ]);
    expect(original.executionInputs).toEqual([
      'lib/testing/people-fixture.ts',
      'tests/people.spec.ts',
      'tests/support/people.ts',
    ]);
    const fingerprintAfter = (file: string, environment = snapshot.environment): string =>
      createGroupQualification(root, groups, {
        ...snapshot,
        environment,
        files: { ...snapshot.files, [file]: hashValue(`changed ${file}`) },
      }).qualify(groups[0]).fingerprint;
    for (const file of [
      'lib/personnel/rule.ts',
      'lib/supabase/database.types.ts',
      'components/ui/button.tsx',
      'app/globals.css',
      'supabase/migrations/20261001000000_people.sql',
      'tests/inventory.spec.ts',
      'lib/testing/unreached-helper.ts',
    ]) {
      expect([file, fingerprintAfter(file)]).toEqual([file, original.fingerprint]);
    }
    for (const file of [
      'tests/people.spec.ts',
      'tests/support/people.ts',
      'lib/testing/people-fixture.ts',
      'package.json',
      'bun.lock',
    ]) {
      expect([file, fingerprintAfter(file) === original.fingerprint]).toEqual([file, false]);
    }
    expect(fingerprintAfter('lib/personnel/rule.ts', hashValue('cloud'))).not.toBe(original.fingerprint);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('an unresolved import in test support widens a browser proof to all test code, not to product code', () => {
  const root = mkdtempSync(join(tmpdir(), 'werkflow-unresolved-support-'));
  const sources: Record<string, string> = {
    'tests/people.spec.ts': "import './support/missing-module';",
    'tests/inventory.spec.ts': 'export const inventory = true;',
    'lib/testing/helper.ts': 'export const helper = true;',
    'lib/personnel/rule.ts': 'export const rule = 1;',
  };
  try {
    for (const [file, contents] of Object.entries(sources)) {
      mkdirSync(dirname(join(root, file)), { recursive: true });
      writeFileSync(join(root, file), contents);
    }
    const snapshot: InputSnapshot = {
      version: 1,
      environment: hashValue('local'),
      files: Object.fromEntries(
        Object.entries(sources).map(([file, contents]) => [file, hashValue(contents)]),
      ),
    };
    expect(createGroupQualification(root, groups, snapshot).qualify(groups[0]).inputs).toEqual([
      'lib/testing/helper.ts',
      'tests/inventory.spec.ts',
      'tests/people.spec.ts',
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a failed group may run again after any source change; a repeat on the identical tree needs a diagnosis', () => {
  expect(directGroupRetryProblem({ ...retry, runs: [failed] })).toContain('exact source tree');
  // The repair may live in product code the group's proof does not fingerprint.
  expect(
    directGroupRetryProblem({ ...retry, candidateFingerprint: 'repaired-tree', runs: [failed] }),
  ).toBeUndefined();
  // Runs archived before the candidate identity existed never block.
  expect(
    directGroupRetryProblem({ ...retry, runs: [{ ...failed, candidateFingerprint: undefined }] }),
  ).toBeUndefined();
});

test('editing a registered browser spec invalidates convention-unit proof without coupling another browser group', () => {
  const root = mkdtempSync(join(tmpdir(), 'werkflow-unit-filesystem-inputs-'));
  const unit: TestGroup = {
    id: 'unit:all',
    kind: 'unit',
    files: ['lib/testing/conventions.test.ts'],
    scopes: ['*'],
    isolation: 'process',
    timing: { requireFreshness: false, requireReadiness: false, exclusive: false },
  };
  const sql: TestGroup = {
    ...unit,
    id: 'sql:inventory',
    kind: 'sql',
    files: ['supabase/tests/inventory.sql'],
    scopes: ['inventory'],
  };
  const registered = [...groups, unit, sql];
  const sources = {
    'tests/people.spec.ts': 'export const people = true;',
    'tests/inventory.spec.ts': 'export const inventory = true;',
    'lib/testing/conventions.test.ts': 'export const filesystemCensus = true;',
    'supabase/tests/inventory.sql': 'select true;',
  };
  try {
    for (const [file, contents] of Object.entries(sources)) {
      mkdirSync(dirname(join(root, file)), { recursive: true });
      writeFileSync(join(root, file), contents);
    }
    const snapshot: InputSnapshot = {
      version: 1,
      environment: hashValue('local'),
      files: Object.fromEntries(
        Object.entries(sources).map(([file, contents]) => [file, hashValue(contents)]),
      ),
    };
    const before = createGroupQualification(root, registered, snapshot);
    expect(before.qualify(unit).inputs).toContain('tests/inventory.spec.ts');
    const sqlEdit = {
      ...snapshot,
      files: { ...snapshot.files, 'supabase/tests/inventory.sql': hashValue('changed assertion') },
    };
    expect(createGroupQualification(root, registered, sqlEdit).qualify(unit).fingerprint).not.toBe(
      before.qualify(unit).fingerprint,
    );
    const edited = {
      ...snapshot,
      files: { ...snapshot.files, 'tests/inventory.spec.ts': hashValue('broken browser convention') },
    };
    const after = createGroupQualification(root, registered, edited);
    expect(after.qualify(unit).fingerprint).not.toBe(before.qualify(unit).fingerprint);
    expect(after.qualify(groups[0]).fingerprint).toBe(before.qualify(groups[0]).fingerprint);
    expect(after.qualify(groups[1]).fingerprint).not.toBe(before.qualify(groups[1]).fingerprint);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('suite configuration, the component runner and lint rule modules qualify only the kind that executes them', () => {
  const root = mkdtempSync(join(tmpdir(), 'werkflow-kind-owned-inputs-'));
  const timing = { requireFreshness: false, requireReadiness: false, exclusive: false } as const;
  const audit: TestGroup = {
    id: 'audit:wave-1:a1',
    kind: 'audit',
    files: ['tests/audit/a1.spec.ts'],
    scopes: ['personnel'],
    isolation: 'group-world',
    timing,
  };
  const ui: TestGroup = {
    id: 'ui:contracts',
    kind: 'ui',
    files: ['tests/ui-contracts/controls.spec.ts'],
    scopes: ['*'],
    isolation: 'process',
    timing,
  };
  const lint: TestGroup = {
    id: 'static:lint',
    kind: 'static',
    files: ['eslint.config.mjs'],
    scopes: ['*'],
    isolation: 'process',
    timing,
  };
  const unit: TestGroup = {
    id: 'unit:all',
    kind: 'unit',
    files: ['lib/example.test.ts'],
    scopes: ['*'],
    isolation: 'process',
    timing,
  };
  const registered = [groups[0], audit, ui, lint, unit];
  const sources = {
    'tests/people.spec.ts': 'export const people = true;',
    'tests/audit/a1.spec.ts': 'export const audit = true;',
    'tests/ui-contracts/controls.spec.ts': 'export const controls = true;',
    'tests/ui-contracts/run.ts':
      "import { lock } from '../../lib/testing/runner/workspace-test-lock'; export { lock };",
    'lib/testing/runner/workspace-test-lock.ts': 'export const lock = true;',
    'playwright.config.ts': 'export default {};',
    'playwright.audit.config.ts': 'export default {};',
    'eslint.config.mjs': 'export default [];',
    'eslint-rules/ui-rules.mjs': 'export const uiRules = [];',
    'bunfig.toml': '[test]',
    'lib/example.test.ts': 'export const example = true;',
  };
  try {
    for (const [file, contents] of Object.entries(sources)) {
      mkdirSync(dirname(join(root, file)), { recursive: true });
      writeFileSync(join(root, file), contents);
    }
    const snapshot: InputSnapshot = {
      version: 1,
      environment: hashValue('local'),
      files: Object.fromEntries(
        Object.entries(sources).map(([file, contents]) => [file, hashValue(contents)]),
      ),
    };
    const qualification = createGroupQualification(root, registered, snapshot);
    const golden = qualification.qualify(groups[0]).inputs;
    expect(golden).toContain('playwright.config.ts');
    for (const file of [
      'playwright.audit.config.ts',
      'tests/ui-contracts/run.ts',
      'lib/testing/runner/workspace-test-lock.ts',
      'eslint-rules/ui-rules.mjs',
      'bunfig.toml',
    ])
      expect(golden).not.toContain(file);
    expect(qualification.qualify(audit).inputs).toContain('playwright.audit.config.ts');
    expect(qualification.qualify(audit).inputs).not.toContain('playwright.config.ts');
    const component = qualification.qualify(ui).inputs;
    expect(component).toContain('tests/ui-contracts/run.ts');
    expect(component).toContain('lib/testing/runner/workspace-test-lock.ts');
    expect(qualification.qualify(lint).inputs).toContain('eslint-rules/ui-rules.mjs');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('canary support changes qualify providers and actual importers without invalidating unrelated browser groups', () => {
  const root = mkdtempSync(join(tmpdir(), 'werkflow-provider-inputs-'));
  const canary: TestGroup = {
    ...groups[0],
    id: 'canary:security',
    kind: 'canary',
    files: ['tests/canary/security.spec.ts'],
    scopes: ['*'],
    isolation: 'cloud-world',
  };
  const registered = [...groups, canary];
  const helper = 'tests/canary/support/receiver.ts';
  const sources = {
    'tests/people.spec.ts': 'export const people = true;',
    'tests/inventory.spec.ts': "import { receiver } from './canary/support/receiver'; export { receiver };",
    'tests/canary/security.spec.ts': "import { receiver } from './support/receiver'; export { receiver };",
    [helper]: 'export const receiver = true;',
    'unknown-runtime.ts': 'export const shared = true;',
  };
  try {
    for (const [file, contents] of Object.entries(sources)) {
      mkdirSync(dirname(join(root, file)), { recursive: true });
      writeFileSync(join(root, file), contents);
    }
    const snapshot: InputSnapshot = {
      version: 1,
      environment: hashValue('local'),
      files: Object.fromEntries(
        Object.entries(sources).map(([file, contents]) => [file, hashValue(contents)]),
      ),
    };
    const before = createGroupQualification(root, registered, snapshot);
    const after = createGroupQualification(root, registered, {
      ...snapshot,
      files: { ...snapshot.files, [helper]: hashValue('repaired receiver') },
    });
    expect(after.qualify(groups[0]).fingerprint).toBe(before.qualify(groups[0]).fingerprint);
    expect(after.qualify(groups[1]).fingerprint).not.toBe(before.qualify(groups[1]).fingerprint);
    expect(after.qualify(canary).fingerprint).not.toBe(before.qualify(canary).fingerprint);
    expect(after.qualify(groups[0]).inputs).not.toContain('unknown-runtime.ts');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('one matching diagnosed environment recovery permits one further attempt', () => {
  const input = { ...retry, recoveredRunKeys: [failed.runKey] };
  expect(directGroupRetryProblem({ ...input, runs: [failed] })).toBeUndefined();
  const second = { ...failed, runKey: 'second-failure', startedAt: '2026-09-06T11:00:00.000Z' };
  expect(
    directGroupRetryProblem({
      ...input,
      runs: [second, failed],
      recoveredRunKeys: [failed.runKey, second.runKey],
    }),
  ).toContain('exact source tree');
});

test('a recovered interruption without a failed test is no attempt on its tree', () => {
  const interrupted = { ...failed, status: 'interrupted' as const, failed: 0 };
  expect(directGroupRetryProblem({ ...retry, runs: [interrupted] })).toBeUndefined();
  expect(directGroupRetryProblem({ ...retry, runs: [{ ...interrupted, failed: 1 }] })).toContain(
    'exact source tree',
  );
});

test('a run voided by an input change is no attempt on its tree', () => {
  const voided = {
    ...failed,
    failures: [{ title: 'Execution evidence', file: null, message: BROWSER_INPUT_DRIFT_MESSAGE }],
  };
  expect(directGroupRetryProblem({ ...retry, runs: [voided] })).toBeUndefined();
});

test('unfinished or retained ownership blocks a new attempt even after source changes', () => {
  const input = { ...retry, candidateFingerprint: 'repaired-tree' };
  expect(
    directGroupRetryProblem({ ...input, runs: [{ ...failed, status: 'running', cleanedAt: null }] }),
  ).toContain('unfinished run');
  expect(
    directGroupRetryProblem({ ...input, runs: [{ ...failed, status: 'starting', cleanedAt: null }] }),
  ).toContain('unfinished run');
  expect(
    directGroupRetryProblem({
      ...input,
      runs: [{ ...failed, retainedAt: failed.startedAt, cleanedAt: null }],
    }),
  ).toContain('retains world');
});

test('other group and target failures do not block an independent group', () => {
  expect(
    directGroupRetryProblem({
      ...retry,
      runs: [
        { ...failed, groupId: 'golden:inventory' },
        { ...failed, target: 'cloud' },
      ],
    }),
  ).toBeUndefined();
});

test('returning to a failed tree cannot hide that failure behind a pass on another tree', () => {
  expect(
    directGroupRetryProblem({
      ...retry,
      runs: [
        failed,
        {
          ...failed,
          runKey: 'other-tree-pass',
          candidateFingerprint: 'different',
          status: 'passed',
          startedAt: '2026-09-06T11:00:00.000Z',
        },
      ],
    }),
  ).toContain('exact source tree');
});

test('performance contract, reference, profile and validator edits invalidate prior evidence', () => {
  const root = mkdtempSync(join(tmpdir(), 'werkflow-performance-inputs-'));
  const measured: TestGroup = {
    ...groups[0],
    id: 'audit:performance:calendar',
    kind: 'audit',
    files: ['tests/audit/performance/calendar.spec.ts'],
    scopes: ['planning'],
  };
  const sources: Record<string, string> = {
    'tests/audit/performance/calendar.spec.ts':
      "import '../../golden/support/live'; import '../support/performance-profile';",
    'tests/golden/support/live.ts':
      "import '../../../lib/testing/latency-evidence'; import './browser-observation';",
    'tests/golden/support/browser-observation.ts': "export const detectionProtocol = 'browser-raf';",
    'tests/audit/support/performance-profile.ts': 'export const count = 40;',
    'lib/testing/latency-evidence.ts': "import './performance-baselines'; import './measured-scenarios';",
    'lib/testing/measured-scenarios.ts': 'export const budget = 500;',
    'lib/testing/performance-baselines.ts':
      "import './performance-baselines.json'; import './performance-context';",
    'lib/testing/performance-context.ts': 'export const protocol = 1;',
    'lib/testing/performance-baselines.json': '{}',
  };
  try {
    for (const [file, contents] of Object.entries(sources)) {
      mkdirSync(dirname(join(root, file)), { recursive: true });
      writeFileSync(join(root, file), contents);
    }
    const snapshot: InputSnapshot = {
      version: 1,
      environment: hashValue('local'),
      files: Object.fromEntries(
        Object.entries(sources).map(([file, contents]) => [file, hashValue(contents)]),
      ),
    };
    const before = createGroupQualification(root, [measured], snapshot).qualify(measured);
    for (const file of Object.keys(sources)) {
      expect(before.inputs).toContain(file);
      const changed = { ...snapshot, files: { ...snapshot.files, [file]: hashValue(`changed ${file}`) } };
      expect(createGroupQualification(root, [measured], changed).qualify(measured).fingerprint).not.toBe(
        before.fingerprint,
      );
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('reference edits spare ordinary freshness journeys but still qualify measured groups', () => {
  const root = mkdtempSync(join(tmpdir(), 'werkflow-reference-ownership-'));
  const ordinary: TestGroup = { ...groups[0], files: ['tests/golden/ordinary.spec.ts'] };
  const measured: TestGroup = { ...groups[1], files: ['tests/audit/measured.spec.ts'] };
  const sources: Record<string, string> = {
    'tests/golden/ordinary.spec.ts': "import './support/live';",
    'tests/audit/measured.spec.ts': "import '../golden/support/scenario-measurement';",
    'tests/golden/support/live.ts': "import '../../../lib/testing/responsiveness-tolerance';",
    'tests/golden/support/scenario-measurement.ts': "import '../../../lib/testing/latency-evidence';",
    'lib/testing/responsiveness-tolerance.ts': 'export const target = 2000;',
    'lib/testing/latency-evidence.ts':
      "import './performance-baselines.json'; import './responsiveness-tolerance';",
    'lib/testing/performance-baselines.json': '{}',
  };
  try {
    for (const [file, contents] of Object.entries(sources)) {
      mkdirSync(dirname(join(root, file)), { recursive: true });
      writeFileSync(join(root, file), contents);
    }
    const snapshot: InputSnapshot = {
      version: 1,
      environment: hashValue('local'),
      files: Object.fromEntries(
        Object.entries(sources).map(([file, contents]) => [file, hashValue(contents)]),
      ),
    };
    const definitions = [ordinary, measured];
    const before = createGroupQualification(root, definitions, snapshot);
    const after = createGroupQualification(root, definitions, {
      ...snapshot,
      files: { ...snapshot.files, 'lib/testing/performance-baselines.json': hashValue('new reference') },
    });
    expect(after.qualify(ordinary).fingerprint).toBe(before.qualify(ordinary).fingerprint);
    expect(after.qualify(measured).fingerprint).not.toBe(before.qualify(measured).fingerprint);
    const newDeadline = createGroupQualification(root, definitions, {
      ...snapshot,
      files: { ...snapshot.files, 'lib/testing/responsiveness-tolerance.ts': hashValue('new deadline') },
    });
    expect(newDeadline.qualify(ordinary).fingerprint).not.toBe(before.qualify(ordinary).fingerprint);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('pilot evidence changes with orchestration even without a test import; unchanged pilot evidence stays reusable', () => {
  const root = mkdtempSync(join(tmpdir(), 'werkflow-pilot-inputs-'));
  const pilot: TestGroup = { ...groups[0], id: 'golden:p1-24a' };
  const registered = [pilot, groups[1]];
  const sources = {
    'tests/people.spec.ts': 'export const people = true;',
    'tests/inventory.spec.ts': 'export const inventory = true;',
    'lib/testing/selection/group-selection.ts': 'export const policy = 1;',
  };
  try {
    for (const [file, contents] of Object.entries(sources)) {
      mkdirSync(dirname(join(root, file)), { recursive: true });
      writeFileSync(join(root, file), contents);
    }
    const snapshot: InputSnapshot = {
      version: 1,
      environment: hashValue('local'),
      files: Object.fromEntries(
        Object.entries(sources).map(([file, contents]) => [file, hashValue(contents)]),
      ),
    };
    const before = createGroupQualification(root, registered, snapshot);
    const changed = {
      ...snapshot,
      files: {
        ...snapshot.files,
        'lib/testing/selection/group-selection.ts': hashValue('export const policy = 2;'),
      },
    };
    const after = createGroupQualification(root, registered, changed);
    expect(after.qualify(pilot).fingerprint).not.toBe(before.qualify(pilot).fingerprint);
    expect(after.qualify(groups[1]).fingerprint).toBe(before.qualify(groups[1]).fingerprint);
    expect(createGroupQualification(root, registered, changed).qualify(pilot).fingerprint).toBe(
      after.qualify(pilot).fingerprint,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
