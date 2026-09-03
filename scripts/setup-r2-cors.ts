// Applies the CORS configuration required for direct browser uploads/downloads
// to the configured R2 bucket. Run with: bun scripts/setup-r2-cors.ts
//
// Origins: localhost dev servers plus NEXT_PUBLIC_SITE_URL when set.
// Re-run against the production bucket (R2_BUCKET_NAME=werkflow-documents-prod)
// with the production NEXT_PUBLIC_SITE_URL before go-live.
//
// Token scope: since 2026-08-19 the R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY in
// the env files are bucket-scoped and object-only, and PutBucketCors is
// rejected with them. Supply an account-level R2 token for the run by
// overriding the two variables in the shell. This script is not part of
// routine operation; CORS is normally managed in the Cloudflare dashboard.
// See docs/technical/environments.md.

import {
  GetBucketCorsCommand,
  PutBucketCorsCommand,
  S3Client,
} from '@aws-sdk/client-s3';

const accountId = process.env.R2_ACCOUNT_ID;
const accessKeyId = process.env.R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
const bucketName = process.env.R2_BUCKET_NAME;
const jurisdiction = process.env.R2_JURISDICTION ?? 'eu';

if (!accountId || !accessKeyId || !secretAccessKey || !bucketName) {
  console.error('Missing R2 env vars. Need R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME.');
  process.exit(1);
}

const origins = new Set<string>(['http://localhost:3000', 'http://127.0.0.1:3000']);

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
const localOnly = process.env.R2_CORS_LOCAL_ONLY === '1';

if (siteUrl) {
  try {
    origins.add(new URL(siteUrl).origin);
  } catch {
    console.error(`Invalid NEXT_PUBLIC_SITE_URL: ${siteUrl}. Fix it or set R2_CORS_LOCAL_ONLY=1 for a deliberate localhost-only policy.`);
    process.exit(1);
  }
} else if (!localOnly) {
  console.error(
    'NEXT_PUBLIC_SITE_URL is not set. A localhost-only CORS policy would break the deployed app. ' +
      'Set NEXT_PUBLIC_SITE_URL, or set R2_CORS_LOCAL_ONLY=1 to apply a localhost-only policy deliberately (dev bucket).'
  );
  process.exit(1);
}

const segment = jurisdiction ? `${jurisdiction}.` : '';
const client = new S3Client({
  region: 'auto',
  endpoint: `https://${accountId}.${segment}r2.cloudflarestorage.com`,
  forcePathStyle: true,
  credentials: { accessKeyId, secretAccessKey },
});

await client.send(
  new PutBucketCorsCommand({
    Bucket: bucketName,
    CORSConfiguration: {
      CORSRules: [
        {
          AllowedOrigins: Array.from(origins),
          AllowedMethods: ['GET', 'PUT', 'HEAD'],
          AllowedHeaders: ['content-type'],
          MaxAgeSeconds: 3600,
        },
      ],
    },
  })
);

const current = await client.send(new GetBucketCorsCommand({ Bucket: bucketName }));
console.log(`CORS configuration applied to bucket "${bucketName}":`);
console.log(JSON.stringify(current.CORSRules, null, 2));
