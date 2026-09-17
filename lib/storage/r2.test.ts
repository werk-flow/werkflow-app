import { expect, test } from 'bun:test';
import { assertOrganizationStorageKey, createSignedDownloadUrl, createSignedUploadUrl } from './r2';

const organizationId = '0f0c2e3a-6d4f-4d3a-9e58-2c7b3b7f1a11';
const otherOrganizationId = '9b1d0f7e-2a6c-4c1f-8f3e-0d5a6e7c8b22';

test('accepts a document, a version and a payroll-export key of the organization', () => {
  expect(() => assertOrganizationStorageKey(organizationId, `${organizationId}/documents/doc-1/Angebot.pdf`)).not.toThrow();
  expect(() => assertOrganizationStorageKey(organizationId, `${organizationId}/documents/doc-1/versions/2/Angebot.pdf`)).not.toThrow();
  expect(() => assertOrganizationStorageKey(organizationId, `${organizationId}/lohnexporte/2026-08-01/export-1.zip`)).not.toThrow();
});

test('refuses a key under another organization, a traversal segment and an empty organization id', () => {
  expect(() => assertOrganizationStorageKey(organizationId, `${otherOrganizationId}/documents/doc-1/Angebot.pdf`)).toThrow('storage_key_outside_organization');
  expect(() => assertOrganizationStorageKey(organizationId, `${organizationId}/../${otherOrganizationId}/documents/doc-1/Angebot.pdf`)).toThrow('storage_key_outside_organization');
  expect(() => assertOrganizationStorageKey(organizationId, `${organizationId}//documents/doc-1/Angebot.pdf`)).toThrow('storage_key_outside_organization');
  expect(() => assertOrganizationStorageKey('', '/documents/doc-1/Angebot.pdf')).toThrow('storage_key_outside_organization');
  expect(() => assertOrganizationStorageKey(organizationId, organizationId)).toThrow('storage_key_outside_organization');
});

test('the signers refuse before they touch the storage client', async () => {
  const foreign = `${otherOrganizationId}/documents/doc-1/Angebot.pdf`;
  await expect(createSignedDownloadUrl({ organizationId, path: foreign })).rejects.toThrow('storage_key_outside_organization');
  await expect(createSignedUploadUrl({ organizationId, path: foreign, contentType: 'application/pdf' })).rejects.toThrow(
    'storage_key_outside_organization'
  );
});
