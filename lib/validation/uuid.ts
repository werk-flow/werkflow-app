import { z } from 'zod';

// The one uuid validator for the app. Postgres accepts any 128-bit value as a
// uuid, and production carries hand-made organization ids such as
// `b2000001-0000-0000-0000-000000000001` whose version and variant nibbles are
// zero. zod 4's strict RFC 4122 uuid check rejected those tenants everywhere a
// Wave 1/2 validator checked an organization id (incident 2026-09-03: the
// clock and every P1-21+ flow returned `invalid_input` for them without
// logging). ESLint bans the strict zod uuid check outside this file; use
// `uuidSchema` or `isUuid`.
export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const uuidSchema = z.guid();

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}
