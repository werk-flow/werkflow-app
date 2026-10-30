import 'server-only';

import { createHmac, timingSafeEqual } from 'node:crypto';
import { getSupabaseSecretKey } from '@/lib/env/server';
import { z } from '@/lib/zod';
import { personnelDocumentUploadInputSchema } from './lifecycle';

// The signed token that binds a personnel document upload to its caller, so
// only that caller can finalize or clean it up.

// Covers the 25-minute browser upload timeout plus finalize and cleanup retries.
const UPLOAD_CLEANUP_TOKEN_TTL_MS = 45 * 60 * 1000;

const uploadCleanupTokenPayloadSchema = z.object({
  actorId: z.string(),
  organizationId: z.string(),
  employeeRecordId: z.string(),
  documentId: z.string(),
  fileName: z.string(),
  accessClass: personnelDocumentUploadInputSchema.shape.accessClass,
  operationId: z.string(),
  expiresAt: z.number(),
});
type UploadCleanupTokenPayload = z.infer<typeof uploadCleanupTokenPayloadSchema>;

function uploadCleanupTokenSecret(): Buffer {
  const secret = getSupabaseSecretKey();
  return createHmac('sha256', secret).update('werkflow:p1-24-upload-cleanup:v1').digest();
}

export function createUploadCleanupToken(payload: Omit<UploadCleanupTokenPayload, 'expiresAt'>): string {
  const encoded = Buffer.from(
    JSON.stringify({
      ...payload,
      expiresAt: Date.now() + UPLOAD_CLEANUP_TOKEN_TTL_MS,
    }),
  ).toString('base64url');
  const signature = createHmac('sha256', uploadCleanupTokenSecret()).update(encoded).digest('base64url');
  return `${encoded}.${signature}`;
}

export function isValidUploadCleanupToken(
  token: string,
  expected: Omit<UploadCleanupTokenPayload, 'expiresAt'>,
): boolean {
  const [encoded, signature, extra] = token.split('.');
  if (!encoded || !signature || extra) return false;
  const actualSignature = createHmac('sha256', uploadCleanupTokenSecret()).update(encoded).digest();
  const suppliedSignature = Buffer.from(signature, 'base64url');
  if (
    suppliedSignature.length !== actualSignature.length ||
    !timingSafeEqual(suppliedSignature, actualSignature)
  )
    return false;
  try {
    const parsedPayload = uploadCleanupTokenPayloadSchema.safeParse(
      JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')),
    );
    if (!parsedPayload.success) return false;
    const payload = parsedPayload.data;
    return (
      payload.expiresAt >= Date.now() &&
      payload.actorId === expected.actorId &&
      payload.organizationId === expected.organizationId &&
      payload.employeeRecordId === expected.employeeRecordId &&
      payload.documentId === expected.documentId &&
      payload.fileName === expected.fileName &&
      payload.accessClass === expected.accessClass &&
      payload.operationId === expected.operationId
    );
  } catch {
    return false;
  }
}
