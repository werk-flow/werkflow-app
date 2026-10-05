import { expect, test } from 'bun:test';
import { ResponsivenessError } from './live-observation';
import { responsivenessLimitMs, completeRecordedObservation } from './responsiveness-tolerance';

const over = (measuredMs: number, targetMs = 2000) =>
  new ResponsivenessError({
    status: 'visible',
    correctness: 'observed',
    responsiveness: 'over_target',
    targetMs,
    measuredMs,
  });

test('the tolerance limit is the larger of 25 percent and 250 ms above the target', () => {
  expect(responsivenessLimitMs(2000)).toBe(2500);
  expect(responsivenessLimitMs(5000)).toBe(6250);
  expect(responsivenessLimitMs(500)).toBe(750);
});

test('a recorded slow result permits remaining checks; correctness failures still stop the task', async () => {
  expect(await completeRecordedObservation(async () => 1500)).toBe(1500);
  expect(
    await completeRecordedObservation(async () => {
      throw over(2500);
    }),
  ).toBe(2500);
  expect(
    await completeRecordedObservation(async () => {
      throw over(8000);
    }),
  ).toBe(8000);
  await expect(
    completeRecordedObservation(async () => {
      throw new Error('mutation failed');
    }),
  ).rejects.toThrow('mutation failed');
});
