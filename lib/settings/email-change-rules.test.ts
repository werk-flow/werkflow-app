import { expect, test } from 'bun:test';
import { isDefiniteEmailUpdateRejection } from './email-change-rules';

test('only definite provider rejection permits abandoning a completion claim', () => {
  for (const status of [400, 401, 403, 404, 409, 422]) {
    expect(isDefiniteEmailUpdateRejection(status)).toBe(true);
  }
  for (const status of [undefined, 200, 408, 429, 500, 502, 503, 504]) {
    expect(isDefiniteEmailUpdateRejection(status)).toBe(false);
  }
});
