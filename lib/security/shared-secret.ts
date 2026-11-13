import { createHash, timingSafeEqual } from 'node:crypto';

// The shared secrets of the token endpoints: the health token, the cron
// secret of the scheduled runs and the hand-out secret of the report threads
// (docs/technical/environments.md#credentials).
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
export function cronRequestAccess(headers: Headers): BearerAccess {
  return bearerAccess(headers, process.env.CRON_SECRET);
}

/**
 * Whether a report thread may reach the problem-report hand-out: it sends
 * `Authorization: Bearer <PROBLEM_REPORT_HANDOUT_SECRET>`. Without a
 * configured secret the hand-out is off for everyone.
 */
export function problemReportHandoutAccess(headers: Headers): BearerAccess {
  return bearerAccess(headers, process.env.PROBLEM_REPORT_HANDOUT_SECRET);
}

type BearerAccess = 'allowed' | 'refused' | 'unconfigured';

function bearerAccess(headers: Headers, value: string | undefined): BearerAccess {
  const secret = configuredSecret(value);
  if (!secret) return 'unconfigured';
  return matchesSecret(headers.get('authorization') ?? '', `Bearer ${secret}`) ? 'allowed' : 'refused';
}
