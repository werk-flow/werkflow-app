import { describe, expect, mock, test } from 'bun:test';

import type { DocumentArchiveRows } from './documents';

type ProfileFiles = NonNullable<DocumentArchiveRows['profileFiles']>;

mock.module('server-only', () => ({}));
const { exportSourceFiles } = await import('./documents');
const { buildDocumentManifest } = await import('./manifest');
const { planFileParts } = await import('./plan');

// The organization export holds the company document profile's logo and
// stationery beside the documents' originals, with the size each recorded as
// stored, and the document manifest lists only documents
// (werk-flow/werkflow-planning#378).

const ORG = '20000000-0000-4000-8000-00000000000a';
const noProfileFile: ProfileFiles = {
  logo_storage_path: null,
  logo_mime_type: null,
  logo_size_bytes: null,
  stationery_first_storage_path: null,
  stationery_first_mime_type: null,
  stationery_first_size_bytes: null,
  stationery_following_storage_path: null,
  stationery_following_mime_type: null,
  stationery_following_size_bytes: null,
};
const archive = (profileFiles: ProfileFiles | null): DocumentArchiveRows => ({
  documents: [],
  versions: [],
  folders: new Map(),
  links: [],
  personnelClasses: new Map(),
  profileFiles,
});

describe('the export file list', () => {
  test('plans each stored profile file under Briefpapier with its size and no document', () => {
    const files = exportSourceFiles(
      archive({
        ...noProfileFile,
        logo_storage_path: `${ORG}/briefpapier/a/logo`,
        logo_mime_type: 'image/jpeg',
        logo_size_bytes: 3072,
        stationery_first_storage_path: `${ORG}/briefpapier/b/stationery_first`,
        stationery_first_mime_type: 'application/pdf',
        stationery_first_size_bytes: 4096,
      }),
    );
    expect(
      files.map(({ sourcePath, documentId, fileBytes }) => ({ sourcePath, documentId, fileBytes })),
    ).toEqual([
      { sourcePath: `${ORG}/briefpapier/a/logo`, documentId: null, fileBytes: 3072 },
      { sourcePath: `${ORG}/briefpapier/b/stationery_first`, documentId: null, fileBytes: 4096 },
    ]);
    expect(planFileParts(files)).toEqual([
      [
        {
          sourcePath: `${ORG}/briefpapier/b/stationery_first`,
          archiveName: 'Dateien/Briefpapier/Briefpapier erste Seite.pdf',
        },
        { sourcePath: `${ORG}/briefpapier/a/logo`, archiveName: 'Dateien/Briefpapier/Logo.jpg' },
      ],
    ]);
  });

  test('an organization without a saved profile or files plans none', () => {
    expect(exportSourceFiles(archive(null))).toEqual([]);
    expect(exportSourceFiles(archive(noProfileFile))).toEqual([]);
  });

  test('the document manifest lists no row for a profile file', () => {
    const rows = buildDocumentManifest(
      archive(noProfileFile),
      [
        {
          document_id: null,
          version_number: null,
          archive_name: 'Dateien/Briefpapier/Logo.jpg',
          file_bytes: 3072,
          partNumber: 2,
        },
      ],
      new Map(),
    );
    expect(rows).toEqual([]);
  });
});
