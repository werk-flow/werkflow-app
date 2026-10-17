// Rule test: a push needs a passing report and a review record for its tree.
import { expect, test } from 'bun:test';
import { hashValue, type InputSnapshot } from '../evidence/group-evidence';
import { contentDigest } from '../evidence/source-content';
import {
  publicationGateProblems,
  reviewDigests,
  reviewedFiles,
  reviewRecordSchema,
  reviewScope,
  type ReviewRecord,
} from './publication-gate';

const head = 'a'.repeat(40);
const current: InputSnapshot = {
  version: 1,
  environment: hashValue('local'),
  files: { 'lib/calendar/window.ts': hashValue('one'), 'scripts/verify.ts': hashValue('two') },
};
const report = {
  id: '2026-10-01T100000000Z-report',
  mode: 'change' as const,
  target: 'local' as const,
  status: 'passed' as const,
  scope: 'all-required-groups' as const,
  snapshot: current,
};
const review: ReviewRecord = {
  version: 3,
  head,
  completedAt: '2026-10-01T10:30:00.000Z',
  arguments: ['review', '--agent'],
  reviewedFiles: { 'lib/calendar/window.ts': hashValue('one'), 'scripts/verify.ts': hashValue('two') },
};
const ready = {
  newestReport: report,
  current,
  uncommitted: [],
  head,
  pushed: [head],
  pushedFiles: ['docs/technical/testing.md', 'lib/calendar/window.ts', 'scripts/verify.ts'],
  reviews: [review],
  measuredGroups: [],
  measuredPasses: [],
  production: false,
  canaryReport: undefined,
};

test('a push to main needs a passing release plan and a passing cloud canary on the pushed tree', () => {
  const canary = { ...report, id: '2026-10-01T110000000Z-canary', target: 'cloud' as const };
  const production = { ...ready, production: true };
  // A change plan that opens a preview push does not open production (audit finding B9).
  expect(publicationGateProblems(production)).toEqual([
    expect.stringContaining('bun run test:verify --mode release'),
    expect.stringContaining('bun run test:verify --target cloud'),
  ]);
  const release = { ...report, mode: 'release' as const };
  expect(publicationGateProblems({ ...production, newestReport: release, canaryReport: canary })).toEqual([]);
  // The canary's own environment differs; its files must not.
  expect(
    publicationGateProblems({
      ...production,
      newestReport: release,
      canaryReport: { ...canary, snapshot: { ...current, environment: hashValue('dev') } },
    }),
  ).toEqual([]);
  const older = { ...current, files: { ...current.files, 'scripts/verify.ts': hashValue('older') } };
  expect(
    publicationGateProblems({
      ...production,
      newestReport: release,
      canaryReport: { ...canary, snapshot: older },
    }),
  ).toEqual([
    expect.stringContaining('Cloud canary 2026-10-01T110000000Z-canary passed on a different tree'),
  ]);
  for (const failing of [
    { ...canary, status: 'failed' as const },
    { ...canary, scope: 'selected-groups' as const },
  ])
    expect(publicationGateProblems({ ...production, newestReport: release, canaryReport: failing })).toEqual([
      expect.stringContaining('needs a passing cloud canary'),
    ]);
  // A preview push asks for neither.
  expect(publicationGateProblems({ ...ready, canaryReport: undefined })).toEqual([]);
});

test('a pushed product file a wall-clock group measures needs a passing run of that group on its current content', () => {
  const measured = {
    ...ready,
    measuredGroups: [{ id: 'audit:performance:calendar', changedFiles: ['lib/calendar/window.ts'] }],
  };
  expect(publicationGateProblems(measured)).toEqual([
    expect.stringContaining('bun run test:verify --group audit:performance:calendar'),
  ]);
  // A pass of the group on the current content opens the gate.
  expect(
    publicationGateProblems({
      ...measured,
      measuredPasses: [{ groupId: 'audit:performance:calendar', snapshot: current }],
    }),
  ).toEqual([]);
  // A pass on an older content of the file, or a pass of another group, covers nothing.
  const older = { ...current, files: { ...current.files, 'lib/calendar/window.ts': hashValue('older') } };
  expect(
    publicationGateProblems({
      ...measured,
      measuredPasses: [
        { groupId: 'audit:performance:calendar', snapshot: older },
        { groupId: 'audit:performance:lists', snapshot: current },
      ],
    }),
  ).toHaveLength(1);
});

test('a passing automatic report and a completed review on the pushed tree open the gate', () => {
  expect(publicationGateProblems(ready)).toEqual([]);
  // The routed backend is not part of the source identity, and a deletion pushes no commit.
  expect(
    publicationGateProblems({ ...ready, current: { ...current, environment: hashValue('dev') }, pushed: [] }),
  ).toEqual([]);
  // A review of uncommitted work was recorded under the parent commit; the file contents are what count.
  expect(publicationGateProblems({ ...ready, reviews: [{ ...review, head: 'b'.repeat(40) }] })).toEqual([]);
});

