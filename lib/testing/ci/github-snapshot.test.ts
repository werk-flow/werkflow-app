// A job without a token reads GitHub from the snapshot its runner staged (github-snapshot.ts): a
// named snapshot is the only source, and a broken one fails rather than fall back to GitHub.
import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { snapshotOf, squashedPullRequests } from './github-snapshot';

const folder = mkdtempSync(join(tmpdir(), 'github-snapshot-'));
afterEach(() => rmSync(join(folder, 'snapshot.json'), { force: true }));

test('without WERKFLOW_GITHUB_SNAPSHOT a job reads GitHub itself', () => {
  expect(snapshotOf({})).toBeUndefined();
});

test("a staged snapshot answers the labels and the open PRs' migrations", () => {
  const file = join(folder, 'snapshot.json');
  writeFileSync(file, JSON.stringify({ labels: { '12': ['approved: list growth'] }, openMigrations: null }));
  expect(snapshotOf({ WERKFLOW_GITHUB_SNAPSHOT: file })).toEqual({
    labels: { '12': ['approved: list growth'] },
    openMigrations: null,
  });
});

test('a named snapshot that is missing or malformed fails the job', () => {
  const file = join(folder, 'snapshot.json');
  expect(() => snapshotOf({ WERKFLOW_GITHUB_SNAPSHOT: file })).toThrow();
  writeFileSync(file, JSON.stringify({ labels: {} }));
  expect(() => snapshotOf({ WERKFLOW_GITHUB_SNAPSHOT: file })).toThrow();
});

test("an integration commit's squash subjects name the PRs whose labels it takes", () => {
  expect(squashedPullRequests('First (#12)\nno number\nSecond (#7)')).toEqual([12, 7]);
});
