import { afterEach, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readReportHistory } from './report-history';

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

const digest = (character: string): string => character.repeat(64);
const snapshot = {
  version: 1,
  files: { 'lib/a.ts': digest('a'), 'lib/b.ts': digest('b') },
  environment: digest('e'),
};
const result = (groupId: string, status: 'passed' | 'failed') => ({
  groupId,
  fingerprint: digest('f'),
  status,
  startedAt: '2026-10-23T10:00:00.000Z',
  completedAt: '2026-10-23T10:01:00.000Z',
  durationMs: 60_000,
  runKey: null,
  buildId: null,
  logPath: 'x.log',
  reason: null,
});
const report = (id: string, status: 'passed' | 'failed', files = snapshot.files) => ({
  version: 1,
  id,
  startedAt: '2026-10-23T10:00:00.000Z',
  completedAt: '2026-10-23T10:02:00.000Z',
  mode: 'change',
  target: 'local',
  status,
  snapshot: { ...snapshot, files },
  scope: 'all-required-groups',
  jobs: 1,
  selected: ['unit:all'],
  // A reused result written before 2026-10-23 carried its report's whole snapshot.
  results: [{ ...result('unit:all', status), snapshot }],
  measurements: { 'unit:all': { large: 'table' } },
  labCounts: {},
});

function archiveWith(reports: ReturnType<typeof report>[]): { archive: string; cache: string } {
  const root = mkdtempSync(join(tmpdir(), 'report-history-'));
  directories.push(root);
  const archive = join(root, 'verification');
  for (const entry of reports) {
    mkdirSync(join(archive, entry.id), { recursive: true });
    writeFileSync(join(archive, entry.id, 'report.json'), JSON.stringify(entry));
  }
  return { archive, cache: join(root, 'verification-history.json') };
}

test('the history holds every report in start order with its snapshot and results, without the bulk', () => {
  const { archive, cache } = archiveWith([
    report('2026-10-23T1000-a', 'failed'),
    report('2026-10-23T1100-b', 'passed', { ...snapshot.files, 'lib/b.ts': digest('c') }),
  ]);
  const first = readReportHistory(archive, cache);
  expect(first.map((entry) => entry.id)).toEqual(['2026-10-23T1000-a', '2026-10-23T1100-b']);
  expect(first[1]?.snapshot.files['lib/b.ts']).toBe(digest('c'));
  expect(first[0]?.results[0]).not.toHaveProperty('snapshot');
  expect(first[0]).not.toHaveProperty('measurements');
  // The second read comes from the cache and returns the same history.
  expect(readReportHistory(archive, cache)).toEqual(first);
  expect(JSON.parse(readFileSync(cache, 'utf8')).snapshots).toHaveLength(2);
});

test('probe: a rewritten, removed or added report and a damaged cache never serve stale history', () => {
  const { archive, cache } = archiveWith([report('r1', 'failed'), report('r2', 'passed')]);
  readReportHistory(archive, cache);
  // A finished report rewrites its file: the cache entry of the old content no longer counts.
  const file = join(archive, 'r1', 'report.json');
  writeFileSync(file, JSON.stringify(report('r1', 'passed')));
  utimesSync(file, new Date('2026-01-02T10:00:00.000Z'), new Date('2026-01-02T10:00:00.000Z'));
  expect(readReportHistory(archive, cache).map((entry) => entry.status)).toEqual(['passed', 'passed']);
  rmSync(join(archive, 'r2'), { recursive: true });
  expect(readReportHistory(archive, cache).map((entry) => entry.id)).toEqual(['r1']);
  writeFileSync(cache, '{"version":1,"pairs":[],"snapshots":[{"environment":"x","pairs":"7"}]');
  expect(readReportHistory(archive, cache).map((entry) => entry.id)).toEqual(['r1']);
  // An index outside the pair table is a damaged cache, not an empty snapshot.
  const damaged = JSON.parse(readFileSync(cache, 'utf8'));
  damaged.snapshots[0].pairs = '999';
  writeFileSync(cache, JSON.stringify(damaged));
  expect(readReportHistory(archive, cache)[0]?.snapshot.files).toEqual(snapshot.files);
});
