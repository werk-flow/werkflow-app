// The server process runs in the business zone wherever it is hosted: Vercel and CI start Node in UTC.
import { afterAll, expect, test } from 'bun:test';
import { register } from '../../instrumentation';
import { BERLIN_TIME_ZONE } from './berlin';

const original = { tz: process.env.TZ, runtime: process.env.NEXT_RUNTIME };
afterAll(() => {
  process.env.TZ = original.tz;
  process.env.NEXT_RUNTIME = original.runtime;
});

test('a Node server started in UTC reads wall times in Europe/Berlin after instrumentation', () => {
  process.env.TZ = 'UTC';
  process.env.NEXT_RUNTIME = 'nodejs';
  // 25 October 2026, the fall-back day: 09:00Z is 10:00 in Berlin.
  expect(new Date('2026-10-25T09:00:00Z').getHours()).toBe(9);
  register();
  expect(process.env.TZ).toBe(BERLIN_TIME_ZONE);
  expect(new Date('2026-10-25T09:00:00Z').getHours()).toBe(10);
});
