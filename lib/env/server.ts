import 'server-only';
import { readRequiredEnv } from '@/lib/env/required';

function readOptionalEnv(keys: string[]): string | undefined {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) {
      return value;
    }
  }

  return undefined;
}

export function getSupabaseSecretKey(): string {
  return readRequiredEnv(
    readOptionalEnv(['SUPABASE_SECRET_KEY']),
    'Missing SUPABASE_SECRET_KEY environment variable.',
  );
}

export function getSiteUrl(): string | undefined {
  return readOptionalEnv(['NEXT_PUBLIC_SITE_URL']);
}

/**
 * Server secret behind the email-change OTP hashes: one value per backend,
 * generated once (32 random bytes, hex) and set in the environment. Without it
 * the email-change actions refuse to run rather than fall back to a plain hash.
 */
export function getEmailOtpHashSecret(): string {
  return readRequiredEnv(
    readOptionalEnv(['EMAIL_OTP_HASH_SECRET']),
    'Missing EMAIL_OTP_HASH_SECRET environment variable.',
  );
}
