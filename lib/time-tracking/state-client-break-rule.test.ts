import { afterEach, expect, test } from 'bun:test';

import { CLOCK_ORGANIZATION_ID, RUNNING_CLOCK_STATE } from '../../tests/ui-contracts/clock-state-fixture';
import { fetchCurrentClockState } from './state-client';

// The clock state carries today's break rule to the browser, the nine-hour
// step included, through the inline schema in state-client.ts. A malformed
// step is refused; a missing one (the previous release's server during a
// deploy) reads as one step.
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function answer(breakPolicy: unknown): void {
  globalThis.fetch = Object.assign(
    async () => Response.json({ success: true, state: { ...RUNNING_CLOCK_STATE, breakPolicy } }),
    { preconnect: originalFetch.preconnect },
  );
}

const rule = { breakMode: 'automatic', autoBreakThresholdMinutes: 360, autoBreakDurationMinutes: 30 };

test('a clock state with the second step reads it', async () => {
  answer({ ...rule, secondStep: { thresholdMinutes: 540, durationMinutes: 45 } });
  const result = await fetchCurrentClockState(CLOCK_ORGANIZATION_ID);
  expect(result.success && result.state.breakPolicy.secondStep).toEqual({
    thresholdMinutes: 540,
    durationMinutes: 45,
  });
});

test('a clock state with a malformed second step is refused', async () => {
  answer({ ...rule, secondStep: { thresholdMinutes: '540', durationMinutes: 45 } });
  expect(await fetchCurrentClockState(CLOCK_ORGANIZATION_ID)).toEqual({
    success: false,
    error: 'time_state_read_failed',
  });
});

test("the previous release's clock state without a second step reads as one step", async () => {
  answer(rule);
  const result = await fetchCurrentClockState(CLOCK_ORGANIZATION_ID);
  expect(result.success && result.state.breakPolicy.secondStep).toBeNull();
});
