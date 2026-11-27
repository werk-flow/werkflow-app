import { expect, test } from 'bun:test';

import { KI_LIVE_STABLE_MS, kiLiveFailures, kiLiveRejoinDelayMs } from '@/lib/ai/live/rejoin';

test('the wait before joining again doubles with each failure, up to 30 s', () => {
  const ceilings = [1, 2, 3, 4, 5, 6, 7, 8].map((failures) => kiLiveRejoinDelayMs(failures, 0.999_999));
  expect(ceilings).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000, 30_000]);
});

test('the wait carries jitter between half the ceiling and the ceiling', () => {
  expect(kiLiveRejoinDelayMs(4, 0)).toBe(4_000);
  expect(kiLiveRejoinDelayMs(4, 0.5)).toBe(6_000);
  expect(kiLiveRejoinDelayMs(4, 0.999_999)).toBe(8_000);
});

test('one short success does not reset the backoff; a join that held counts as recovered', () => {
  expect(kiLiveFailures(3, null), 'a join that never succeeded adds a failure').toBe(4);
  expect(kiLiveFailures(3, 5_000), 'a join that dropped after five seconds must keep backing off').toBe(4);
  expect(kiLiveFailures(3, KI_LIVE_STABLE_MS), 'a join that held a minute starts the backoff again').toBe(1);
});
