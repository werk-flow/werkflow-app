import { expect, test } from 'bun:test';
import { hashEmailChangeOtp } from './otp-hash';

const secret = 'a'.repeat(64);

test('the same code hashes differently for two users and stays 64 hex characters', () => {
  const first = hashEmailChangeOtp({ secret, userId: 'user-1', code: '123456' });
  const second = hashEmailChangeOtp({ secret, userId: 'user-2', code: '123456' });
  expect(first).not.toBe(second);
  expect(first).toMatch(/^[a-f0-9]{64}$/);
  expect(hashEmailChangeOtp({ secret, userId: 'user-1', code: '123456' })).toBe(first);
});

test('a different secret yields a different hash, so a leaked table cannot be replayed elsewhere', () => {
  expect(hashEmailChangeOtp({ secret, userId: 'user-1', code: '123456' })).not.toBe(
    hashEmailChangeOtp({ secret: 'b'.repeat(64), userId: 'user-1', code: '123456' })
  );
});

test('without the secret or the user the hash refuses instead of degrading', () => {
  expect(() => hashEmailChangeOtp({ secret: '', userId: 'user-1', code: '123456' })).toThrow('email_otp_hash_secret_missing');
  expect(() => hashEmailChangeOtp({ secret, userId: '', code: '123456' })).toThrow('email_otp_hash_user_missing');
});
