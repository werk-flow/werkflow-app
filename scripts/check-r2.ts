// Connectivity check for the configured Cloudflare R2 bucket.
// Run with: bun scripts/check-r2.ts
//
// Verifies which endpoint (EU jurisdiction vs default) serves the configured
// bucket, and that the credentials can write, read, and delete an object.

import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

const accountId = process.env.R2_ACCOUNT_ID;
const accessKeyId = process.env.R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
const bucketName = process.env.R2_BUCKET_NAME;

if (!accountId || !accessKeyId || !secretAccessKey || !bucketName) {
  console.error('Missing R2 env vars. Need R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME.');
  process.exit(1);
}

function buildClient(jurisdiction: string | null): S3Client {
  const segment = jurisdiction ? `${jurisdiction}.` : '';
  return new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.${segment}r2.cloudflarestorage.com`,
    forcePathStyle: true,
    credentials: { accessKeyId: accessKeyId!, secretAccessKey: secretAccessKey! },
  });
}

async function tryEndpoint(label: string, jurisdiction: string | null): Promise<boolean> {
  const client = buildClient(jurisdiction);
  try {
    await client.send(new ListObjectsV2Command({ Bucket: bucketName, MaxKeys: 1 }));
    console.log(`[ok] ${label} endpoint: bucket "${bucketName}" reachable and listable.`);
    return true;
  } catch (error) {
    const name = (error as { name?: string }).name ?? 'UnknownError';
    console.log(`[--] ${label} endpoint: not usable (${name}).`);
    return false;
  }
}

async function roundTrip(jurisdiction: string | null): Promise<void> {
  const client = buildClient(jurisdiction);
  const key = `__connectivity-check/${Date.now()}.txt`;
  const payload = 'werkflow r2 connectivity check';

  await client.send(
    new PutObjectCommand({ Bucket: bucketName, Key: key, Body: payload, ContentType: 'text/plain' })
  );

  try {
    const result = await client.send(new GetObjectCommand({ Bucket: bucketName, Key: key }));
    const body = await result.Body?.transformToString();
    if (body !== payload) {
      throw new Error('Read-back mismatch during connectivity round trip.');
    }
  } finally {
    // Always remove the probe object, even when the read-back fails.
    await client.send(new DeleteObjectCommand({ Bucket: bucketName, Key: key }));
  }

  console.log('[ok] Write, read, and delete round trip succeeded.');
}

const euWorks = await tryEndpoint('EU jurisdiction', 'eu');
const defaultWorks = await tryEndpoint('Default', null);

if (euWorks) {
  await roundTrip('eu');
  console.log('Result: use the EU endpoint (R2_JURISDICTION=eu, the app default). Bucket is EU-jurisdiction as intended.');
} else if (defaultWorks) {
  await roundTrip(null);
  console.warn(
    'Result: bucket is only reachable on the DEFAULT endpoint — it was probably created without the EU jurisdiction. ' +
      'Recreate the bucket with jurisdiction "European Union" (jurisdiction cannot be changed later), or set R2_JURISDICTION="" consciously.'
  );
  process.exit(2);
} else {
  console.error('Result: bucket unreachable on both endpoints. Check account ID, bucket name, and token permissions.');
  process.exit(1);
}
