import { createHash, randomUUID } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative } from 'node:path';

import { destinationConflict, linkedDestination } from './verify-on-boat';

// A visual reference update runs on Boat (docs/technical/standards-audit.md, "To update references
// after an intended design change"). On the machine, the references are hashed before the update and
// the ones it rewrote or wrote are copied into a new evidence folder, which comes back with the run's
// evidence. On the workstation, that folder's files are checked and placed in the checkout: this is
// where files from a machine enter the working tree, so only the audit suite's references pass.

/** Where the machine puts the references an update rewrote, one folder per update. */
export const REFERENCE_UPDATES = '.agent-logs/visual-reference-updates';
/** Ends the folder of an update run that failed: its references stay evidence, never references. */
export const FAILED_RUN = '-failed-run';
/** Where the workstation keeps each checkout version an update replaced, one folder per update. */
export const REPLACED_REFERENCES = '.agent-logs/visual-reference-replaced';
/** The audit suite's snapshot folders. */
const SNAPSHOTS = /^tests\/audit\/(?:[a-z0-9-]+\/)*[a-z0-9-]+\.spec\.ts-snapshots$/;
/** A reference file: an image or its text twin, with a plain name, directly in a snapshot folder. */
const REFERENCE = /^[A-Za-z0-9][A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]+)*\.(?:png|txt)$/;

/** Why `path`, relative to the checkout, is no reference an update may write, or undefined. */
export function referencePathProblem(path: string): string | undefined {
  if (isAbsolute(path)) return `${JSON.stringify(path)} is an absolute path.`;
  const parts = path.split('/');
  if (parts.some((part) => part === '..' || part === '.' || part === ''))
    return `${JSON.stringify(path)} has a "..", "." or empty segment.`;
  if (!SNAPSHOTS.test(parts.slice(0, -1).join('/')) || !REFERENCE.test(parts.at(-1) ?? ''))
    return `${JSON.stringify(path)} is no .png or .txt file in an audit snapshot folder.`;
  return undefined;
}

/** The update folder, relative to the checkout, for an update run started at `stamp` that exited `exitCode`. */
export function updateFolder(stamp: string, exitCode: string): string {
  return join(REFERENCE_UPDATES, exitCode === '0' ? stamp : `${stamp}${FAILED_RUN}`);
}

/** Every regular file under `folder`, relative to it; a link or any other kind of entry throws. */
export function filesUnder(folder: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(folder, { recursive: true, withFileTypes: true })) {
    const path = relative(folder, join(entry.parentPath, entry.name));
    if (entry.isDirectory()) continue;
    if (!entry.isFile()) throw new Error(`${JSON.stringify(path)} is not a regular file.`);
    if (lstatSync(join(folder, path)).nlink > 1) throw new Error(`${JSON.stringify(path)} is a hard link.`);
    files.push(path);
  }
  return files.sort();
}

