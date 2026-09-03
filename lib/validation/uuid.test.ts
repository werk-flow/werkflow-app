import { describe, expect, test } from 'bun:test';

import { isUuid, uuidSchema } from './uuid';

// Regression guard for the 2026-09-03 incident: production organizations with
// hand-made ids must pass the app-wide uuid validator.
const HAND_MADE_PRODUCTION_ORGANIZATION_ID = 'b2000001-0000-0000-0000-000000000001';
const RANDOM_V4 = '351e9e05-b8c6-4d5c-b29f-b33b2f1f04de';

describe('uuidSchema', () => {
  test('accepts RFC 4122 v4 ids', () => {
    expect(uuidSchema.safeParse(RANDOM_V4).success).toBe(true);
  });

  test('accepts hand-made ids with zero version and variant nibbles', () => {
    expect(uuidSchema.safeParse(HAND_MADE_PRODUCTION_ORGANIZATION_ID).success).toBe(true);
    expect(isUuid(HAND_MADE_PRODUCTION_ORGANIZATION_ID)).toBe(true);
  });

  test('accepts uppercase hex', () => {
    expect(uuidSchema.safeParse(RANDOM_V4.toUpperCase()).success).toBe(true);
  });

  test('rejects malformed values', () => {
    for (const value of ['', 'not-a-uuid', '351e9e05b8c64d5cb29fb33b2f1f04de', `${RANDOM_V4}x`, `${RANDOM_V4}; drop table`]) {
      expect(uuidSchema.safeParse(value).success).toBe(false);
      expect(isUuid(value)).toBe(false);
    }
  });
});
