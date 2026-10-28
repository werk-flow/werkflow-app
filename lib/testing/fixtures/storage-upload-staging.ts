// Actual storage adapter; only the S3 client's transport is replaced by an
// in-memory bucket, so no request leaves the process. A signed upload URL
// writes a staging key, and finalize registers only the server's copy.
import assert from 'node:assert/strict';
import { spyOn } from 'bun:test';
import {
  CopyObjectCommand,
  DeleteObjectsCommand,
  HeadObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';

process.env.R2_ACCOUNT_ID = 'synthetic-account';
process.env.R2_ACCESS_KEY_ID = 'synthetic-key';
process.env.R2_SECRET_ACCESS_KEY = 'synthetic-secret';
process.env.R2_BUCKET_NAME = 'synthetic-bucket';
process.env.R2_ENDPOINT = 'http://storage.invalid';

const organizationId = '0f0c2e3a-6d4f-4d3a-9e58-2c7b3b7f1a11';
const documentPath = `${organizationId}/92000000-0000-4000-8000-000000000011/aufmass.pdf`;
const stagingPath = `${organizationId}/staging/92000000-0000-4000-8000-000000000011/aufmass.pdf`;

const bucket = new Map<string, { sizeBytes: number; contentType: string }>();
const notFound = () =>
  new S3ServiceException({ name: 'NoSuchKey', $fault: 'client', $metadata: { httpStatusCode: 404 } });
spyOn(S3Client.prototype, 'send').mockImplementation(async (command: unknown) => {
  if (command instanceof CopyObjectCommand) {
    const source = bucket.get(String(command.input.CopySource).replace('synthetic-bucket/', ''));
    if (!source) throw notFound();
    bucket.set(String(command.input.Key), { ...source });
    return {};
  }
  if (command instanceof DeleteObjectsCommand) {
    for (const object of command.input.Delete?.Objects ?? []) bucket.delete(String(object.Key));
    return {};
  }
  if (command instanceof HeadObjectCommand) {
    const object = bucket.get(String(command.input.Key));
    if (!object) throw notFound();
    return { ContentLength: object.sizeBytes, ContentType: object.contentType };
  }
  throw new Error('a command outside this fixture reached the storage client');
});

const { createSignedUploadUrl, promoteUploadedObject } = await import('@/lib/storage/r2');

// The signed PUT names the staging key, never the key a document row references.
const uploadUrl = new URL(
  await createSignedUploadUrl({ organizationId, path: documentPath, contentType: 'application/pdf' }),
);
assert.equal(uploadUrl.pathname, `/synthetic-bucket/${stagingPath}`);

// Finalize copies the staged bytes to the document key and removes the staging object.
bucket.set(stagingPath, { sizeBytes: 1024, contentType: 'application/pdf' });
assert.deepEqual(await promoteUploadedObject({ organizationId, path: documentPath }), {
  exists: true,
  sizeBytes: 1024,
  contentType: 'application/pdf',
});
assert.deepEqual([...bucket.keys()], [documentPath]);

// A later PUT through the same URL writes only the staging key; the registered copy keeps its bytes.
bucket.set(stagingPath, { sizeBytes: 999_999_999, contentType: 'application/pdf' });
assert.deepEqual(bucket.get(documentPath), { sizeBytes: 1024, contentType: 'application/pdf' });

// Without a staged upload there is nothing to promote.
bucket.clear();
assert.deepEqual(await promoteUploadedObject({ organizationId, path: documentPath }), {
  exists: false,
  sizeBytes: null,
  contentType: null,
});
assert.equal(bucket.size, 0);
