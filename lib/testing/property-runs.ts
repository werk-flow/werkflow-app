/**
 * How many inputs a property test (docs/technical/testing.md, "Property tests") draws, and from
 * which seed. scripts/unit-test-preload.ts hands the result to fast-check once per process, so no
 * property test chooses its own seed or run count.
 *
 * A pull request's run pins the seed: the same tree draws the same inputs on every machine, and a
 * failure names a counterexample, never a flake. `bun run test:properties` draws a fresh seed and
 * many more inputs to find new counterexamples; each one becomes a fixed example in its test.
 */

/** The seed every pinned run draws from. Changing it changes what the Fast tier proves. */
export const PINNED_PROPERTY_SEED = 20_261_122;
/** fast-check's own default; small enough for the Fast tier. */
export const PINNED_PROPERTY_RUNS = 100;

export const PROPERTY_SEED_VARIABLE = 'WERKFLOW_PROPERTY_SEED';
export const PROPERTY_RUNS_VARIABLE = 'WERKFLOW_PROPERTY_RUNS';

export type PropertyRunSettings = { seed: number; numRuns: number };

function positiveInteger(name: string, value: string): number {
  const parsed = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(parsed) || parsed < 1)
    throw new Error(`${name} must be a positive integer, got "${value}".`);
  return parsed;
}

/**
 * The settings for this process. `WERKFLOW_PROPERTY_SEED` is an integer to replay a reported
 * failure, or `random` for a fresh seed; `WERKFLOW_PROPERTY_RUNS` raises or lowers the run count.
 * A malformed value throws, so a typo never falls back to the pinned run unnoticed.
 */
export function propertyRunSettings(
  environment: Readonly<Record<string, string | undefined>>,
  randomSeed: () => number,
): PropertyRunSettings {
  const seedValue = environment[PROPERTY_SEED_VARIABLE];
  const runsValue = environment[PROPERTY_RUNS_VARIABLE];
  const seed =
    seedValue === undefined
      ? PINNED_PROPERTY_SEED
      : seedValue === 'random'
        ? randomSeed()
        : positiveInteger(PROPERTY_SEED_VARIABLE, seedValue);
  const numRuns =
    runsValue === undefined ? PINNED_PROPERTY_RUNS : positiveInteger(PROPERTY_RUNS_VARIABLE, runsValue);
  return { seed, numRuns };
}
