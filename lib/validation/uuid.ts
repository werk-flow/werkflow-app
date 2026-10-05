import { z } from '@/lib/zod';

// The one uuid validator for the app. Postgres accepts any 128-bit value as a
// uuid, and production carries hand-made organization ids such as
// `b2000001-0000-0000-0000-000000000001` whose version and variant nibbles are
// zero. zod 4's strict RFC 4122 uuid check rejects those tenants with
// `invalid_input` and no log. ESLint bans the strict zod uuid check outside
// this file; use `uuidSchema` or `isUuid`.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const uuidSchema = z.guid();

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}
