import { describe, expect, test } from 'bun:test';
import type { DocumentFolder, OrganizationDocument } from '@/lib/documents/types';
import {
  canDropFolderIdsIntoFolder,
  getDescendantFolderIds,
  getFolderPath,
  getSelectedSourceFolderKeys,
  getSharedSourceFolderId,
  getTopLevelSelectedFolders,
  targetContainsSelectedFolder,
  targetContainsSelectedItemCurrentLocation,
} from './folder-tree';

function folder(id: string, parentFolderId: string | null): DocumentFolder {
  return {
    id,
    organizationId: 'org',
    parentFolderId,
    name: id,
    createdBy: 'user',
    createdAt: '2026-10-01T08:00:00.000Z',
    updatedAt: '2026-10-01T08:00:00.000Z',
    creator: null,
  };
}

function document(id: string, folderId: string | null): OrganizationDocument {
  return {
    id,
    organizationId: 'org',
    folderId,
    category: 'other',
    storageBucket: 'documents',
    storagePath: `org/${id}`,
    originalFileName: `${id}.pdf`,
    displayName: id,
    mimeType: 'application/pdf',
    sizeBytes: 1,
    uploadedBy: 'user',
    copiedFromDocumentId: null,
    currentVersionNumber: 1,
    deletedAt: null,
    deletedBy: null,
    deleteReason: null,
    metadata: {},
    createdAt: '2026-10-01T08:00:00.000Z',
    updatedAt: '2026-10-01T08:00:00.000Z',
    uploader: null,
    links: [],
  };
}

// root ─ a ─ b ─ c, and a sibling tree d
const a = folder('a', null);
const b = folder('b', 'a');
const c = folder('c', 'b');
const d = folder('d', null);
const allFolders = [a, b, c, d];
const foldersById = new Map(allFolders.map((entry) => [entry.id, entry]));

describe('folder paths and descendants', () => {
  test('a path runs from the root to the folder', () => {
    expect(getFolderPath(foldersById, 'c').map((entry) => entry.id)).toEqual(['a', 'b', 'c']);
    expect(getFolderPath(foldersById, null)).toEqual([]);
    expect(getFolderPath(foldersById, 'missing')).toEqual([]);
  });

  test('a parent cycle ends the path instead of looping', () => {
    const cycle = new Map([
      ['x', folder('x', 'y')],
      ['y', folder('y', 'x')],
    ]);
    expect(getFolderPath(cycle, 'x').map((entry) => entry.id)).toEqual(['y', 'x']);
  });

  test('descendants exclude the folders themselves', () => {
    expect([...getDescendantFolderIds(allFolders, new Set(['a']))].sort()).toEqual(['b', 'c']);
    expect([...getDescendantFolderIds(allFolders, new Set(['d']))]).toEqual([]);
  });

  test('a selected folder inside another selected folder is not top level', () => {
    expect(getTopLevelSelectedFolders([b, c, d], allFolders).map((entry) => entry.id)).toEqual(['b', 'd']);
    expect(getTopLevelSelectedFolders([c], allFolders)).toEqual([c]);
  });

  test('a parent cycle above a selected folder ends the ancestor walk', () => {
    const z = folder('z', 'x');
    const cycleFolders = [folder('x', 'y'), folder('y', 'x'), z, d];
    expect(getTopLevelSelectedFolders([z, d], cycleFolders).map((entry) => entry.id)).toEqual(['z', 'd']);
  });
});

describe('move and copy targets', () => {
  test('source folder keys use root for top-level items', () => {
    expect(
      [...getSelectedSourceFolderKeys({ documents: [document('one', null)], folders: [b] })].sort(),
    ).toEqual(['a', 'root']);
  });

  test('the shared source folder is the one folder all items share', () => {
    expect(
      getSharedSourceFolderId({
        documentsToCheck: [document('one', 'b')],
        foldersToCheck: [c],
        fallbackFolderId: 'd',
      }),
    ).toBe('b');
    expect(
      getSharedSourceFolderId({
        documentsToCheck: [document('one', 'a')],
        foldersToCheck: [c],
        fallbackFolderId: 'd',
      }),
    ).toBeNull();
    expect(
      getSharedSourceFolderId({
        documentsToCheck: [document('one', null)],
        foldersToCheck: [],
        fallbackFolderId: 'd',
      }),
    ).toBeNull();
    expect(getSharedSourceFolderId({ documentsToCheck: [], foldersToCheck: [], fallbackFolderId: 'd' })).toBe(
      'd',
    );
  });

  test('a folder cannot move into itself or its subtree', () => {
    expect(
      targetContainsSelectedFolder({ allFolders, foldersToProcess: [a], destinationFolderId: 'a' }),
    ).toBe(true);
    expect(
      targetContainsSelectedFolder({ allFolders, foldersToProcess: [a], destinationFolderId: 'c' }),
    ).toBe(true);
    expect(
      targetContainsSelectedFolder({ allFolders, foldersToProcess: [a], destinationFolderId: 'd' }),
    ).toBe(false);
    expect(
      targetContainsSelectedFolder({ allFolders, foldersToProcess: [a], destinationFolderId: null }),
    ).toBe(false);
  });

  test('an item already in the destination is detected', () => {
    expect(
      targetContainsSelectedItemCurrentLocation({
        documentsToProcess: [document('one', null)],
        foldersToProcess: [],
        destinationFolderId: null,
      }),
    ).toBe(true);
    expect(
      targetContainsSelectedItemCurrentLocation({
        documentsToProcess: [],
        foldersToProcess: [c],
        destinationFolderId: 'b',
      }),
    ).toBe(true);
    expect(
      targetContainsSelectedItemCurrentLocation({
        documentsToProcess: [document('one', 'a')],
        foldersToProcess: [],
        destinationFolderId: 'b',
      }),
    ).toBe(false);
  });

  test('dragged folders may land anywhere outside their own subtree', () => {
    expect(canDropFolderIdsIntoFolder({ allFolders, folderIds: ['a'], targetFolderId: null })).toBe(true);
    expect(canDropFolderIdsIntoFolder({ allFolders, folderIds: ['a'], targetFolderId: 'a' })).toBe(false);
    expect(canDropFolderIdsIntoFolder({ allFolders, folderIds: ['a'], targetFolderId: 'c' })).toBe(false);
    expect(canDropFolderIdsIntoFolder({ allFolders, folderIds: ['b'], targetFolderId: 'd' })).toBe(true);
  });
});
