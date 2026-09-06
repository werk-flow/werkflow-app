import { describe, expect, test } from 'bun:test';
import { canCompleteEmailChange, canResendNewEmailCode } from './email-change-rules';

const now = new Date('2026-09-06T12:00:00Z');
const later = new Date('2026-09-06T12:09:00Z').toISOString();
const earlier = new Date('2026-09-06T11:00:00Z').toISOString();

describe('email change rules', () => {
  test('no challenge cannot resend or complete', () => {
    expect(canResendNewEmailCode(null, now)).toBe(false);
    expect(canCompleteEmailChange(null, now)).toBe(false);
  });

  test('a pending_new challenge without current verification is rejected', () => {
    const challenge = {
      status: 'pending_new' as const,
      currentEmailVerifiedAt: null,
      currentEmailVerifiedExpiresAt: null,
    };
    expect(canResendNewEmailCode(challenge, now)).toBe(false);
    expect(canCompleteEmailChange(challenge, now)).toBe(false);
  });

  test('an expired current verification is rejected', () => {
    const challenge = {
      status: 'pending_new' as const,
      currentEmailVerifiedAt: earlier,
      currentEmailVerifiedExpiresAt: earlier,
    };
    expect(canResendNewEmailCode(challenge, now)).toBe(false);
    expect(canCompleteEmailChange(challenge, now)).toBe(false);
  });

  test('a current_verified challenge cannot resend a new-address code', () => {
    const challenge = {
      status: 'current_verified' as const,
      currentEmailVerifiedAt: earlier,
      currentEmailVerifiedExpiresAt: later,
    };
    expect(canResendNewEmailCode(challenge, now)).toBe(false);
  });

  test('a pending_new challenge inside the window may resend and complete', () => {
    const challenge = {
      status: 'pending_new' as const,
      currentEmailVerifiedAt: earlier,
      currentEmailVerifiedExpiresAt: later,
    };
    expect(canResendNewEmailCode(challenge, now)).toBe(true);
    expect(canCompleteEmailChange(challenge, now)).toBe(true);
  });
});
