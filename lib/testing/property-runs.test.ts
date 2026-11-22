import { describe, expect, test } from 'bun:test';
import { PINNED_PROPERTY_RUNS, PINNED_PROPERTY_SEED, propertyRunSettings } from './property-runs';

const noRandom = (): number => {
  throw new Error('a pinned run draws no random seed');
};

describe('property run settings', () => {
  test('pin the seed and run count when nothing is set, so a pull request run never flakes', () => {
    expect(propertyRunSettings({}, noRandom)).toEqual({
      seed: PINNED_PROPERTY_SEED,
      numRuns: PINNED_PROPERTY_RUNS,
    });
  });

  test('replay a reported seed and take a raised run count', () => {
    expect(
      propertyRunSettings({ WERKFLOW_PROPERTY_SEED: '1587307876', WERKFLOW_PROPERTY_RUNS: '2000' }, noRandom),
    ).toEqual({ seed: 1_587_307_876, numRuns: 2000 });
  });

  test('draw a fresh seed only when asked for one', () => {
    expect(propertyRunSettings({ WERKFLOW_PROPERTY_SEED: 'random' }, () => 42).seed).toBe(42);
  });

  test('refuse a malformed value instead of falling back to the pinned run', () => {
    for (const value of ['', 'abc', '-1', '0', '1.5', '1e3'])
      expect(() => propertyRunSettings({ WERKFLOW_PROPERTY_RUNS: value }, noRandom)).toThrow(
        'positive integer',
      );
    expect(() => propertyRunSettings({ WERKFLOW_PROPERTY_SEED: 'seed' }, noRandom)).toThrow(
      'positive integer',
    );
  });
});
