import { expect, test } from 'bun:test';
import { pastDayOutcome } from '@/components/manual-entry-past-day-outcome';

test('a replayed send counts as saved only when the form has not changed since the first send', () => {
  expect(pastDayOutcome({ saved: true, replayed: false }, false)).toEqual({ kind: 'saved' });
  // A retry of the same content after a lost response: the saved correction is this one.
  expect(pastDayOutcome({ saved: true, replayed: true }, false)).toEqual({ kind: 'saved' });
  // Edited after a lost response: the earlier version stands, the edits did not reach the server.
  expect(pastDayOutcome({ saved: true, replayed: true }, true)).toEqual({ kind: 'earlier-version-saved' });
  // Edited after a refusal: nothing was saved under this id, so the new content is the correction.
  expect(pastDayOutcome({ saved: true, replayed: false }, true)).toEqual({ kind: 'saved' });
  expect(pastDayOutcome({ saved: false, message: 'Nein.' }, true)).toEqual({
    kind: 'failed',
    message: 'Nein.',
  });
});
