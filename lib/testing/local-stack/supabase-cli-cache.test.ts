// Rule test: CI and staging take the pinned Supabase CLI from the Actions cache before they
// download it, so an outage of GitHub's release downloads does not stop them
// (.github/actions/supabase-cli/action.yml). The release keeps the direct download: a binary that
// runs with PROD credentials comes only from the pinned release, never from a cache.
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dir, '../../..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');
const SETUP_CLI = 'uses: supabase/setup-cli@';
const CACHED_CLI = 'uses: ./.github/actions/supabase-cli';

test('CI and staging install the Supabase CLI through the cached action', () => {
  for (const path of ['.github/actions/local-stack/action.yml', '.github/workflows/staging.yml']) {
    expect(read(path), path).toContain(CACHED_CLI);
    expect(read(path), path).not.toContain(SETUP_CLI);
  }
  expect(read('.github/workflows/release.yml')).toContain(SETUP_CLI);
  expect(read('.github/workflows/release.yml')).not.toContain(CACHED_CLI);
});

test('the cached action restores first and downloads only on a miss', () => {
  const action = read('.github/actions/supabase-cli/action.yml');
  const restore = action.indexOf('uses: actions/cache/restore@');
  const download = action.indexOf(SETUP_CLI);
  expect(restore).toBeGreaterThan(-1);
  expect(download).toBeGreaterThan(restore);
  expect(action.slice(restore, download)).toContain("if: steps.cli.outputs.cache-hit == 'true'");
  expect(action.slice(download - 120, download)).toContain("if: steps.cli.outputs.cache-hit != 'true'");
});
