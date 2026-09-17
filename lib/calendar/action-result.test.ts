import { expect, test } from 'bun:test';
import { calendarActionResult } from './action-result';

test('calendar transport rejection becomes a normal failure for rollback and settlement', async () => {
  expect(await calendarActionResult(async () => { throw new Error('connection interrupted'); })).toEqual({ success: false, error: 'calendar_transport_failed' });
});
test('calendar action normalization preserves domain failures and successful values', async () => {
  const denied = { success: false as const, error: 'qualification_declined' };
  const saved = { success: true as const, version: 9 };
  expect(await calendarActionResult(async () => denied)).toBe(denied);
  expect(await calendarActionResult(async () => saved)).toBe(saved);
});
