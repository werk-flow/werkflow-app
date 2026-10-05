import { expect, test } from 'bun:test';
import {
  assertOrganizationStorageKey,
  copyStorageObject,
  createSignedDownloadUrl,
  createSignedUploadUrl,
  deleteStorageObjects,
  discardStorageObjects,
  headStorageObject,
  listStorageObjectPaths,
  putStorageObject,
} from './r2';

const organizationId = '0f0c2e3a-6d4f-4d3a-9e58-2c7b3b7f1a11';
const otherOrganizationId = '9b1d0f7e-2a6c-4c1f-8f3e-0d5a6e7c8b22';
const refusal = 'storage_key_outside_organization';

test('accepts a document, a version and a payroll-export key of the organization', () => {
  expect(() =>
    assertOrganizationStorageKey(organizationId, `${organizationId}/documents/doc-1/Angebot.pdf`),
  ).not.toThrow();
  expect(() =>
    assertOrganizationStorageKey(organizationId, `${organizationId}/documents/doc-1/versions/2/Angebot.pdf`),
  ).not.toThrow();
  expect(() =>
    assertOrganizationStorageKey(organizationId, `${organizationId}/lohnexporte/2026-08-01/export-1.zip`),
  ).not.toThrow();
});

test('refuses a key under another organization, a traversal segment and an empty organization id', () => {
  expect(() =>
    assertOrganizationStorageKey(organizationId, `${otherOrganizationId}/documents/doc-1/Angebot.pdf`),
  ).toThrow(refusal);
  expect(() =>
    assertOrganizationStorageKey(
      organizationId,
      `${organizationId}/../${otherOrganizationId}/documents/doc-1/Angebot.pdf`,
    ),
  ).toThrow(refusal);
  expect(() =>
    assertOrganizationStorageKey(organizationId, `${organizationId}//documents/doc-1/Angebot.pdf`),
  ).toThrow(refusal);
  expect(() => assertOrganizationStorageKey('', '/documents/doc-1/Angebot.pdf')).toThrow(refusal);
  expect(() => assertOrganizationStorageKey(organizationId, organizationId)).toThrow(refusal);
});

test('refuses an organization id that is not a uuid even when the key starts with it', () => {
  for (const notUuid of ['documents', 'org-1', `${organizationId}x`, '..']) {
    expect(() => assertOrganizationStorageKey(notUuid, `${notUuid}/documents/doc-1/Angebot.pdf`)).toThrow(
      refusal,
    );
  }
});

// Every operation, each with one call per refusal. Every case must be refused
// before the storage client is reached. An accepted key is not exercised here:
// the unit runner may carry real R2 configuration, and a unit test must not
// call the bucket.
const operations: ReadonlyArray<{
  name: string;
  call: (scope: { organizationId: string; path: string }) => Promise<unknown>;
}> = [
  {
    name: 'signed upload',
    call: (scope) => createSignedUploadUrl({ ...scope, contentType: 'application/pdf' }),
  },
  { name: 'signed download', call: (scope) => createSignedDownloadUrl(scope) },
  { name: 'head', call: (scope) => headStorageObject(scope) },
  {
    name: 'copy source',
    call: ({ organizationId: scopeId, path }) =>
      copyStorageObject({
        organizationId: scopeId,
        sourcePath: path,
        targetPath: `${scopeId}/documents/doc-2/Angebot.pdf`,
      }),
  },
  {
    name: 'copy target',
    call: ({ organizationId: scopeId, path }) =>
      copyStorageObject({
        organizationId: scopeId,
        sourcePath: `${scopeId}/documents/doc-2/Angebot.pdf`,
        targetPath: path,
      }),
  },
  {
    name: 'put',
    call: (scope) => putStorageObject({ ...scope, body: new Uint8Array(), contentType: 'application/zip' }),
  },
  {
    name: 'delete',
    call: ({ organizationId: scopeId, path }) =>
      deleteStorageObjects({ organizationId: scopeId, paths: [`${scopeId}/documents/doc-2/a.pdf`, path] }),
  },
  {
    name: 'list',
    call: ({ organizationId: scopeId, path }) =>
      listStorageObjectPaths({ organizationId: scopeId, prefix: `${path}/` }),
  },
];

for (const operation of operations) {
  test(`${operation.name} refuses a key of another organization, a malformed key and a non-uuid organization`, async () => {
    await expect(
      operation.call({ organizationId, path: `${otherOrganizationId}/documents/doc-1/Angebot.pdf` }),
    ).rejects.toThrow(refusal);
    await expect(
      operation.call({
        organizationId,
        path: `${organizationId}/../${otherOrganizationId}/doc-1/Angebot.pdf`,
      }),
    ).rejects.toThrow(refusal);
    await expect(operation.call({ organizationId, path: `${organizationId}//Angebot.pdf` })).rejects.toThrow(
      refusal,
    );
    await expect(
      operation.call({ organizationId: 'documents', path: 'documents/doc-1/Angebot.pdf' }),
    ).rejects.toThrow(refusal);
  });
}

test('an empty delete still refuses a non-uuid organization', async () => {
  await expect(deleteStorageObjects({ organizationId: 'documents', paths: [] })).rejects.toThrow(refusal);
});

test('list refuses a prefix that is not an organization folder', async () => {
  for (const prefix of ['', '/', organizationId, `${organizationId}/../`, `${organizationId}//`]) {
    await expect(listStorageObjectPaths({ organizationId, prefix })).rejects.toThrow(refusal);
  }
  await expect(listStorageObjectPaths({ organizationId, prefix: `${otherOrganizationId}/` })).rejects.toThrow(
    refusal,
  );
});

test('discard swallows the refusal of a foreign key without reaching the storage client', async () => {
  await expect(
    discardStorageObjects({ organizationId, paths: [`${otherOrganizationId}/documents/doc-1/Angebot.pdf`] }),
  ).resolves.toBeUndefined();
});
