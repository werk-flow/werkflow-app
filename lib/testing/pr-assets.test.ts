// PR-only images never live in this public repository: no branch holds them
// (.github/scripts/pr-asset-branches.sh, weekly) and no commit adds one (the tracked-image rule
// below). A PR embeds them as assets of the `pr-screenshots` prerelease (the file-pr skill).
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const repositoryRoot = resolve(import.meta.dir, '../..');
const script = join(repositoryRoot, '.github/scripts/pr-asset-branches.sh');

// The roots whose images the repository uses: accepted visual references and the design skill's.
const IMAGE_ROOTS = [
  'tests/audit/visual/references.spec.ts-snapshots/',
  '.claude/skills/werkflow-design/references/',
  '.agents/skills/werkflow-design/references/',
  'public/',
];

test('a committed raster image lives only under a root that uses it, never as a PR-only image', () => {
  const listed = spawnSync('git', ['ls-files', '-z'], { cwd: repositoryRoot, encoding: 'utf8' });
  expect(listed.status).toBe(0);
  const stray = listed.stdout
    .split('\0')
    .filter((path) => /\.(png|jpe?g|gif|webp|avif)$/i.test(path))
    .filter((path) => !IMAGE_ROOTS.some((root) => path.startsWith(root)));
  expect(stray).toEqual([]);
});

// Answers like gh: `--jq` runs through real jq over the refs listed in $STUB/refs.json.
const GH_STUB = `#!/usr/bin/env bash
filter=.
previous=
for argument in "$@"; do
  if test "$previous" = --jq; then filter="$argument"; fi
  previous="$argument"
done
echo "$*" > "$STUB/called"
if test -f "$STUB/broken"; then echo 'HTTP 502' >&2; exit 1; fi
jq -r "$filter" "$STUB/refs.json"
`;

describe('the PR asset branch check', () => {
  let stub = '';

  beforeEach(() => {
    stub = mkdtempSync(join(tmpdir(), 'pr-asset-branches-'));
    writeFileSync(join(stub, 'gh'), GH_STUB);
    chmodSync(join(stub, 'gh'), 0o755);
    writeFileSync(join(stub, 'output'), '');
    writeRefs([]);
  });

  afterEach(() => rmSync(stub, { recursive: true, force: true }));

  function writeRefs(branches: string[]) {
    writeFileSync(
      join(stub, 'refs.json'),
      JSON.stringify(branches.map((branch) => ({ ref: `refs/heads/${branch}` }))),
    );
  }

  function check(extraEnv: Record<string, string> = {}) {
    const result = spawnSync('bash', [script], {
      encoding: 'utf8',
      env: {
        NODE_ENV: 'test',
        PATH: `${stub}:${process.env.PATH}`,
        STUB: stub,
        GITHUB_REPOSITORY: 'owner/repo',
        GITHUB_OUTPUT: join(stub, 'output'),
        ...extraEnv,
      },
    });
    return { status: result.status, printed: `${result.stdout}${result.stderr}` };
  }

  test('passes when no pr-assets branch exists, as a dev check', () => {
    const { status, printed } = check();
    expect(printed).toContain('pr-asset-branches: ok');
    expect(status).toBe(0);
    expect(readFileSync(join(stub, 'called'), 'utf8')).toContain(
      'repos/owner/repo/git/matching-refs/heads/pr-assets/',
    );
    expect(readFileSync(join(stub, 'output'), 'utf8')).toBe('environment=dev\n');
  });

  test('fails and names every pr-assets branch', () => {
    writeRefs(['pr-assets/e7-c2-app-shell', 'pr-assets/e6-c3-screenshot-redraw']);
    const { status, printed } = check();
    expect(printed).toContain('Delete: pr-assets/e7-c2-app-shell pr-assets/e6-c3-screenshot-redraw');
    expect(status).toBe(1);
  });

  test('fails when GitHub cannot list the branches', () => {
    writeFileSync(join(stub, 'broken'), '');
    expect(check().status).toBe(1);
  });

  test('BREAK_CHECK proves that a found branch fails the step', () => {
    writeRefs(['main']);
    const { status, printed } = check({ BREAK_CHECK: 'pr-asset-branches' });
    expect(printed).toContain('Manual proof run');
    expect(readFileSync(join(stub, 'called'), 'utf8')).toContain('/heads/main');
    expect(status).toBe(1);
  });
});
