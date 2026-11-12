import { afterEach, expect, test } from 'bun:test';

import { CLOCK_ORGANIZATION_ID, RUNNING_CLOCK_STATE } from '../../tests/ui-contracts/clock-state-fixture';
import { fetchCurrentClockState } from './state-client';

// The clock state carries today's break rule to the browser, the nine-hour
// step included, through the inline schema in state-client.ts. A step the
// schema does not know is refused rather than read as one step.
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

test.each([
  ['a malformed second step', { ...rule, secondStep: { thresholdMinutes: '540', durationMinutes: 45 } }],
  ['a missing second step', rule],
])('a clock state with %s is refused', async (_label, breakPolicy) => {
  answer(breakPolicy);
  expect(await fetchCurrentClockState(CLOCK_ORGANIZATION_ID)).toEqual({
    success: false,
    error: 'time_state_read_failed',
  });
});
