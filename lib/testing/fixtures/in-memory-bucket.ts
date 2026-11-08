// An in-memory bucket behind the actual storage adapter: only the S3 client's
// transport is replaced, so no request leaves the process. Install it before
// the first import of `@/lib/storage/r2`, in a fixture that runs in its own
// process, because it sets the storage configuration and replaces the transport.
import { spyOn } from 'bun:test';
import {
  CopyObjectCommand,
  DeleteObjectsCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';

type StoredObject = { body: string; contentType: string };

const BUCKET_NAME = 'synthetic-bucket';

function notFound(): S3ServiceException {
  return new S3ServiceException({ name: 'NoSuchKey', $fault: 'client', $metadata: { httpStatusCode: 404 } });
}

function bodyText(body: unknown): string {
  return body instanceof Uint8Array ? Buffer.from(body).toString('utf8') : String(body);
}

/** The bucket's objects by key: a test writes an upload into it and reads what the adapter left. */
export function installInMemoryBucket(): Map<string, StoredObject> {
  process.env.R2_ACCOUNT_ID = 'synthetic-account';
  process.env.R2_ACCESS_KEY_ID = 'synthetic-key';
  process.env.R2_SECRET_ACCESS_KEY = 'synthetic-secret';
  process.env.R2_BUCKET_NAME = BUCKET_NAME;
  process.env.R2_ENDPOINT = 'http://storage.invalid';

  const bucket = new Map<string, StoredObject>();
  spyOn(S3Client.prototype, 'send').mockImplementation(async (command: unknown) => {
    if (command instanceof CopyObjectCommand) {
      const source = bucket.get(String(command.input.CopySource).replace(`${BUCKET_NAME}/`, ''));
      if (!source) throw notFound();
      bucket.set(String(command.input.Key), { ...source });
      return {};
    }
    if (command instanceof PutObjectCommand) {
      bucket.set(String(command.input.Key), {
        body: bodyText(command.input.Body),
        contentType: String(command.input.ContentType),
      });
      return {};
    }
    if (command instanceof DeleteObjectsCommand) {
      for (const object of command.input.Delete?.Objects ?? []) bucket.delete(String(object.Key));
      return {};
    }
    if (command instanceof HeadObjectCommand) {
      const object = bucket.get(String(command.input.Key));
      if (!object) throw notFound();
      return { ContentLength: Buffer.byteLength(object.body), ContentType: object.contentType };
    }
    throw new Error('a command outside this fixture reached the storage client');
  });
  return bucket;
}
