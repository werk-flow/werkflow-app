import { createHash, timingSafeEqual } from 'node:crypto';

// The shared secret of the health endpoint (docs/technical/environments.md#credentials).
// The proxy and the route handler both ask it, so a request
// without the token never reaches a dependency. No `server-only` import: the
// proxy imports this module too.

export const HEALTH_PATH = '/api/health';
const HEALTH_CHECK_TOKEN_HEADER = 'x-health-check-token';
// A shorter configured value counts as unset, so a placeholder never opens the endpoint.
const MINIMUM_TOKEN_LENGTH = 32;

function sha256(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

/**
 * True only when `HEALTH_CHECK_TOKEN` is configured and the request carries it.
 * Both sides are hashed first, so the comparison takes the same time for every
 * presented value, whatever its length.
 */
export function hasHealthCheckToken(headers: Headers): boolean {
  const expected = process.env.HEALTH_CHECK_TOKEN?.trim() ?? '';
  if (expected.length < MINIMUM_TOKEN_LENGTH) return false;
  const presented = headers.get(HEALTH_CHECK_TOKEN_HEADER) ?? '';
  return timingSafeEqual(sha256(presented), sha256(expected));
}
