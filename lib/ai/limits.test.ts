import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { maxTurnRunMs } from '@/lib/ai/limits';

const route = readFileSync(
  resolve(import.meta.dir, '../../app/api/ki/threads/[threadId]/turns/route.ts'),
  'utf8',
);

test('the turn route lives long enough to save the answer and settle after the turn time is up', () => {
  // Next reads `maxDuration` as a literal, so it cannot import the limits.
  const maxDuration = /export const maxDuration = (\d+);/.exec(route)?.[1];
  expect(maxDuration, 'the turn route must declare its maxDuration').toBeDefined();
  expect(maxTurnRunMs('chat')).toBeLessThanOrEqual(Number(maxDuration) * 1000);
});
