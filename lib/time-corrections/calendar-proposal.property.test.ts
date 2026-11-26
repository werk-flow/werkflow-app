import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import {
  MINUTE_MS,
  clockMinutes,
  correctionFact,
  correctionStartArbitrary,
} from '@/lib/testing/time-correction-arbitraries';
import { proposeCalendarCorrection } from './calendar-proposal';
import type { TimeCorrectionFact } from './types';
import type { CalendarCorrectionBoundary } from './validation';

// Property tests (docs/technical/testing.md, "Property tests") of docs/features/time-tracking.md,
// "Corrections" and "Correction lifecycle": a correction moved in the calendar proposes every
// boundary of the recorded time it names, exactly once, and nothing is erased: a move of a whole
// block keeps its minutes, and a move that misses a boundary or rests on a changed one is refused.

/** Recorded sessions of one person, each boundary a legacy entry of its own. */
const recordedArbitrary = fc
  .tuple(
    correctionStartArbitrary,
    fc.array(
      fc.record({ gap: fc.integer({ min: 1, max: 600 }), minutes: fc.integer({ min: 1, max: 600 }) }),
      {
        minLength: 1,
        maxLength: 4,
      },
    ),
  )
  .map(([first, draws]) => {
    let cursor = first;
    return draws.flatMap((draw, index): TimeCorrectionFact[] => {
      const start = cursor + draw.gap * MINUTE_MS;
      cursor = start + draw.minutes * MINUTE_MS;
      return [
        correctionFact(`entry-${index}-in`, 'clock_in', start),
        correctionFact(`entry-${index}-out`, 'clock_out', cursor),
      ];
    });
  });

const contextOf = (fact: TimeCorrectionFact) => ({
  source: { kind: 'legacy_entry' as const, id: fact.factId, version: fact.timestamp },
  snapshot: { schemaVersion: 1 as const, facts: [fact] },
});

const boundaryOf = (fact: TimeCorrectionFact, shiftMinutes: number): CalendarCorrectionBoundary => ({
  source: { kind: 'legacy_entry', id: fact.factId, version: fact.timestamp },
  entryType: fact.entryType,
  originalTimestamp: fact.timestamp,
  timestamp: new Date(Date.parse(fact.timestamp) + shiftMinutes * MINUTE_MS).toISOString(),
  employeeRecordId: 'person-record',
});

const shiftArbitrary = fc.integer({ min: -720, max: 720 });

describe('A correction moved in the calendar', () => {
  test('moves every boundary of the recorded time once and keeps its minutes', () => {
    fc.assert(
      fc.property(recordedArbitrary, shiftArbitrary, (facts, shift) => {
        const proposal = proposeCalendarCorrection({
          contexts: facts.map(contextOf),
          boundaries: facts.map((fact) => boundaryOf(fact, shift)),
        });
        if (!proposal.success) throw new Error(`A whole move is refused: ${proposal.error}`);
        const moved = (fact: TimeCorrectionFact) => [fact.entryType, Date.parse(fact.timestamp)];
        expect(proposal.before.facts.map(moved)).toEqual(facts.map(moved));
        expect(proposal.snapshot.facts.map(moved)).toEqual(
          facts.map((fact) => [fact.entryType, Date.parse(fact.timestamp) + shift * MINUTE_MS]),
        );
        expect(clockMinutes(proposal.snapshot.facts)).toEqual(clockMinutes(facts));
      }),
    );
  });

  test('is refused when it misses a boundary or one of its boundaries changed meanwhile', () => {
    fc.assert(
      fc.property(recordedArbitrary, shiftArbitrary, fc.nat(), fc.boolean(), (facts, shift, pick, stale) => {
        const boundaries = facts.map((fact) => boundaryOf(fact, shift));
        const index = pick % boundaries.length;
        const target = boundaries[index];
        if (!target) throw new Error('A recorded session has boundaries.');
        const changed = stale
          ? boundaries.with(index, { ...target, source: { ...target.source, version: 'changed meanwhile' } })
          : boundaries.toSpliced(index, 1);
        expect(proposeCalendarCorrection({ contexts: facts.map(contextOf), boundaries: changed })).toEqual({
          success: false,
          error: stale ? 'time_correction_stale_source' : 'calendar_incomplete_source',
        });
      }),
    );
  });
});
