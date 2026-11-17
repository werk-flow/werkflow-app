import 'server-only';

import { createHmac, timingSafeEqual } from 'node:crypto';

// Resend signs each webhook delivery with Svix (werk-flow/werkflow-planning#496):
// `svix-signature` holds one or more `v1,<base64>` entries, each an HMAC-SHA256
// over `<svix-id>.<svix-timestamp>.<raw body>` with the bytes of the
// `whsec_<base64>` secret RESEND_WEBHOOK_SECRET. The check runs on the raw body
// before anything of it is parsed, and refuses a timestamp more than five
// minutes away, so a captured delivery cannot be replayed later.

const SECRET = /^whsec_([A-Za-z0-9+/]{22,}={0,2})$/;
const SVIX_ID = /^[A-Za-z0-9_.:-]{1,128}$/;
const TIMESTAMP = /^\d{1,12}$/;
const SIGNATURE = /^v1,([A-Za-z0-9+/]{43}=)$/;
// Svix's own tolerance.
const TOLERANCE_SECONDS = 5 * 60;
const MINIMUM_KEY_BYTES = 16;

/** The signing key, or null when RESEND_WEBHOOK_SECRET is unset or malformed. */
export function resendWebhookSecret(value: string | undefined = process.env.RESEND_WEBHOOK_SECRET): Buffer | null {
  const encoded = SECRET.exec(value?.trim() ?? '')?.[1];
  if (!encoded) return null;
  const key = Buffer.from(encoded, 'base64');
  return key.length >= MINIMUM_KEY_BYTES ? key : null;
}

/**
 * The delivery's Svix id when its signature over `body` holds and its
 * timestamp lies within the tolerance; null for a missing, forged, stale or
 * malformed signature.
 */
export function verifyResendSignature(
  key: Buffer,
  headers: Headers,
  body: string,
  nowMs: number = Date.now(),
): string | null {
  const id = headers.get('svix-id') ?? '';
  const timestamp = headers.get('svix-timestamp') ?? '';
  if (!SVIX_ID.test(id) || !TIMESTAMP.test(timestamp)) return null;
  if (Math.abs(nowMs / 1000 - Number(timestamp)) > TOLERANCE_SECONDS) return null;

  const expected = createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest();
  const presented = (headers.get('svix-signature') ?? '').split(' ').flatMap((entry) => {
    const encoded = SIGNATURE.exec(entry)?.[1];
    return encoded ? [Buffer.from(encoded, 'base64')] : [];
  });
  // Every entry is compared, so the time taken does not tell which one matched.
  let matched = false;
  for (const signature of presented) {
    if (signature.length === expected.length && timingSafeEqual(signature, expected)) matched = true;
  }
  return matched ? id : null;
}
