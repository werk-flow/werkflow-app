import { configuredSecret, matchesSecret } from './shared-secret';

// The shared secret of the health endpoint (docs/technical/environments.md#credentials).
// The proxy and the route handler both ask it, so a request
// without the token never reaches a dependency. No `server-only` import: the
// proxy imports this module too.

export const HEALTH_PATH = '/api/health';
const HEALTH_CHECK_TOKEN_HEADER = 'x-health-check-token';

/** True only when `HEALTH_CHECK_TOKEN` is configured and the request carries it. */
export function hasHealthCheckToken(headers: Headers): boolean {
  const expected = configuredSecret(process.env.HEALTH_CHECK_TOKEN);
  if (!expected) return false;
  return matchesSecret(headers.get(HEALTH_CHECK_TOKEN_HEADER) ?? '', expected);
}
