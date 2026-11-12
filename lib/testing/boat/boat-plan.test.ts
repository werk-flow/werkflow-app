// Rule test: a plan that costs this workstation less than a Boat machine's upload and setup runs
// locally with one line saying so; type-aware lint and the browser groups still go to Boat.
import { expect, spyOn, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { cheapLocalReason, cheapPlanReason, prepareAndRun } from './verify-on-boat';

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

test('a cheap plan that reads the drifted shared stack goes to Boat with one line naming the drift', () => {
  const drift = { stackOnly: ['another_branch'], treeOnly: ['only_here'], changed: [] };
  const lines: unknown[] = [];
  const info = spyOn(console, 'info').mockImplementation((line: unknown) => {
    lines.push(line);
  });
  let reads = 0;
  const readDrift = (found: typeof drift | undefined) => () => {
    reads++;
    return found;
  };
  try {
    expect(cheapLocalReason(plan('sql:security'), readDrift(drift))).toBeUndefined();
    expect(cheapLocalReason(plan('sql:security', 'unit:all'), readDrift(drift))).toBeUndefined();
    expect(reads).toBe(2);
    // No drift, or a stack that cannot be read, keeps the cheap plan here as before.
    expect(cheapLocalReason(plan('sql:security'), readDrift(undefined))).toBe(
      'a single sql:security is cheaper here.',
    );
    expect(
      cheapLocalReason(plan('sql:security'), readDrift({ stackOnly: [], treeOnly: [], changed: [] })),
    ).toBe('a single sql:security is cheaper here.');
    expect(reads).toBe(4);
    // A plan that never reads the stack, or one that goes to Boat anyway, never reads the ledger.
    expect(cheapLocalReason(plan('unit:all'), readDrift(drift))).toBe('a single unit:all is cheaper here.');
    expect(cheapLocalReason(plan('static:typecheck'), readDrift(drift))).toBe(
      'a single static:typecheck is cheaper here.',
    );
    expect(cheapLocalReason(plan('golden:p1-01'), readDrift(drift))).toBeUndefined();
    expect(reads).toBe(4);
  } finally {
    info.mockRestore();
  }
  const line =
    "[verify] The shared stack's migrations drift from this tree's: 1 migrations only on the shared stack (another_branch), 1 only in this tree (only_here). Boat runs the plan on a fresh stack at this tree's migrations.";
  expect(lines).toEqual([line, line]);
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

/**
 * A stand-in `scripts/verify.ts` in a fresh git checkout without a local stack, so packing refuses
 * before any Boat call. Its plan runs a browser group; the first read adds `firstOnly`, later
 * reads do not, as when another agent classifies a failed run between two reads. `reads` counts them.
 */
function refusingRepository(firstOnly: string) {
  const repository = mkdtempSync(join(tmpdir(), 'boat-refused-'));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repository });
  git('init', '-q');
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'empty');
  mkdirSync(join(repository, 'scripts'));
  writeFileSync(
    join(repository, 'scripts', 'verify.ts'),
    [
      "import { existsSync, readFileSync, writeFileSync } from 'node:fs';",
      "const reads = existsSync('reads') ? Number(readFileSync('reads', 'utf8')) + 1 : 1;",
      "writeFileSync('reads', String(reads));",
      "console.log('RUN   golden:gg-00 | Explicit selection | 58 proof inputs | no pass since selection');",
      `if (reads === 1) console.log(${JSON.stringify(firstOnly)});`,
    ].join('\n'),
  );
  return { repository, reads: () => Number(readFileSync(join(repository, 'reads'), 'utf8')) };
}

test('a plan refused for its evidence ends as a refusal: no machine, no group run here, the plan read once', async () => {
  const classify =
    'Classify the latest failed run of golden:gg-00 (2026-11-10T063533709Z-1a7986) first: bun run test:runs classify <run-key> <class> "<cause>" "<prevention>".';
  const { repository, reads } = refusingRepository(`[verify] refused: ${classify}`);
  const lines: unknown[] = [];
  const info = spyOn(console, 'info').mockImplementation((line: unknown) => {
    lines.push(line);
  });
  try {
    // An exit code ends scripts/verify.ts before it plans or runs anything here; undefined would run
    // the plan locally, which a second read no longer refuses, every heavy group included.
    expect(
      await prepareAndRun(
        ['--group', 'golden:gg-00'],
        repository,
        'boat_secret',
        new AbortController().signal,
      ),
    ).toBe(1);
  } finally {
    info.mockRestore();
  }
  expect(reads()).toBe(1);
  expect(lines).toEqual([
    `[verify] refused: ${classify}`,
    '[verify] Nothing ran: test:verify refuses this plan, here as on Boat. This is not a pass.',
  ]);
});

test('a full disk on this workstation refuses only here, so the plan still goes to Boat', async () => {
  const { repository } = refusingRepository(
    '[verify] refused on this machine: Only 2.0 GB is available for browser evidence; keep at least 20 GB free.',
  );
  const lines: unknown[] = [];
  const info = spyOn(console, 'info').mockImplementation((line: unknown) => {
    lines.push(line);
  });
  try {
    // The Boat route packs the run first; without a local stack, packing refuses: Boat unavailable.
    const outcome = await prepareAndRun(
      ['--group', 'golden:gg-00'],
      repository,
      'boat_secret',
      new AbortController().signal,
    );
    expect(typeof outcome === 'object' && 'unavailable' in outcome).toBe(true);
  } finally {
    info.mockRestore();
  }
  expect(lines).toEqual([]);
});
