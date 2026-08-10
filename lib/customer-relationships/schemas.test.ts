import { describe, expect, test } from 'bun:test';

import {
  communicationExceptionInputSchema,
  followUpInputSchema,
  followUpTransitionSchema,
} from './schemas';

const VALID_FOLLOW_UP = {
  title: 'Wartung abstimmen',
  ownerUserId: '00000000-0000-4000-8000-000000000001',
  dueAt: '2026-08-11T09:00:00.000Z',
};

describe('customer relationship action schemas', () => {
  test('rejects malformed follow-up payloads without reading unsafe fields', () => {
    expect(followUpInputSchema.safeParse({ ...VALID_FOLLOW_UP, title: null }).success).toBe(false);
    expect(followUpInputSchema.safeParse({ ...VALID_FOLLOW_UP, dueAt: 'later' }).success).toBe(false);
    expect(
      followUpInputSchema.safeParse({
        ...VALID_FOLLOW_UP,
        title: 'T'.repeat(161),
      }).success
    ).toBe(false);
    expect(
      followUpInputSchema.safeParse({
        ...VALID_FOLLOW_UP,
        note: 'N'.repeat(2001),
      }).success
    ).toBe(false);
    expect(
      followUpInputSchema.safeParse({
        ...VALID_FOLLOW_UP,
        sourceType: 'job',
      }).success
    ).toBe(false);
  });

  test('requires a real calendar date with an explicit timezone', () => {
    expect(
      followUpInputSchema.safeParse({
        ...VALID_FOLLOW_UP,
        dueAt: '2014-02-30T09:00:00+01:00',
      }).success
    ).toBe(false);
    expect(
      followUpInputSchema.safeParse({
        ...VALID_FOLLOW_UP,
        dueAt: '2026-08-11T09:00:00+02:00',
      }).success
    ).toBe(true);
  });

  test('accepts only known follow-up transitions and bounded reasons', () => {
    expect(
      followUpTransitionSchema.safeParse({ targetStatus: 'completed' }).success
    ).toBe(true);
    expect(
      followUpTransitionSchema.safeParse({ targetStatus: 'deleted' }).success
    ).toBe(false);
    expect(
      followUpTransitionSchema.safeParse({
        targetStatus: 'open',
        reason: 42,
      }).success
    ).toBe(false);
  });

  test('normalizes optional whitespace-only text to an absent value', () => {
    const result = followUpInputSchema.parse({
      ...VALID_FOLLOW_UP,
      note: '   ',
      reason: '  ',
    });
    expect(result.note).toBeUndefined();
    expect(result.reason).toBeUndefined();
  });

  test('requires a real reason for a documented communication exception', () => {
    const base = {
      contactId: null,
      channel: 'phone',
      purpose: 'appointment_service',
    } as const;
    expect(
      communicationExceptionInputSchema.safeParse({ ...base, reason: '  ' })
        .success
    ).toBe(false);
    expect(
      communicationExceptionInputSchema.safeParse({
        ...base,
        reason: 'Kunde bittet um Rückruf zur akuten Störung.',
      }).success
    ).toBe(true);
  });
});
