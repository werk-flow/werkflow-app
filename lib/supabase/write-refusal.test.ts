import { expect, test } from 'bun:test';
import { isConfirmedWriteRefusal } from './write-refusal';

test('only a raised refusal or a constraint violation confirms that a write function wrote nothing', () => {
  expect(isConfirmedWriteRefusal({ code: 'P0001' })).toBe(true);
  expect(isConfirmedWriteRefusal({ code: '23505' })).toBe(true);
  // A transport failure, a gateway body, a timeout or a lost connection leaves the outcome unknown.
  expect(isConfirmedWriteRefusal({ code: '' })).toBe(false);
  expect(isConfirmedWriteRefusal({})).toBe(false);
  expect(isConfirmedWriteRefusal({ code: '57014' })).toBe(false);
  expect(isConfirmedWriteRefusal({ code: '08006' })).toBe(false);
  expect(isConfirmedWriteRefusal(null)).toBe(false);
});
