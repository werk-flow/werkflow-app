// Actual storage adapter over an in-memory bucket. A signed upload URL writes
// a staging key, and finalize registers only the server's copy, which each
// promotion writes to a key of its own.
import assert from 'node:assert/strict';
import { installInMemoryBucket } from './in-memory-bucket';

const bucket = installInMemoryBucket();
const organizationId = '0f0c2e3a-6d4f-4d3a-9e58-2c7b3b7f1a11';
const documentFolder = `${organizationId}/92000000-0000-4000-8000-000000000011/`;
const documentPath = `${documentFolder}aufmass.pdf`;
const stagingPath = `${organizationId}/staging/92000000-0000-4000-8000-000000000011/aufmass.pdf`;
const upload = (body: string) => ({ body, contentType: 'application/pdf' });

const { createSignedUploadUrl, promoteUploadedObject } = await import('@/lib/storage/r2');

// The signed PUT names the staging key, never the key a document row references.
const uploadUrl = new URL(
  await createSignedUploadUrl({ organizationId, path: documentPath, contentType: 'application/pdf' }),
);
assert.equal(uploadUrl.pathname, `/synthetic-bucket/${stagingPath}`);

// Finalize copies the staged bytes to a key of its own in the document's folder and removes the staging object.
bucket.set(stagingPath, upload('original'));
const { path: firstPath, ...firstHead } = await promoteUploadedObject({ organizationId, path: documentPath });
assert.deepEqual(firstHead, { exists: true, sizeBytes: 8, contentType: 'application/pdf' });
assert.ok(firstPath.startsWith(documentFolder) && firstPath.endsWith('-aufmass.pdf'), firstPath);
assert.deepEqual([...bucket.keys()], [firstPath]);

// A later PUT through the same URL writes only the staging key, and a second
// promotion of it copies to another key: the first copy keeps its bytes.
bucket.set(stagingPath, upload('replaced'));
const second = await promoteUploadedObject({ organizationId, path: documentPath });
assert.notEqual(second.path, firstPath);
assert.deepEqual(bucket.get(firstPath), upload('original'));
assert.deepEqual(bucket.get(second.path), upload('replaced'));

// Without a staged upload there is nothing to promote.
bucket.clear();
const missing = await promoteUploadedObject({ organizationId, path: documentPath });
assert.equal(missing.exists, false);
assert.equal(bucket.size, 0);
