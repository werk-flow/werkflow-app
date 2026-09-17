import { createHmac } from 'node:crypto';

/**
 * The stored form of a six-digit email-change code: HMAC-SHA256 with a server
 * secret over `${userId}:${code}`. A leaked challenge table is useless without
 * the secret, and a hash for one user cannot verify another user's code
 * (pre-Wave-3 step 5, CodeRabbit finding of 2026-09-17; Tier 1). The digest
 * stays 64 hex characters, which the `transition_email_change` RPC checks.
 */
export function hashEmailChangeOtp(input: { secret: string; userId: string; code: string }): string {
  if (!input.secret) throw new Error('email_otp_hash_secret_missing');
  if (!input.userId) throw new Error('email_otp_hash_user_missing');
  return createHmac('sha256', input.secret).update(`${input.userId}:${input.code}`).digest('hex');
}
