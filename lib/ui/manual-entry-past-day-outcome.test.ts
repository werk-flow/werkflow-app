import { expect, test } from 'bun:test';
import {
  finishPastDaySend,
  pastDayOutcome,
  startPastDaySend,
} from '@/components/manual-entry-past-day-outcome';

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

test('a retry after a refusal and a lost response counts the content the server saved, not the refused one', () => {
  const newId = () => 'operation-1';
  // Content A is refused: nothing was saved under the id.
  const refused = startPastDaySend(null, 'A', newId);
  expect(refused.editedSinceFirstSend).toBe(false);
  const afterRefusal = finishPastDaySend(refused.operation, 'failed');
  expect(afterRefusal).toEqual({ id: 'operation-1', savedContent: null });

  // The edit B goes in under the same id; the server saves it, the response is lost.
  const lost = startPastDaySend(afterRefusal, 'B', newId);
  expect(lost).toEqual({ operation: { id: 'operation-1', savedContent: 'B' }, editedSinceFirstSend: false });

  // Retrying B replays the saved B: saved, not „earlier version“.
  const retry = startPastDaySend(lost.operation, 'B', newId);
  expect(pastDayOutcome({ saved: true, replayed: true }, retry.editedSinceFirstSend)).toEqual({
    kind: 'saved',
  });
  expect(finishPastDaySend(retry.operation, 'saved')).toBeNull();

  // Editing to C after the lost B: B stands and the form says so.
  const edited = startPastDaySend(lost.operation, 'C', newId);
  expect(pastDayOutcome({ saved: true, replayed: true }, edited.editedSinceFirstSend)).toEqual({
    kind: 'earlier-version-saved',
  });
});
