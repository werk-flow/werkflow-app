import { describe, expect, mock, test } from 'bun:test';
import fc from 'fast-check';
import { berlinInstantMsArbitrary } from '@/lib/testing/berlin-arbitraries';

// The module is server-only; its recovery rule is a pure function.
mock.module('server-only', () => ({}));
const { sessionNeedsRecovery } = await import('./canonical-clock-state');

// Property tests (docs/technical/testing.md, "Property tests"). The rule comes from
// docs/features/time-tracking.md, "Recovery": a session open for more than a day shows a recovery
// path, and ending it records the end as a recovery, also when nothing marked it before; a
// session the database flagged needs the recovery whatever its age.

const DAY_MS = 24 * 60 * 60 * 1000;

describe('An open session', () => {
  test('needs recovery exactly when it has run longer than a day or the database flagged it', () => {
    fc.assert(
      fc.property(
        berlinInstantMsArbitrary,
        fc.integer({ min: 0, max: 3 * DAY_MS }),
        fc.constantFrom('open', 'recovery_required'),
        (start, open, status) => {
          const session = { status, started_at: new Date(start).toISOString() };
          expect(sessionNeedsRecovery(session, new Date(start + open))).toBe(
            status === 'recovery_required' || open > DAY_MS,
          );
        },
      ),
      {
        examples: [
          [Date.parse('2026-10-24T22:30:00Z'), DAY_MS, 'open'],
          [Date.parse('2026-10-24T22:30:00Z'), DAY_MS + 1, 'open'],
        ],
      },
    );
  });
});
