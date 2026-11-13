// Rule test: the references a Boat update rewrote enter the working tree only as .png or .txt files
// in an audit snapshot folder; any other path, an absolute path, a ".." segment, a link or a linked
// destination refuses the whole set, and a refused set writes nothing. A reference changed in the
// checkout while the run went keeps its local version, and each version a placement replaced stays
// as recovery data. A failed update run's references come back marked.
import { expect, test } from 'bun:test';
import {
  closeSync,
  copyFileSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

import {
  applyReferenceUpdates,
  collectReferenceUpdates,
  referenceHashes,
  referencePathProblem,
  updateFolder,
} from './reference-updates';

const SNAPSHOTS = 'tests/audit/visual/references.spec.ts-snapshots';

function write(root: string, path: string, text: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}

test('only a .png or .txt file directly in an audit snapshot folder is a reference', () => {
  expect(
    referencePathProblem(`${SNAPSHOTS}/zeiterfassung-einstellungen-desktop-dark-linux.png`),
  ).toBeUndefined();
  expect(
    referencePathProblem(`${SNAPSHOTS}/zeiterfassung-einstellungen-desktop-dark-linux.txt`),
  ).toBeUndefined();
  expect(referencePathProblem(`/repo/${SNAPSHOTS}/a.png`)).toContain('absolute');
  expect(referencePathProblem(`${SNAPSHOTS}/../../../../lib/a.png`)).toContain('".."');
  expect(referencePathProblem(`${SNAPSHOTS}/./a.png`)).toContain('".."');
  expect(referencePathProblem(`${SNAPSHOTS}//a.png`)).toContain('empty');
  for (const other of [
    `${SNAPSHOTS}/a.ts`,
    `${SNAPSHOTS}/a.png.sh`,
    `${SNAPSHOTS}/sub/a.png`,
    `${SNAPSHOTS}/.hidden.png`,
    'tests/golden/gg-00.spec.ts-snapshots/a.png',
    'tests/audit/visual/references.spec.ts',
    'lib/a.png',
    'a.png',
  ])
    expect(referencePathProblem(other)).toContain('no .png or .txt file in an audit snapshot folder');
});

test('the machine collects only the references the update rewrote or wrote', () => {
  const repository = mkdtempSync(join(tmpdir(), 'reference-collect-'));
  write(repository, `${SNAPSHOTS}/same.png`, 'same');
  write(repository, `${SNAPSHOTS}/changed.png`, 'old');
  write(repository, 'tests/audit/visual/references.spec.ts', 'spec');
  const before = referenceHashes(repository);
  expect([...before.keys()].sort()).toEqual([`${SNAPSHOTS}/changed.png`, `${SNAPSHOTS}/same.png`]);
  write(repository, `${SNAPSHOTS}/changed.png`, 'new');
  write(repository, `${SNAPSHOTS}/written.txt`, 'text');
  const folder = join(repository, '.agent-logs/visual-reference-updates/run');
  expect(collectReferenceUpdates(repository, before, folder)).toEqual([
    `${SNAPSHOTS}/changed.png`,
    `${SNAPSHOTS}/written.txt`,
  ]);
  expect(readFileSync(join(folder, SNAPSHOTS, 'changed.png'), 'utf8')).toBe('new');
  expect(existsSync(join(folder, SNAPSHOTS, 'same.png'))).toBe(false);
  expect(existsSync(join(repository, '.reference-updates-collecting'))).toBe(false);
});

test('an update that rewrote nothing collects nothing and succeeds', () => {
  const repository = mkdtempSync(join(tmpdir(), 'reference-collect-'));
  write(repository, `${SNAPSHOTS}/same.png`, 'same');
  const folder = join(repository, '.agent-logs/visual-reference-updates/run');
  expect(collectReferenceUpdates(repository, referenceHashes(repository), folder)).toEqual([]);
  expect(existsSync(folder)).toBe(false);
});

test('a collection that fails leaves no folder to come back, not even part of one', () => {
  const repository = mkdtempSync(join(tmpdir(), 'reference-collect-'));
  write(repository, `${SNAPSHOTS}/changed.png`, 'new');
  // The update folder's parent is a file, so publishing the set fails after the copies were made.
  write(repository, '.agent-logs/visual-reference-updates', 'not a folder');
  const folder = join(repository, '.agent-logs/visual-reference-updates/run');
  expect(() => collectReferenceUpdates(repository, new Map(), folder)).toThrow();
  expect(existsSync(folder)).toBe(false);
  expect(existsSync(join(repository, '.reference-updates-collecting'))).toBe(false);
});

test('rewritten references are placed in the checkout, and any bad entry refuses the whole set', () => {
  const placed = (build: (update: string, repository: string) => void) => {
    const repository = mkdtempSync(join(tmpdir(), 'reference-apply-'));
    const update = mkdtempSync(join(tmpdir(), 'reference-update-'));
    write(repository, `${SNAPSHOTS}/kept.png`, 'old');
    write(update, `${SNAPSHOTS}/kept.png`, 'new');
    build(update, repository);
    try {
      return {
        files: applyReferenceUpdates(repository, update, {
          before: referenceHashes(repository),
          recovery: join(repository, 'replaced'),
        }).placed,
        repository,
      };
    } catch (error) {
      // Nothing was written: the existing reference keeps its bytes.
      expect(readFileSync(join(repository, SNAPSHOTS, 'kept.png'), 'utf8')).toBe('old');
      return { error: error instanceof Error ? error.message : String(error), repository };
    }
  };

  const good = placed((update) => write(update, `${SNAPSHOTS}/new.txt`, 'text'));
  expect(good.files).toEqual([`${SNAPSHOTS}/kept.png`, `${SNAPSHOTS}/new.txt`]);
  expect(readFileSync(join(good.repository, SNAPSHOTS, 'kept.png'), 'utf8')).toBe('new');

  expect(placed((update) => write(update, 'lib/planted.ts', 'x')).error).toContain('"lib/planted.ts" is no');
  expect(placed((update) => write(update, `${SNAPSHOTS}/run.sh`, 'x')).error).toContain('is no .png');
  expect(
    placed((update) => symlinkSync('/etc/hostname', join(update, SNAPSHOTS, 'link.png'))).error,
  ).toContain('is not a regular file');
  expect(
    placed((update) => linkSync(join(update, SNAPSHOTS, 'kept.png'), join(update, SNAPSHOTS, 'twin.png')))
      .error,
  ).toContain('hard link');
  // A destination reached through a symbolic link in the checkout is never written through.
  expect(
    placed((update, repository) => {
      const outside = mkdtempSync(join(tmpdir(), 'reference-outside-'));
      mkdirSync(join(repository, 'tests/audit/layout'), { recursive: true });
      symlinkSync(outside, join(repository, 'tests/audit/layout/linked.spec.ts-snapshots'));
      write(update, 'tests/audit/layout/linked.spec.ts-snapshots/a.png', 'x');
    }).error,
  ).toContain('symbolic link');
  // An existing destination that is a hard link or no regular file is never replaced.
  expect(
    placed((_update, repository) =>
      linkSync(join(repository, SNAPSHOTS, 'kept.png'), join(repository, SNAPSHOTS, 'twin-of-kept.png')),
    ).error,
  ).toContain('hard link in the checkout');
  expect(
    placed((update, repository) => {
      mkdirSync(join(repository, SNAPSHOTS, 'folder.png'));
      write(update, `${SNAPSHOTS}/folder.png`, 'x');
    }).error,
  ).toContain('is not a regular file');
});

test('a reference changed in the checkout during the run keeps its local version; the others are placed', () => {
  const repository = mkdtempSync(join(tmpdir(), 'reference-apply-'));
  const update = mkdtempSync(join(tmpdir(), 'reference-update-'));
  write(repository, `${SNAPSHOTS}/unchanged.png`, 'old');
  write(repository, `${SNAPSHOTS}/edited.png`, 'old');
  write(repository, `${SNAPSHOTS}/removed.png`, 'old');
  const before = referenceHashes(repository);
  for (const name of ['unchanged.png', 'edited.png', 'removed.png', 'created.txt', 'new.txt'])
    write(update, `${SNAPSHOTS}/${name}`, 'boat');
  // While the run goes: one reference is edited, one removed and one written here.
  write(repository, `${SNAPSHOTS}/edited.png`, 'local edit');
  rmSync(join(repository, SNAPSHOTS, 'removed.png'));
  write(repository, `${SNAPSHOTS}/created.txt`, 'local');
  expect(
    applyReferenceUpdates(repository, update, { before, recovery: join(repository, 'replaced') }),
  ).toEqual({
    placed: [`${SNAPSHOTS}/new.txt`, `${SNAPSHOTS}/unchanged.png`],
    kept: [`${SNAPSHOTS}/created.txt`, `${SNAPSHOTS}/edited.png`, `${SNAPSHOTS}/removed.png`],
  });
  const read = (name: string) => readFileSync(join(repository, SNAPSHOTS, name), 'utf8');
  expect(read('unchanged.png')).toBe('boat');
  expect(read('new.txt')).toBe('boat');
  expect(read('edited.png')).toBe('local edit');
  expect(read('created.txt')).toBe('local');
  expect(existsSync(join(repository, SNAPSHOTS, 'removed.png'))).toBe(false);
  // Boat's copy of each kept reference stays with the evidence.
  expect(readFileSync(join(update, SNAPSHOTS, 'edited.png'), 'utf8')).toBe('boat');
});

test('a reference changed here while the update is placed keeps its local version', () => {
  const repository = mkdtempSync(join(tmpdir(), 'reference-apply-'));
  const update = mkdtempSync(join(tmpdir(), 'reference-update-'));
  for (const name of ['edited.png', 'removed.png']) write(repository, `${SNAPSHOTS}/${name}`, 'old');
  const before = referenceHashes(repository);
  for (const name of ['edited.png', 'removed.png', 'created.txt'])
    write(update, `${SNAPSHOTS}/${name}`, 'boat');
  // Each local change lands after Boat's copy is staged next to its destination, before the replacement.
  const during: Record<string, () => void> = {
    'edited.png': () => write(repository, `${SNAPSHOTS}/edited.png`, 'local edit'),
    'removed.png': () => rmSync(join(repository, SNAPSHOTS, 'removed.png')),
    'created.txt': () => write(repository, `${SNAPSHOTS}/created.txt`, 'local'),
  };
  const copy = (from: string, to: string) => {
    copyFileSync(from, to);
    during[basename(from)]?.();
  };
  expect(
    applyReferenceUpdates(repository, update, { before, recovery: join(repository, 'replaced'), copy }),
  ).toEqual({
    placed: [],
    kept: [`${SNAPSHOTS}/created.txt`, `${SNAPSHOTS}/edited.png`, `${SNAPSHOTS}/removed.png`],
  });
  expect(readFileSync(join(repository, SNAPSHOTS, 'edited.png'), 'utf8')).toBe('local edit');
  expect(readFileSync(join(repository, SNAPSHOTS, 'created.txt'), 'utf8')).toBe('local');
  expect(existsSync(join(repository, SNAPSHOTS, 'removed.png'))).toBe(false);
  // No staged copy or moved-aside version is left next to the references.
  expect(readdirSync(join(repository, SNAPSHOTS)).sort()).toEqual(['created.txt', 'edited.png']);
});

test('a failed update run publishes its references in a marked folder', () => {
  expect(updateFolder('2026-11-13T050000Z', '0')).toBe(
    '.agent-logs/visual-reference-updates/2026-11-13T050000Z',
  );
  expect(updateFolder('2026-11-13T050000Z', '1')).toBe(
    '.agent-logs/visual-reference-updates/2026-11-13T050000Z-failed-run',
  );
});

test('a write through a descriptor opened before the replacement is recoverable', () => {
  const repository = mkdtempSync(join(tmpdir(), 'reference-apply-'));
  const update = mkdtempSync(join(tmpdir(), 'reference-update-'));
  write(repository, `${SNAPSHOTS}/a.png`, 'old');
  write(update, `${SNAPSHOTS}/a.png`, 'boat');
  const before = referenceHashes(repository);
  const recovery = join(repository, 'replaced');
  // An editor holds the reference open from before the run and writes after the hash check.
  const descriptor = openSync(join(repository, SNAPSHOTS, 'a.png'), 'r+');
  try {
    expect(applyReferenceUpdates(repository, update, { before, recovery })).toEqual({
      placed: [`${SNAPSHOTS}/a.png`],
      kept: [],
    });
    writeSync(descriptor, 'late');
  } finally {
    closeSync(descriptor);
  }
  expect(readFileSync(join(repository, SNAPSHOTS, 'a.png'), 'utf8')).toBe('boat');
  expect(readFileSync(join(recovery, SNAPSHOTS, 'a.png'), 'utf8')).toBe('late');
});
