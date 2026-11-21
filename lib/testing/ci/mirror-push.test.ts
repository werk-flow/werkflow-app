// The CI mirror's tree sync (scripts/ci/mirror-push.ts) on a throwaway repository and a bare remote:
// the pushed commit is parentless, by the neutral identity, and holds the source tree with exactly
// one workflow, the mirror's own; every source workflow sits unchanged in .github/held-workflows.
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildMirrorCommit,
  DEFAULT_MIRROR_IDENTITY,
  mirrorIdentity,
  pushMirrorCommit,
} from '../../../scripts/ci/mirror-push';
import { HELD_WORKFLOWS, MIRROR_WORKFLOW } from './mirror';

let folder = '';
let source = '';
let remote = '';
let commit = '';
const WORKFLOW = 'name: CI mirror\non:\n  push:\n    branches: [ci/**]\n';

const git = (cwd: string, ...args: string[]): string =>
  execFileSync(
    'git',
    [
      '-c',
      'user.name=Owner',
      '-c',
      'user.email=owner@example.invalid',
      '-c',
      'commit.gpgSign=false',
      ...args,
    ],
    { cwd, encoding: 'utf8' },
  ).trim();

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'mirror-push-'));
  source = join(folder, 'source');
  remote = join(folder, 'mirror.git');
  for (const [path, text] of Object.entries({
    'README.md': 'The app\n',
    'scripts/ci/job.ts': 'console.info("job");\n',
    '.github/workflows/ci.yml': 'name: CI\n',
    '.github/workflows/release.yml': 'name: Release\n',
    '.github/actions/setup/action.yml': 'name: Setup\n',
  })) {
    mkdirSync(join(source, path, '..'), { recursive: true });
    writeFileSync(join(source, path), text);
  }
  git(folder, 'init', '--quiet', '--initial-branch=main', source);
  git(source, 'add', '.');
  git(source, 'commit', '--quiet', '-m', 'source');
  git(source, 'commit', '--quiet', '--allow-empty', '-m', 'second');
  commit = git(source, 'rev-parse', 'HEAD');
  git(folder, 'init', '--quiet', '--bare', remote);
});

afterEach(() => rmSync(folder, { recursive: true, force: true }));

const files = (repository: string, revision: string): Record<string, string> =>
  Object.fromEntries(
    git(repository, 'ls-tree', '-r', '--full-tree', revision)
      .split('\n')
      .map((line) => {
        const [meta = '', path = ''] = line.split('\t');
        return [path, meta.split(' ')[2] ?? ''];
      }),
  );

const build = (identity = DEFAULT_MIRROR_IDENTITY) =>
  buildMirrorCommit({
    repository: source,
    commit,
    workflow: WORKFLOW,
    identity,
    message: 'CI mirror run\n\n{}\n',
    date: new Date('2026-11-21T10:00:00.000Z'),
  });

