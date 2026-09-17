import 'server-only';

function readOptionalEnv(keys: string[]): string | undefined {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) {
      return value;
    }
  }

  return undefined;
}

function readRequiredEnv(keys: string[], message: string): string {
  const value = readOptionalEnv(keys);
  if (!value) {
    throw new Error(message);
  }

  return value;
}

export function getSupabaseSecretKey(): string {
  return readRequiredEnv(
    ['SUPABASE_SECRET_KEY'],
    'Missing SUPABASE_SECRET_KEY environment variable.'
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
    ['EMAIL_OTP_HASH_SECRET'],
    'Missing EMAIL_OTP_HASH_SECRET environment variable.'
  );
}
