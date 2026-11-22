import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import { berlinMidnightMs } from '@/lib/testing/berlin-arbitraries';
import { berlinMonth, legacyEntriesAround, yearMonthArbitrary } from '@/lib/testing/time-account-arbitraries';
import type { TimeCorrectionApplicationProjection } from '@/lib/time-corrections/types';
import type { TimeEntry } from '@/lib/time-tracking/types';
import { hasUnclosedLegacySequence, projectLegacyEntriesForWindow } from './legacy-projection';

// Property tests (docs/technical/testing.md, "Property tests") of docs/features/time-tracking.md,
// "Period close": a period is one Berlin calendar month, so every recorded entry, a corrected one
// included, belongs to exactly one period; an approved correction replaces the entries it names; a
// missing clock-out blocks the close („Fehlende Buchung“).

const monthTurnArbitrary = yearMonthArbitrary.chain(({ year, month }) => {
  const first = berlinMonth(year, month);
  const second = berlinMonth(year, month + 1);
  const turn = berlinMidnightMs(second.start);
  return fc.record({
    first: fc.constant(first),
    second: fc.constant(second),
    entries: legacyEntriesAround(turn),
    corrected: legacyEntriesAround(turn),
    replaced: fc.nat({ max: 3 }),
  });
});

/** One approved correction that replaces the first `replaced` entries with the corrected facts. */
function correction(entries: readonly TimeEntry[], corrected: readonly TimeEntry[], replaced: number) {
  const application: TimeCorrectionApplicationProjection = {
    applicationId: 'application-1',
    requestId: 'request-1',
    appliedAt: '2000-01-01T00:00:00.000Z',
    appliedBy: 'user-2',
    sourceFingerprint: 'fingerprint-1',
    snapshot: {
      schemaVersion: 1,
      facts: corrected.map((entry, index) => ({
        factId: `fact-${index}`,
        employeeRecordId: 'record-1',
        userId: entry.userId,
        entryType: entry.entryType,
        timestamp: entry.timestamp,
        jobId: entry.jobId,
        activityKind: entry.activityKind ?? null,
        isManual: true,
      })),
    },
    sources: entries
      .slice(0, replaced)
      .map((entry) => ({ kind: 'legacy_entry', id: entry.id, version: '1' })),
  };
  return application;
}

const instant = (localDate: string): string => new Date(berlinMidnightMs(localDate)).toISOString();

describe('Entries projected into a period', () => {
  test('lie between the Berlin midnights of its month, and two months share none', () => {
    fc.assert(
      fc.property(monthTurnArbitrary, ({ first, second, entries, corrected, replaced }) => {
        const applications = [correction(entries, corrected, replaced)];
        const project = (from: string, to: string) =>
          projectLegacyEntriesForWindow({
            entries,
            applications,
            organizationId: 'org-1',
            startInstant: instant(from),
            endInstant: instant(to),
          });
        const months = [first, second].map((month) => project(month.start, month.endExclusive));
        for (const [index, month] of [first, second].entries())
          for (const entry of months[index] ?? []) {
            expect(Date.parse(entry.timestamp)).toBeGreaterThanOrEqual(berlinMidnightMs(month.start));
            expect(Date.parse(entry.timestamp)).toBeLessThan(berlinMidnightMs(month.endExclusive));
          }
        const ids = (projected: readonly TimeEntry[]) => projected.map((entry) => entry.id).sort();
        expect(ids(months.flat())).toEqual(ids(project(first.start, second.endExclusive)));
      }),
    );
  });

  test('leave out every entry an approved correction replaced, and carry its facts instead', () => {
    fc.assert(
      fc.property(monthTurnArbitrary, ({ first, second, entries, corrected, replaced }) => {
        const projected = projectLegacyEntriesForWindow({
          entries,
          applications: [correction(entries, corrected, replaced)],
          organizationId: 'org-1',
          startInstant: instant(first.start),
          endInstant: instant(second.endExclusive),
        });
        const inWindow = (entry: TimeEntry): boolean =>
          Date.parse(entry.timestamp) >= berlinMidnightMs(first.start) &&
          Date.parse(entry.timestamp) < berlinMidnightMs(second.endExclusive);
        const replacedIds = new Set(entries.slice(0, replaced).map((entry) => entry.id));
        const kept = entries.filter((entry) => !replacedIds.has(entry.id) && inWindow(entry));
        expect(
          projected
            .filter((entry) => entry.id.startsWith('entry-'))
            .map((entry) => entry.id)
            .sort(),
        ).toEqual(kept.map((entry) => entry.id).sort());
        expect(
          projected
            .filter((entry) => !entry.id.startsWith('entry-'))
            .map((entry) => entry.timestamp)
            .sort(),
        ).toEqual(
          corrected
            .filter(inWindow)
            .map((entry) => entry.timestamp)
            .sort(),
        );
      }),
    );
  });
});

describe('A sequence without its clock-out', () => {
  test('is open exactly when the last approved entry is no clock-out, in any read order', () => {
    fc.assert(
      fc.property(
        monthTurnArbitrary.chain(({ entries }) =>
          fc.tuple(fc.constant(entries), fc.shuffledSubarray(entries, { minLength: entries.length })),
        ),
        ([entries, shuffled]) => {
          const last = entries.filter((entry) => entry.status === 'approved').at(-1);
          const open = last !== undefined && last.entryType !== 'clock_out';
          expect(hasUnclosedLegacySequence(entries)).toBe(open);
          expect(hasUnclosedLegacySequence(shuffled)).toBe(open);
        },
      ),
    );
  });
});
