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
