import { expect, test } from 'bun:test';
import type { CorrectionOperation } from '@/components/correction-operation';
import { sendCalendarTimeCorrection } from '@/components/kalender/calendar-time-correction-send';
import { timeCorrectionReplayServer } from '@/lib/testing/fixtures/time-correction-replay-server';
import type {
  CalendarCorrectionBoundary,
  SubmitTimeCorrectionInput,
} from '@/lib/time-corrections/validation';

function boundary(
  entryType: CalendarCorrectionBoundary['entryType'],
  originalTimestamp: string,
  timestamp: string,
): CalendarCorrectionBoundary {
  return {
    source: { kind: 'canonical_segment', id: '00000000-0000-4000-8000-000000000003', version: 'v1' },
    entryType,
    originalTimestamp,
    timestamp,
    employeeRecordId: '00000000-0000-4000-8000-000000000002',
  };
}

// A drag in the calendar: its moved boundary is fixed for the draft, and only
// the reason stays editable.
const submission = {
  organizationId: '00000000-0000-4000-8000-000000000001',
  subjectEmployeeRecordId: '00000000-0000-4000-8000-000000000002',
  kind: 'edit',
  reason: 'Baustelle länger',
  source: null,
  proposedFacts: [],
  calendarAdjustment: [
    boundary('clock_in', '2026-11-02T07:00:00.000Z', '2026-11-02T07:00:00.000Z'),
    boundary('clock_out', '2026-11-02T15:00:00.000Z', '2026-11-02T16:00:00.000Z'),
  ],
} satisfies Omit<SubmitTimeCorrectionInput, 'operationId'>;
const editedReason = { ...submission, reason: 'Baustelle länger, Abnahme mit Kunde' };
// The dialog keeps this open: the move stands with the earlier reason.
const EARLIER_REASON_SAVED = {
  kind: 'earlier-version-saved' as const,
  message:
    'Deine Korrektur war schon mit dem vorherigen Grund gespeichert. Dein geänderter Grund ist nicht gespeichert. Prüfe die Korrektur in der Zeiterfassung.',
};

// One draft whose first send was saved but lost its response.
async function draftWithLostResponse() {
  const server = timeCorrectionReplayServer();
  const operationRef: { current: CorrectionOperation | null } = { current: null };
  server.next = 'lose';
  await expect(sendCalendarTimeCorrection(operationRef, submission, server.submit)).rejects.toThrow(
    'response lost',
  );
  server.next = 'answer';
  return { server, operationRef };
}

test('an edited reason after a lost response is not reported as saved', async () => {
  const { server, operationRef } = await draftWithLostResponse();
  expect(await sendCalendarTimeCorrection(operationRef, editedReason, server.submit)).toEqual(
    EARLIER_REASON_SAVED,
  );
  expect([...server.saved.values()].map((input) => input.reason)).toEqual(['Baustelle länger']);
});

test('a plain retry after a lost response is reported as saved', async () => {
  const { server, operationRef } = await draftWithLostResponse();
  expect(await sendCalendarTimeCorrection(operationRef, submission, server.submit)).toEqual({
    kind: 'saved',
    message: 'Die Korrektur wurde zur Prüfung eingereicht.',
  });
  expect(server.saved.size).toBe(1);
});

test('a refusal after a lost response keeps the earlier reason', async () => {
  const { server, operationRef } = await draftWithLostResponse();
  const lost = operationRef.current;
  expect(lost?.savedContent).toBe('Baustelle länger');
  server.next = 'refuse';
  expect(await sendCalendarTimeCorrection(operationRef, editedReason, server.submit)).toEqual({
    kind: 'failed',
    message:
      'Die Änderung überschneidet sich mit einer anderen Buchung oder unterbricht eine bestehende Arbeitszeit. Bitte prüfe die Zeiten erneut.',
  });
  expect(operationRef.current).toEqual(lost);
  // The edited reason goes in again under the same id and replays the lost first send.
  server.next = 'answer';
  expect(await sendCalendarTimeCorrection(operationRef, editedReason, server.submit)).toEqual(
    EARLIER_REASON_SAVED,
  );
});

test('a calendar refusal names the calendar sentence', async () => {
  const operationRef: { current: CorrectionOperation | null } = { current: null };
  const answer = await sendCalendarTimeCorrection(operationRef, submission, async () => ({
    success: false,
    error: 'time_correction_stale_source',
  }));
  expect(answer).toEqual({
    kind: 'failed',
    message: 'Die Buchung wurde inzwischen geändert. Bitte lade den Kalender neu und prüfe die Änderung.',
  });
});
