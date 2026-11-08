import { createHash, timingSafeEqual } from 'node:crypto';

// The shared secrets of the token endpoints: the health token and the cron
// secret of the scheduled storage purge (docs/technical/environments.md#credentials).
// No `server-only` import: the proxy imports the health token through this module.

// A shorter configured value counts as unset, so a placeholder never opens an endpoint.
const MINIMUM_SECRET_LENGTH = 32;

function sha256(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

/** The configured secret, or null when it is unset or too short to count. */
export function configuredSecret(value: string | undefined): string | null {
  const secret = value?.trim() ?? '';
  return secret.length < MINIMUM_SECRET_LENGTH ? null : secret;
}

/**
 * True when the presented value equals the expected one. Both sides are hashed
 * first, so the comparison takes the same time for every presented value,
 * whatever its length.
 */
export function matchesSecret(presented: string, expected: string): boolean {
  return timingSafeEqual(sha256(presented), sha256(expected));
}

/**
 * Whether a request may run a scheduled job: Vercel Cron sends
 * `Authorization: Bearer <CRON_SECRET>`. Without a configured secret no
 * request may, and the caller answers with an error the operator sees.
 */
export function cronRequestAccess(headers: Headers): 'allowed' | 'refused' | 'unconfigured' {
  const secret = configuredSecret(process.env.CRON_SECRET);
  if (!secret) return 'unconfigured';
  return matchesSecret(headers.get('authorization') ?? '', `Bearer ${secret}`) ? 'allowed' : 'refused';
}