test('each missing piece of evidence is named with the command that produces it', () => {
  expect(publicationGateProblems({ ...ready, newestReport: undefined })).toEqual([
    expect.stringContaining('bun run test:verify'),
  ]);
  expect(publicationGateProblems({ ...ready, newestReport: { ...report, status: 'failed' } })).toEqual([
    expect.stringContaining('is failed'),
  ]);
  expect(
    publicationGateProblems({ ...ready, newestReport: { ...report, scope: 'selected-groups' } }),
  ).toEqual([expect.stringContaining('explicit --group run')]);
  const edited = {
    ...current,
    files: {
      ...current.files,
      'lib/calendar/window.ts': hashValue('edited'),
      'lib/new.ts': hashValue('new'),
    },
  };
  const afterEdit = publicationGateProblems({
    ...ready,
    current: edited,
    pushedFiles: [...ready.pushedFiles, 'lib/new.ts'],
  });
  expect(afterEdit).toHaveLength(2);
  expect(afterEdit[0]).toContain('2 file(s) changed since: lib/calendar/window.ts, lib/new.ts');
  // The edited file and the new file lost their review; the untouched one keeps it.
  expect(afterEdit[1]).toContain('2 changed file(s) as they are now: lib/calendar/window.ts, lib/new.ts');
  expect(publicationGateProblems({ ...ready, reviews: [] })).toEqual([
    expect.stringContaining('.agent-logs/review/<HEAD sha>-<time>.json'),
  ]);
});

test('the evidence covers the working tree, so uncommitted input changes and foreign commits are refused', () => {
  expect(publicationGateProblems({ ...ready, uncommitted: ['lib/calendar/window.ts'] })).toEqual([
    expect.stringContaining('commit the changes first'),
  ]);
  expect(publicationGateProblems({ ...ready, pushed: ['c'.repeat(40)] })).toEqual([
    expect.stringContaining('not the checked-out commit'),
  ]);
});

test('the reviews together cover every changed non-documentation file as it is now', () => {
  const libOnly = { ...review, reviewedFiles: { 'lib/calendar/window.ts': hashValue('one') } };
  expect(publicationGateProblems({ ...ready, reviews: [libOnly] })).toEqual([
    expect.stringContaining('1 changed file(s) as they are now: scripts/verify.ts'),
  ]);
  const scriptsOnly = { ...review, reviewedFiles: { 'scripts/verify.ts': hashValue('two') } };
  expect(publicationGateProblems({ ...ready, reviews: [libOnly, scriptsOnly] })).toEqual([]);
  // A review of an older content of the file covers nothing, whatever else is unchanged.
  const stale = { ...review, reviewedFiles: { 'scripts/verify.ts': hashValue('older content') } };
  expect(publicationGateProblems({ ...ready, reviews: [libOnly, stale] })).toHaveLength(1);
  // A pushed file missing from the snapshot has no content any review saw.
  expect(
    publicationGateProblems({ ...ready, pushedFiles: [...ready.pushedFiles, 'lib/unlisted.ts'] }),
  ).toEqual([expect.stringContaining('1 changed file(s) as they are now: lib/unlisted.ts')]);
});

test('a review record without file digests is an older version and does not parse', () => {
  expect(reviewRecordSchema.safeParse(review).success).toBe(true);
  expect(reviewRecordSchema.safeParse({ ...review, reviewedFiles: undefined, version: 1 }).success).toBe(
    false,
  );
  expect(
    reviewRecordSchema.safeParse({ ...review, version: 2, reviewedFiles: ['scripts/verify.ts'] }).success,
  ).toBe(false);
});

test('a review scope reads its base, its committed flag and its folders from the arguments', () => {
  expect(reviewScope(['review', '--agent', '--uncommitted', '--include-untracked'])).toEqual({
    base: 'HEAD',
    committedOnly: false,
    directories: [],
  });
  expect(reviewScope(['review', '--committed', '--base-commit', 'abc123', '--dir=./lib/testing/'])).toEqual({
    base: 'abc123',
    committedOnly: true,
    directories: ['lib/testing'],
  });
  expect(reviewScope(['review', '--dir', '.githooks']).directories).toEqual(['.githooks']);
  expect(reviewScope(['review', '--dir', '.']).directories).toEqual(['']);
  const changed = ['lib/testing/a.ts', 'lib/testingx/b.ts', 'scripts/verify.ts', 'lib/testing/a.ts'];
  expect(reviewedFiles(changed, ['lib/testing'])).toEqual(['lib/testing/a.ts']);
  expect(reviewedFiles(changed, [])).toEqual(['lib/testing/a.ts', 'lib/testingx/b.ts', 'scripts/verify.ts']);
});

const contentDigestOf = (file: string, text: string): string => contentDigest(file, Buffer.from(text));

test('a committed review certifies the content at HEAD, an uncommitted one the working tree', () => {
  const committed = new Map([['docs/a.txt', Buffer.from('committed')]]);
  const working = new Map([
    ['docs/a.txt', Buffer.from('edited after the commit')],
    ['docs/b.txt', Buffer.from('new')],
  ]);
  const readers = {
    readWorkingTree: (file: string) => working.get(file),
    readCommitted: (file: string) => committed.get(file),
  };
  const changed = ['docs/a.txt', 'docs/b.txt'];
  // The uncommitted edit beside a committed review is not what CodeRabbit compared (audit finding B8).
  expect(
    reviewDigests({
      ...readers,
      changed,
      scope: reviewScope(['review', '--committed', '--base-commit', 'x']),
    }),
  ).toEqual({ 'docs/a.txt': contentDigestOf('docs/a.txt', 'committed') });
  expect(reviewDigests({ ...readers, changed, scope: reviewScope(['review']) })).toEqual({
    'docs/a.txt': contentDigestOf('docs/a.txt', 'edited after the commit'),
    'docs/b.txt': contentDigestOf('docs/b.txt', 'new'),
  });
  // A directory pass certifies its folder only.
  expect(
    Object.keys(reviewDigests({ ...readers, changed, scope: reviewScope(['review', '--dir', 'lib']) })),
  ).toEqual([]);
});
