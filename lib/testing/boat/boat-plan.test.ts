// Rule test: a plan that costs this workstation less than a Boat machine's upload and setup runs
// locally with one line saying so; type-aware lint and the browser groups still go to Boat.
import { expect, spyOn, test } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { cheapPlanReason, prepareAndRun } from './verify-on-boat';

const plan = (...runs: string[]) =>
  [
    'Verification change/local: 3 changed inputs since HEAD; 1 required groups.',
    'REUSE static:lint | Static gate | 12 proof inputs | passed 2026-11-08',
    ...runs.map((id) => `RUN   ${id} | Explicit selection | 9 proof inputs | no pass`),
  ].join('\n');

test('a single SQL, unit or static group other than lint stays local; lint and browser groups go to Boat', () => {
  expect(cheapPlanReason(plan('sql:security'))).toBe('a single sql:security is cheaper here.');
  expect(cheapPlanReason(plan('unit:all'))).toBe('a single unit:all is cheaper here.');
  expect(cheapPlanReason(plan('static:typecheck'))).toBe('a single static:typecheck is cheaper here.');
  // Lint is the largest local load; ui:contracts and every browser group outlast Boat's setup.
  for (const id of ['static:lint', 'ui:contracts', 'golden:p1-01', 'audit:lab:office', 'canary:security'])
    expect(cheapPlanReason(plan(id)), id).toBeUndefined();
});

test('SQL groups with at most one other cheap group stay local, and a plan that runs nothing never starts a machine', () => {
  expect(cheapPlanReason(plan('sql:security', 'sql:record-numbers', 'unit:all'))).toBe(
    '2 SQL groups and unit:all are cheaper here.',
  );
  expect(cheapPlanReason(plan('sql:security', 'sql:record-numbers'))).toBe('2 SQL groups are cheaper here.');
  expect(cheapPlanReason(plan())).toBe('the plan runs no group, which is cheaper here.');
  // Two groups that each take a minute, or any group that is not cheap, go to Boat.
  expect(cheapPlanReason(plan('unit:all', 'static:format'))).toBeUndefined();
  expect(cheapPlanReason(plan('sql:security', 'static:lint'))).toBeUndefined();
});

test('a cheap plan prints its reason and runs locally before anything is packed or a machine starts', async () => {
  const repository = mkdtempSync(join(tmpdir(), 'boat-plan-'));
  mkdirSync(join(repository, 'scripts'));
  writeFileSync(
    join(repository, 'scripts', 'verify.ts'),
    "console.log('RUN   sql:security | Explicit selection | 9 proof inputs | no pass');\n",
  );
  const lines: unknown[] = [];
  const info = spyOn(console, 'info').mockImplementation((line: unknown) => {
    lines.push(line);
  });
  try {
    // The repository is no git checkout and the key is fake: a pack or a Boat call would fail loudly.
    expect(
      await prepareAndRun(
        ['--group', 'sql:security'],
        repository,
        'boat_secret',
        new AbortController().signal,
      ),
    ).toBeUndefined();
  } finally {
    info.mockRestore();
  }
  expect(lines).toEqual(['[verify] Running locally: a single sql:security is cheaper here.']);
});