/** The sha256 of a file's bytes. */
function hashOf(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

/** The audit suite's references in `repository` with the hash of each, by path. */
export function referenceHashes(repository: string): Map<string, string> {
  const hashes = new Map<string, string>();
  const audit = join(repository, 'tests/audit');
  if (!existsSync(audit)) return hashes;
  for (const entry of readdirSync(audit, { recursive: true, withFileTypes: true })) {
    const path = relative(repository, join(entry.parentPath, entry.name));
    if (!entry.isFile() || referencePathProblem(path)) continue;
    hashes.set(path, hashOf(join(repository, path)));
  }
  return hashes;
}

/**
 * On the machine, after the update: copies every reference that is new or differs from `before`
 * into `folder` under its own path, and answers the paths. The copies gather in a staging folder in
 * the checkout, outside the evidence, and `folder` appears only once every copy is made: a failure
 * throws and leaves no folder, so no part of a set comes back.
 */
export function collectReferenceUpdates(
  repository: string,
  before: ReadonlyMap<string, string>,
  folder: string,
): string[] {
  const changed = [...referenceHashes(repository)]
    .filter(([path, hash]) => before.get(path) !== hash)
    .map(([path]) => path)
    .sort();
  // Nothing rewritten: no folder, and the run keeps its exit code.
  if (!changed.length) return changed;
  const staging = join(repository, '.reference-updates-collecting');
  rmSync(staging, { recursive: true, force: true });
  try {
    for (const path of changed) {
      mkdirSync(dirname(join(staging, path)), { recursive: true });
      copyFileSync(join(repository, path), join(staging, path));
    }
    mkdirSync(dirname(folder), { recursive: true });
    renameSync(staging, folder);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
  return changed;
}

/** Whether `error` is a file system error with this code. */
function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}

/** Links `from` to `to` unless `to` exists, and answers whether it did. */
function linkUnlessPresent(from: string, to: string): boolean {
  try {
    linkSync(from, to);
    return true;
  } catch (error) {
    if (hasCode(error, 'EEXIST')) return false;
    throw error;
  }
}

/**
 * Replaces the reference `path` with `folder`'s copy only while the checkout's file still has the
 * hash `expected`, or is still absent when `expected` is undefined, and answers whether it did. No
 * step overwrites a file: the checkout's version moves aside into `recovery` and is checked there,
 * and each file is linked into place, which fails when a file appeared meanwhile. A changed version
 * goes back; a replaced one stays in `recovery`, with every write made through a descriptor opened
 * before it moved.
 */
function placeUnchanged(
  repository: string,
  folder: string,
  path: string,
  expected: string | undefined,
  { recovery, copy }: { recovery: string; copy: (from: string, to: string) => void },
): boolean {
  const target = join(repository, path);
  mkdirSync(dirname(target), { recursive: true });
  const temp = join(dirname(target), `.reference-update-${randomUUID()}`);
  const aside = join(recovery, path);
  const restore = () => {
    if (!linkUnlessPresent(aside, target))
      throw new Error(
        `${path} changed here during placement; its earlier version is kept at ${relative(repository, aside)}.`,
      );
    rmSync(aside);
  };
  try {
    copy(join(folder, path), temp);
    if (expected === undefined) return linkUnlessPresent(temp, target);
    mkdirSync(dirname(aside), { recursive: true });
    try {
      renameSync(target, aside);
    } catch (error) {
      if (hasCode(error, 'ENOENT')) return false;
      throw error;
    }
    let placed: boolean;
    try {
      placed = hashOf(aside) === expected && linkUnlessPresent(temp, target);
    } catch (error) {
      restore();
      throw error;
    }
    if (!placed) restore();
    return placed;
  } finally {
    rmSync(temp, { force: true });
  }
}

/**
 * On the workstation: checks every file of an update folder and places it in the checkout. A file
 * that is no audit reference, a link or a hard link refuses the whole set and writes nothing, as
 * does a destination reached through a symbolic link, or one that exists and is no regular file or
 * is a hard link, as for the results import (verify-on-boat.ts). A destination that changed here
 * since `before`, the hashes taken when the run started (edited, written or removed), keeps this
 * checkout's version up to its replacement; Boat's copy stays in `folder`, with the evidence. Each
 * version a placed file replaced stays in `recovery`. `copy` is a test's seam into placement.
 */
export function applyReferenceUpdates(
  repository: string,
  folder: string,
  {
    before,
    recovery,
    copy = copyFileSync,
  }: {
    before: ReadonlyMap<string, string>;
    recovery: string;
    copy?: (from: string, to: string) => void;
  },
): { placed: string[]; kept: string[] } {
  const files = filesUnder(folder);
  const problem =
    files.map(referencePathProblem).find((found) => found !== undefined) ??
    linkedDestination(repository, files) ??
    destinationConflict(repository, files);
  if (problem) throw new Error(`The rewritten references were refused: ${problem}`);
  const placed: string[] = [];
  const kept: string[] = [];
  for (const path of files) {
    try {
      (placeUnchanged(repository, folder, path, before.get(path), { recovery, copy }) ? placed : kept).push(
        path,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Placing ${path} failed: ${message} The references placed before it show in git status.`,
      );
    }
  }
  return { placed, kept };
}
