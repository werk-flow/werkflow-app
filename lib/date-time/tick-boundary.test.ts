import { expect, test } from 'bun:test';
import { delayToNextTickBoundary } from './tick-boundary';

test('a minute tick waits for the next whole minute', () => {
  const minute = 60_000;
  const startOfMinute = Date.UTC(2026, 9, 22, 9, 15, 0);
  expect(delayToNextTickBoundary(startOfMinute + 59_000, minute)).toBe(1_000);
  expect(delayToNextTickBoundary(startOfMinute + 1, minute)).toBe(59_999);
});

test('an instant on a boundary waits one whole period, never zero', () => {
  expect(delayToNextTickBoundary(Date.UTC(2026, 9, 22, 9, 16, 0), 60_000)).toBe(60_000);
  expect(delayToNextTickBoundary(12_000, 1_000)).toBe(1_000);
});
