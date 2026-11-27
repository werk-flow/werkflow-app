import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { AI_TURN_LIMITS } from '@/lib/ai/limits';

const route = readFileSync(
  resolve(import.meta.dir, '../../app/api/ki/threads/[threadId]/turns/route.ts'),
  'utf8',
);

test('the turn route lives long enough to save the answer and settle after the turn time is up', () => {
  // The turn's total time, then the last attempt's cost write, the partial save in flight, the final save,
  // the settlement, and the live send in flight with the answer's end, each at its limit.
  const { totalTimeoutMs, costWriteTimeoutMs, answerSaveTimeoutMs, settleTimeoutMs, liveSendTimeoutMs } =
    AI_TURN_LIMITS.chat;
  const longestRunMs =
    totalTimeoutMs + costWriteTimeoutMs + 2 * answerSaveTimeoutMs + settleTimeoutMs + 2 * liveSendTimeoutMs;
  // Next reads `maxDuration` as a literal, so it cannot import the limits.
  const maxDuration = /export const maxDuration = (\d+);/.exec(route)?.[1];
  expect(maxDuration, 'the turn route must declare its maxDuration').toBeDefined();
  expect(longestRunMs).toBeLessThanOrEqual(Number(maxDuration) * 1000);
});
