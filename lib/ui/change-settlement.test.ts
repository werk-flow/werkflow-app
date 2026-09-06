import { expect, test } from 'bun:test';
import { createChangeSettlement } from './change-settlement';

test('a missing refreshed value reports timeout instead of authoritative settlement', async () => {
  expect(await createChangeSettlement().wait(1)).toBe('timed-out');
});

test('new data settles every pending reader and cancels their timers', async () => {
  const settlement = createChangeSettlement();
  const first = settlement.wait(100);
  const second = settlement.wait(100);
  settlement.changed();
  expect(await Promise.all([first, second])).toEqual(['changed', 'changed']);
  expect(await settlement.wait(1)).toBe('timed-out');
});

test('unmount cancellation is distinct from timeout and supports a fresh mounted wait', async () => {
  const settlement = createChangeSettlement();
  const previous = settlement.wait(100);
  settlement.cancel();
  expect(await previous).toBe('cancelled');
  const current = settlement.wait(100);
  settlement.changed();
  expect(await current).toBe('changed');
});
