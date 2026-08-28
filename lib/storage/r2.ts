// Server-only Cloudflare R2 object storage client (S3-compatible API).
//
// This module is the provider-neutral seam decided in
// docs/decisions/0001-infrastructure-stack.md: all file bytes live in object
// storage and are transferred directly between the browser and the bucket via
// short-lived signed URLs. Server code authorizes and signs; it must never
// stream file bytes itself (Vercel Functions cap request bodies at ~4.5 MB).

import {
  CopyObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const SIGNED_UPLOAD_URL_EXPIRES_SECONDS = 60 * 30;
const SIGNED_DOWNLOAD_URL_EXPIRES_SECONDS = 60 * 10;
// Signed URLs must stay short-lived; nothing in the app needs more than an hour.
const SIGNED_URL_MAX_EXPIRES_SECONDS = 60 * 60;
const SIGNED_URL_MIN_EXPIRES_SECONDS = 60;
const DELETE_BATCH_SIZE = 1000;

function clampExpiry(expiresInSeconds: number): number {
  if (!Number.isFinite(expiresInSeconds) || expiresInSeconds <= 0) {
    return SIGNED_URL_MIN_EXPIRES_SECONDS;
  }
  return Math.min(
    Math.max(Math.floor(expiresInSeconds), SIGNED_URL_MIN_EXPIRES_SECONDS),
    SIGNED_URL_MAX_EXPIRES_SECONDS
  );
}

type R2Config = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
  jurisdiction: string;
  // Optional full endpoint override (decision D9, docs/plans/platform-hardening.md):
  // the local test stack serves an S3-compatible endpoint on localhost that the
  // account/jurisdiction URL scheme cannot express. Cloud environments leave it
  // unset; the test preflight rejects it outside the local target.
  endpointOverride: string | null;
};

export type StorageObjectHead = {
  exists: boolean;
  sizeBytes: number | null;
  contentType: string | null;
};

let cachedClient: S3Client | null = null;
let cachedConfig: R2Config | null = null;

function getR2Config(): R2Config {
  if (cachedConfig) return cachedConfig;

  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucketName = process.env.R2_BUCKET_NAME;
  // EU-jurisdiction buckets are only reachable through the `eu.` endpoint.
  const jurisdiction = process.env.R2_JURISDICTION ?? 'eu';

  if (!accountId || !accessKeyId || !secretAccessKey || !bucketName) {
    throw new Error(
      'Missing R2 configuration. Expected R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_BUCKET_NAME environment variables.'
    );
  }

  cachedConfig = {
    accountId,
    accessKeyId,
    secretAccessKey,
    bucketName,
    jurisdiction,
    endpointOverride: process.env.R2_ENDPOINT?.trim() || null,
  };
  return cachedConfig;
}

export function getR2Endpoint(): string {
  const config = getR2Config();
  if (config.endpointOverride) return config.endpointOverride;
  const jurisdictionSegment = config.jurisdiction ? `${config.jurisdiction}.` : '';
  return `https://${config.accountId}.${jurisdictionSegment}r2.cloudflarestorage.com`;
}

export function getR2BucketName(): string {
  return getR2Config().bucketName;
}

function getR2Client(): S3Client {
  if (cachedClient) return cachedClient;

  const config = getR2Config();
  cachedClient = new S3Client({
    region: 'auto',
    endpoint: getR2Endpoint(),
    forcePathStyle: true,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });

  return cachedClient;
}

