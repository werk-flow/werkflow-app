// Rule test: `types:generate -- --local` reads the stack on this machine only when that stack has
// this tree's schema (CI, a Boat machine, or a shared stack whose ledger matches the tree), and
// never falls back to the shared stack when Boat is unavailable.
import { expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  acceptedCiTypes,
  typesHereReason,
  typesInputDigest,
  typesOnBoat,
  typesUnavailableNotice,
} from './types-on-boat';

const repositoryRoot = resolve(import.meta.dir, '../../..');
const noDrift = { stackOnly: [], treeOnly: [], changed: [], unverified: [], unknownVersions: [] };

test("CI and a Boat machine read their own stack without asking the shared stack's ledger", () => {
  const readDrift = () => {
    throw new Error('read');
  };
  expect(typesHereReason({ CI: 'true' }, readDrift)).toBe('');
  expect(typesHereReason({ WERKFLOW_BOAT_MACHINE: '1' }, readDrift)).toBe('');
});

test("a workstation reads the shared stack only while its ledger matches the tree's migrations", () => {
  expect(typesHereReason({}, () => noDrift)).toContain("exactly this tree's migrations");
  // The branch's own migration, another branch's, a changed one, and a stack that cannot be read.
  expect(typesHereReason({}, () => ({ ...noDrift, treeOnly: ['add_a_table'] }))).toBeUndefined();
  expect(typesHereReason({}, () => ({ ...noDrift, stackOnly: ['other_branch'] }))).toBeUndefined();
  expect(typesHereReason({}, () => ({ ...noDrift, changed: ['reviewed_again'] }))).toBeUndefined();
  expect(typesHereReason({}, () => undefined)).toBeUndefined();
  // A row `supabase migration repair` wrote matches by name and proves nothing about the SQL.
  expect(typesHereReason({}, () => ({ ...noDrift, unverified: ['repaired'] }))).toBeUndefined();
});

test('without a usable key the types come back as Boat unavailable, never from the shared stack', async () => {
  const absent = await typesOnBoat('/nowhere', () => ({ kind: 'absent' }));
  expect('unavailable' in absent && absent.unavailable).toContain('no Boat key');
  expect(await typesOnBoat('/nowhere', () => ({ kind: 'unusable', reason: 'it expired.' }))).toEqual({
    unavailable: 'it expired.',
  });
});

// CI's SQL job checks out the pull request merged with main, so its file may be another tree's.
test("CI's file is accepted only for the tree it was generated from", () => {
  const repository = mkdtempSync(join(tmpdir(), 'types-from-ci-'));
  const artifact = mkdtempSync(join(tmpdir(), 'types-artifact-'));
  try {
    const write = (path: string, text: string) => {
      mkdirSync(join(repository, path, '..'), { recursive: true });
      writeFileSync(join(repository, path), text);
    };
    write('supabase/migrations/20260101000000_first.sql', 'select 1;\n');
    write('supabase/config.toml', '[db]\nport = 54322\n');
    write('bun.lock', '{}\n');
    write('.prettierrc.json', '{}\n');
    write('scripts/generate-supabase-types.ts', '// generator\n');
    write(
      'lib/supabase/database.types.ts',
      'export type Database = {\n  // Allows to automatically instantiate createClient with right options\n  __InternalSupabase: {\n    PostgrestVersion: "13";\n  };\n  public: {};\n};\n',
    );
    writeFileSync(join(artifact, 'database.types.ts'), 'export type Database = { generated: true };\n');
    expect(acceptedCiTypes(artifact, repository)).toEqual({
      unavailable: "CI's database-types artifact is incomplete.",
    });
    writeFileSync(join(artifact, 'inputs.sha256'), `${typesInputDigest(repository)}\n`);
    expect(acceptedCiTypes(artifact, repository)).toEqual({
      types: 'export type Database = { generated: true };\n',
    });
    // Main's newer migration in CI's merge commit, absent here; then a changed statement; then the pinned tools.
    const before = typesInputDigest(repository);
    write('supabase/migrations/20260102000000_from_main.sql', 'select 2;\n');
    const refused = acceptedCiTypes(artifact, repository);
    expect('unavailable' in refused && refused.unavailable).toContain('another tree than this one');
    rmSync(join(repository, 'supabase/migrations/20260102000000_from_main.sql'));
    expect(typesInputDigest(repository)).toBe(before);
    write('supabase/migrations/20260101000000_first.sql', 'select 3;\n');
    expect(typesInputDigest(repository)).not.toBe(before);
    write('supabase/migrations/20260101000000_first.sql', 'select 1;\n');
    write('bun.lock', '{"changed": true}\n');
    expect(typesInputDigest(repository)).not.toBe(before);
    write('bun.lock', '{}\n');
    // A generation rewrites the types below the header: the check that follows takes the same file.
    write(
      'lib/supabase/database.types.ts',
      'export type Database = {\n  // Allows to automatically instantiate createClient with right options\n  __InternalSupabase: {\n    PostgrestVersion: "13";\n  };\n  public: { generated: true };\n};\n',
    );
    expect(typesInputDigest(repository)).toBe(before);
    write('lib/supabase/database.types.ts', 'export type Database = { public: {} };\n');
    expect(typesInputDigest(repository)).not.toBe(before);
  } finally {
    rmSync(repository, { recursive: true, force: true });
    rmSync(artifact, { recursive: true, force: true });
  }
});

test('the notice says nothing was written and names the way through CI', () => {
  const notice = typesUnavailableNotice('this workstation has no Boat key.', 'CI has no run for abc.');
  expect(notice).toContain('BOAT IS UNAVAILABLE: this workstation has no Boat key.');
  expect(notice.join('\n')).toContain("holds main's migrations, never a\nbranch's");
  expect(notice).toContain('CI: CI has no run for abc.');
});

// The three places that name the file's way home agree: the machine's script, the module and CI.
test('the machine and CI leave the generated file where the workstation reads it', () => {
  const read = (path: string) => readFileSync(resolve(repositoryRoot, path), 'utf8');
  const remote = read('scripts/boat/remote-verify.sh');
  expect(remote).toContain('bun run types:generate -- --local && mkdir -p .agent-logs/types/generated');
  expect(remote).toContain('cp lib/supabase/database.types.ts .agent-logs/types/generated/');
  const ci = read('.github/workflows/ci.yml');
  expect(ci).toContain('WERKFLOW_TYPES_ARTIFACT: ${{ runner.temp }}/database-types/database.types.ts');
  expect(ci).toContain('name: database-types');
});