test('the mirror commit holds the source tree with every workflow held aside and the mirror workflow alone in place', () => {
  const built = build();
  const before = files(source, commit);
  const after = files(source, built.commit);
  expect(git(source, 'rev-parse', `${built.commit}^{tree}`)).toBe(built.tree);
  expect(built.sourceTree).toBe(git(source, 'rev-parse', `${commit}^{tree}`));
  expect(Object.keys(after).filter((path) => path.startsWith('.github/workflows/'))).toEqual([
    MIRROR_WORKFLOW,
  ]);
  expect(git(source, 'show', `${built.commit}:${MIRROR_WORKFLOW}`)).toBe(WORKFLOW.trimEnd());
  // Every other path keeps its exact object; each workflow keeps its object under the held folder.
  const expected = Object.fromEntries(
    Object.entries(before).map(([path, object]) => [
      path.replace(/^\.github\/workflows\//, `${HELD_WORKFLOWS}/`),
      object,
    ]),
  );
  const { [MIRROR_WORKFLOW]: placed, ...rest } = after;
  expect(placed).toBeDefined();
  expect(rest).toEqual(expected);
});

test('the mirror commit has no parent and names only the neutral identity, never the source commit or its people', () => {
  const built = build();
  expect(git(source, 'rev-list', '--parents', '-n', '1', built.commit)).toBe(built.commit);
  expect(git(source, 'log', '-1', '--format=%an <%ae>|%cn <%ce>', built.commit)).toBe(
    'CI mirror <ci-mirror@ci.invalid>|CI mirror <ci-mirror@ci.invalid>',
  );
  const raw = git(source, 'cat-file', '-p', built.commit);
  expect(raw).not.toContain(commit);
  expect(raw).not.toContain('owner@example.invalid');
  expect(() => build({ name: 'Owner', email: 'owner@example.invalid' })).toThrow("source commit's own");
  expect(() => mirrorIdentity('Werk Flow Bot <bot@werk-flow.app>')).toThrow('names WerkFlow');
  expect(() => mirrorIdentity('no address')).toThrow('Name <email>');
  expect(mirrorIdentity('Builder <builder@ci.invalid>')).toEqual({
    name: 'Builder',
    email: 'builder@ci.invalid',
  });
});

test('a source that already holds the held folder is refused, so no workflow can hide in it', () => {
  mkdirSync(join(source, HELD_WORKFLOWS), { recursive: true });
  writeFileSync(join(source, HELD_WORKFLOWS, 'extra.yml'), 'name: Extra\n');
  git(source, 'add', '.');
  git(source, 'commit', '--quiet', '-m', 'held');
  commit = git(source, 'rev-parse', 'HEAD');
  expect(() => build()).toThrow(`holds ${HELD_WORKFLOWS}`);
});

test('the push places the commit on its ci branch, replaces an earlier push of it, and the remote holds exactly the built tree', () => {
  const branch = `ci/${commit}-a1/sql`;
  const first = build();
  pushMirrorCommit({ repository: source, remote, commit: first.commit, branch, token: undefined });
  expect(git(remote, 'rev-parse', `refs/heads/${branch}`)).toBe(first.commit);
  expect(git(remote, 'rev-parse', `refs/heads/${branch}^{tree}`)).toBe(first.tree);
  const again = buildMirrorCommit({
    repository: source,
    commit,
    workflow: WORKFLOW,
    identity: DEFAULT_MIRROR_IDENTITY,
    message: 'CI mirror run\n\n{"again":true}\n',
    date: new Date('2026-11-21T11:00:00.000Z'),
  });
  pushMirrorCommit({ repository: source, remote, commit: again.commit, branch, token: undefined });
  expect(git(remote, 'rev-parse', `refs/heads/${branch}`)).toBe(again.commit);
  expect(again.tree).toBe(first.tree);
  // Only the pushed commit and its tree reached the remote: no branch of the source.
  expect(git(remote, 'for-each-ref', '--format=%(refname)')).toBe(`refs/heads/${branch}`);
  expect(() =>
    pushMirrorCommit({ repository: source, remote, commit: again.commit, branch, token: 'secret' }),
  ).toThrow('https remote only');
});

test('a workflow path with a tab or a line break moves aside whole, and the mirror workflow stays the only active one', () => {
  for (const name of ['tab\there.yml', 'line\nbreak.yml'])
    writeFileSync(join(source, '.github/workflows', name), 'name: Odd\n');
  git(source, 'add', '.');
  git(source, 'commit', '--quiet', '-m', 'odd names');
  commit = git(source, 'rev-parse', 'HEAD');
  const built = build();
  const paths = git(source, 'ls-tree', '-r', '-z', '--name-only', '--full-tree', built.tree)
    .split('\0')
    .filter(Boolean);
  expect(paths.filter((path) => path.startsWith('.github/workflows/'))).toEqual([MIRROR_WORKFLOW]);
  expect(paths).toContain(`${HELD_WORKFLOWS}/tab\there.yml`);
  expect(paths).toContain(`${HELD_WORKFLOWS}/line\nbreak.yml`);
});