// RFC 6266 / RFC 5987 encoding so umlauts and other non-ASCII file names
// survive the Content-Disposition header.
function buildContentDisposition(type: 'inline' | 'attachment', fileName?: string): string {
  if (!fileName) return type;

  const fallback = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  const encoded = encodeURIComponent(fileName).replace(/['()*]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`
  );

  return `${type}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

export async function createSignedUploadUrl({
  path,
  contentType,
  expiresInSeconds = SIGNED_UPLOAD_URL_EXPIRES_SECONDS,
}: {
  path: string;
  contentType: string;
  expiresInSeconds?: number;
}): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: getR2BucketName(),
    Key: path,
    ContentType: contentType,
  });

  // Pin the content type into the signature so the uploading client must send
  // exactly the declared type; otherwise the presigned PUT leaves it unsigned.
  return getSignedUrl(getR2Client(), command, {
    expiresIn: clampExpiry(expiresInSeconds),
    signableHeaders: new Set(['content-type']),
  });
}

export async function createSignedDownloadUrl({
  path,
  disposition = 'inline',
  downloadFileName,
  expiresInSeconds = SIGNED_DOWNLOAD_URL_EXPIRES_SECONDS,
}: {
  path: string;
  disposition?: 'inline' | 'attachment';
  downloadFileName?: string;
  expiresInSeconds?: number;
}): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: getR2BucketName(),
    Key: path,
    ResponseContentDisposition: buildContentDisposition(disposition, downloadFileName),
  });

  return getSignedUrl(getR2Client(), command, { expiresIn: clampExpiry(expiresInSeconds) });
}

export async function headStorageObject(path: string): Promise<StorageObjectHead> {
  try {
    const result = await getR2Client().send(
      new HeadObjectCommand({ Bucket: getR2BucketName(), Key: path })
    );

    return {
      exists: true,
      sizeBytes: typeof result.ContentLength === 'number' ? result.ContentLength : null,
      contentType: result.ContentType ?? null,
    };
  } catch (error) {
    if (isNotFoundError(error)) {
      return { exists: false, sizeBytes: null, contentType: null };
    }
    throw error;
  }
}

function isNotFoundError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return candidate.name === 'NotFound' || candidate.$metadata?.httpStatusCode === 404;
}

export async function copyStorageObject({
  sourcePath,
  targetPath,
  contentType,
}: {
  sourcePath: string;
  targetPath: string;
  contentType?: string | null;
}): Promise<void> {
  const bucket = getR2BucketName();

  await getR2Client().send(
    new CopyObjectCommand({
      Bucket: bucket,
      Key: targetPath,
      CopySource: `${bucket}/${encodeURIComponent(sourcePath).replace(/%2F/g, '/')}`,
      // Preserve or override metadata explicitly; REPLACE keeps behavior
      // deterministic when a content type is provided.
      ...(contentType
        ? { MetadataDirective: 'REPLACE' as const, ContentType: contentType }
        : {}),
    })
  );
}

export async function putStorageObject({
  path,
  body,
  contentType,
}: {
  path: string;
  body: Uint8Array | Buffer;
  contentType: string;
}): Promise<void> {
  await getR2Client().send(
    new PutObjectCommand({
      Bucket: getR2BucketName(),
      Key: path,
      Body: body,
      ContentType: contentType,
    })
  );
}

export async function deleteStorageObjects(paths: string[]): Promise<void> {
  if (paths.length === 0) return;

  const client = getR2Client();
  const bucket = getR2BucketName();

  const failedKeys: string[] = [];

  for (let index = 0; index < paths.length; index += DELETE_BATCH_SIZE) {
    const batch = paths.slice(index, index + DELETE_BATCH_SIZE);
    const result = await client.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: batch.map((path) => ({ Key: path })), Quiet: true },
      })
    );

    for (const deleteError of result.Errors ?? []) {
      if (deleteError.Key) failedKeys.push(deleteError.Key);
    }
  }

  if (failedKeys.length > 0) {
    throw new Error(`Failed to delete ${failedKeys.length} object(s): ${failedKeys.join(', ')}`);
  }
}

export async function listStorageObjectPaths(prefix: string): Promise<string[]> {
  const client = getR2Client();
  const bucket = getR2BucketName();
  const paths: string[] = [];
  let continuationToken: string | undefined;

  do {
    const result = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      })
    );

    for (const object of result.Contents ?? []) {
      if (object.Key) paths.push(object.Key);
    }

    continuationToken = result.IsTruncated ? result.NextContinuationToken : undefined;
  } while (continuationToken);

  return paths;
}
