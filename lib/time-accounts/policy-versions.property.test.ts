import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import { describePolicyVersions, versionInForce } from './policy-versions';

// Property tests (docs/technical/testing.md, "Property tests") of docs/features/time-tracking.md,
// "Time accounts": a day follows the policy version with the latest start on or before it; the
// rules card lists every version with its span and marks the one in force today.

/** Dates of a few weeks around a year turn, so starts collide and spans touch. */
const DATES = Array.from({ length: 40 }, (_, index) =>
  new Date(Date.UTC(2026, 11, 10 + index)).toISOString().slice(0, 10),
);
const dateArbitrary = fc.constantFrom(...DATES);

/** Versions of one policy: distinct numbers, starts that may repeat. */
const versionsArbitrary = fc
  .uniqueArray(fc.integer({ min: 1, max: 30 }), { minLength: 0, maxLength: 8 })
  .chain((numbers) =>
    fc
      .array(dateArbitrary, { minLength: numbers.length, maxLength: numbers.length })
      .map((starts) =>
        numbers.map((version, index) => ({ version, effective_from: starts[index] ?? '2026-12-10' })),
      ),
  );

type Version = { version: number; effective_from: string };

/** The version in force by the spec's sentence: latest start on or before, then the higher number. */
function oracleInForce(versions: readonly Version[], date: string): Version | undefined {
  let best: Version | undefined;
  for (const version of versions) {
    if (version.effective_from > date) continue;
    if (
      !best ||
      version.effective_from > best.effective_from ||
      (version.effective_from === best.effective_from && version.version > best.version)
    )
      best = version;
  }
  return best;
}

describe('The policy version in force on a day', () => {
  test('is the one with the latest start on or before it, whatever order the versions come in', () => {
    fc.assert(
      fc.property(
        versionsArbitrary.chain((versions) =>
          fc.tuple(fc.constant(versions), fc.shuffledSubarray(versions, { minLength: versions.length })),
        ),
        dateArbitrary,
        ([versions, shuffled], date) => {
          expect(versionInForce(versions, date)).toEqual(oracleInForce(versions, date));
          expect(versionInForce(shuffled, date)).toEqual(oracleInForce(versions, date));
        },
      ),
    );
  });
});

describe('The rules card', () => {
  test('lists every version once, each day in exactly one span, of the version in force that day', () => {
    fc.assert(
      fc.property(versionsArbitrary, dateArbitrary, (versions, today) => {
        const lines = describePolicyVersions(versions, today);
        expect(lines.map((line) => line.version).sort((a, b) => a - b)).toEqual(
          versions.map((version) => version.version).sort((a, b) => a - b),
        );
        for (const date of DATES) {
          const spans = lines.filter(
            (line) =>
              line.status !== 'replaced' &&
              line.effectiveFrom <= date &&
              (line.validUntil === null || date <= line.validUntil),
          );
          const inForce = oracleInForce(versions, date);
          expect(spans.map((line) => line.version)).toEqual(inForce ? [inForce.version] : []);
        }
      }),
    );
  });

  test('marks exactly the version in force today, and none before the first start', () => {
    fc.assert(
      fc.property(versionsArbitrary, dateArbitrary, (versions, today) => {
        const marked = describePolicyVersions(versions, today).filter((line) => line.status === 'in_force');
        const inForce = oracleInForce(versions, today);
        expect(marked.map((line) => line.version)).toEqual(inForce ? [inForce.version] : []);
      }),
    );
  });
});
