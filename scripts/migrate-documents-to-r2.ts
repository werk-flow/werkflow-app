// One-time migration of document file bytes from Supabase Storage to R2.
// Run with: bun scripts/migrate-documents-to-r2.ts
//
// - Copies every object in the Supabase "organization-documents" bucket to the
//   configured R2 bucket under the same key, preserving content types.
// - Idempotent: objects that already exist on R2 with the same size are skipped.
// - Never deletes anything on the Supabase side; the old bucket stays as a
//   fallback until the R2 path has been verified in production.

import { createClient } from '@supabase/supabase-js';

import {
  headStorageObject,
  putStorageObject,
} from '../lib/storage/r2';

const SUPABASE_BUCKET = 'organization-documents';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;

if (!supabaseUrl || !supabaseSecretKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseSecretKey, {
  auth: { persistSession: false },
});

type StorageEntry = { name: string; id: string | null; metadata: { mimetype?: string; size?: number } | null };

async function listAllObjects(prefix: string): Promise<{ path: string; contentType: string; size: number | null }[]> {
  const results: { path: string; contentType: string; size: number | null }[] = [];

  async function walk(path: string): Promise<void> {
    let offset = 0;
    const limit = 100;

    while (true) {
      const { data, error } = await supabase.storage
        .from(SUPABASE_BUCKET)
        .list(path, { limit, offset, sortBy: { column: 'name', order: 'asc' } });

      if (error) throw error;

      const entries = (data ?? []) as StorageEntry[];
      for (const entry of entries) {
        const objectPath = path ? `${path}/${entry.name}` : entry.name;
        if (entry.id || entry.metadata) {
          results.push({
            path: objectPath,
            contentType: entry.metadata?.mimetype ?? 'application/octet-stream',
            size: entry.metadata?.size ?? null,
          });
        } else {
          await walk(objectPath);
        }
      }

      if (entries.length < limit) break;
      offset += limit;
    }
  }

  await walk(prefix);
  return results;
}

const objects = await listAllObjects('');
console.log(`Found ${objects.length} objects in Supabase bucket "${SUPABASE_BUCKET}".`);

let copied = 0;
let skipped = 0;
let failed = 0;

for (const object of objects) {
  try {
    const existing = await headStorageObject(object.path);
    // Skip only when the source size is known and matches; an unknown source
    // size must not silently pass as "already migrated".
    if (existing.exists && object.size !== null && existing.sizeBytes === object.size) {
      skipped++;
      continue;
    }

    const { data: blob, error: downloadError } = await supabase.storage
      .from(SUPABASE_BUCKET)
      .download(object.path);

    if (downloadError || !blob) {
      throw downloadError ?? new Error('download returned no data');
    }

    const body = new Uint8Array(await blob.arrayBuffer());
    if (object.size !== null && body.byteLength !== object.size) {
      throw new Error(`size mismatch after download: expected ${object.size}, got ${body.byteLength}`);
    }

    await putStorageObject({
      path: object.path,
      body,
      contentType: object.contentType,
    });

    const verify = await headStorageObject(object.path);
    if (!verify.exists || verify.sizeBytes !== body.byteLength) {
      throw new Error('verification after upload failed');
    }

    copied++;
    console.log(`[copied] ${object.path} (${body.byteLength} bytes)`);
  } catch (error) {
    failed++;
    const message = error instanceof Error ? `${error.name}: ${error.message}` : 'unknown error';
    console.error(`[failed] ${object.path} (${message})`);
  }
}

console.log(`Done. Copied ${copied}, skipped ${skipped} (already present), failed ${failed}.`);
if (failed > 0) process.exit(1);
