// The trusted docs check (scripts/check-docs.ts with WERKFLOW_DOCS_ROOT) reads a PR's docs as data:
// a link that resolves outside the staged repositories is a problem and is never checked or read.
import { afterAll, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const workspace = mkdtempSync(join(tmpdir(), 'trusted-docs-'));
afterAll(() => rmSync(workspace, { recursive: true, force: true }));

test('S3, S14: in the trusted mode a link outside the staged repositories is a problem, never read', () => {
  const secret = join(workspace, 'secret.md');
  writeFileSync(secret, '# Only on the trusted side\n');
  const app = join(workspace, 'stage', 'werkflow-app');
  for (const folder of ['docs', '.claude/skills', '.agents/skills'])
    mkdirSync(join(app, folder), { recursive: true });
  writeFileSync(join(app, 'AGENTS.md'), '# Agents\n');
  writeFileSync(
    join(app, 'docs', 'README.md'),
    `# Docs\n\n[outside](../../../secret.md#only-on-the-trusted-side)\n`,
  );
  spawnSync('git', ['init', '--quiet'], { cwd: app });
  const report = join(workspace, 'report.json');
  spawnSync(process.execPath, [resolve(import.meta.dir, '../../scripts/check-docs.ts')], {
    cwd: workspace,
    encoding: 'utf8',
    env: { NODE_ENV: 'test', PATH: process.env.PATH, WERKFLOW_DOCS_ROOT: app, WERKFLOW_DOCS_REPORT: report },
  });
  const text = readFileSync(report, 'utf8');
  expect(text).toContain(`trusted: a link resolves to ${secret}, outside the staged repositories`);
  expect(text).not.toContain('Only on the trusted side');
});
