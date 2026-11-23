// A job without a token reads GitHub from the snapshot its runner staged (github-snapshot.ts): a
// named snapshot is the only source, and a broken one fails rather than fall back to GitHub.
import { afterEach, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { snapshotOf } from './github-snapshot';

const folder = mkdtempSync(join(tmpdir(), 'github-snapshot-'));
const file = join(folder, 'snapshot.json');
afterEach(() => rmSync(file, { force: true }));

test('without WERKFLOW_GITHUB_SNAPSHOT a job reads GitHub itself', () => {
  expect(snapshotOf({})).toBeUndefined();
});

test('a named snapshot that is missing or malformed fails the job', () => {
  expect(() => snapshotOf({ WERKFLOW_GITHUB_SNAPSHOT: file })).toThrow();
  writeFileSync(file, JSON.stringify({ labels: {} }));
  expect(() => snapshotOf({ WERKFLOW_GITHUB_SNAPSHOT: file })).toThrow();
});

test("S20: a head's integration run takes the approval captured at admission, never a label or a commit subject", () => {
  writeFileSync(file, JSON.stringify({ approved: true, openMigrations: [] }));
  const exported = join(folder, 'job.env');
  writeFileSync(exported, '');
  const ran = spawnSync(
    process.execPath,
    [resolve(import.meta.dir, '../../../scripts/ci/prepare.ts'), 'approval'],
    {
      cwd: folder,
      encoding: 'utf8',
      env: {
        NODE_ENV: 'test',
        // No `gh` and no git history: the step may read neither.
        PATH: '/nonexistent',
        CI_EVENT: 'integration',
        CI_PRS: '5',
        CI_BASE_SHA: 'a'.repeat(40),
        GITHUB_ENV: exported,
        WERKFLOW_GITHUB_SNAPSHOT: file,
      },
    },
  );
  expect(ran.status, ran.stderr).toBe(0);
  expect(readFileSync(exported, 'utf8')).toBe('SHRINK_ONLY_GROWTH_APPROVED=true\n');
});
