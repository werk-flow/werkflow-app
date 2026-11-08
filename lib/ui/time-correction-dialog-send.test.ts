import { expect, test } from 'bun:test';
import type { CorrectionOperation } from '@/components/correction-operation';
import { sendTimeCorrection } from '@/components/zeiterfassung/time-correction-dialog-send';
import type { TimeCorrectionResult } from '@/lib/time-corrections/types';
import type { SubmitTimeCorrectionInput } from '@/lib/time-corrections/validation';

// create_time_correction_request's replay rule: a repeated operation id
// answers with the request it first saved and never compares the payload.
// `next` sets how the next call ends: answered, saved with its response
// lost, or refused before anything is saved.
function correctionServer() {
  const saved = new Map<string, SubmitTimeCorrectionInput>();
  const server: {
    saved: typeof saved;
    next: 'answer' | 'lose' | 'refuse';
    submit: (input: SubmitTimeCorrectionInput) => Promise<TimeCorrectionResult>;
  } = {
    saved,
    next: 'answer',
    submit: async (input: SubmitTimeCorrectionInput): Promise<TimeCorrectionResult> => {
      if (server.next === 'refuse') return { success: false, error: 'correction_timeline_conflict' };
      const replayed = saved.has(input.operationId);
      if (!replayed) saved.set(input.operationId, input);
      if (server.next === 'lose') throw new Error('response lost');
      return { success: true, requestId: 'request-1', status: 'submitted', replayed };
    },
  };
  return server;
}

const submission = {
  organizationId: '00000000-0000-4000-8000-000000000001',
  subjectEmployeeRecordId: '00000000-0000-4000-8000-000000000002',
  kind: 'add',
  reason: 'Stempeln vergessen',
  source: null,
  proposedFacts: [],
} satisfies Omit<SubmitTimeCorrectionInput, 'operationId'>;
// The dialog keeps this open: the earlier version stands, the edits are not saved.
const EARLIER_VERSION_SAVED = {
  saved: false,
  message:
    'Deine Korrektur war schon mit den vorherigen Angaben gespeichert. Deine Änderungen sind nicht gespeichert. Prüfe die Zeiten, bevor du erneut korrigierst.',
};
const edited = { ...submission, reason: 'Stempeln vergessen, Baustelle Nord' };

// One opening of the dialog whose first send was saved but lost its response.
async function openingWithLostResponse() {
  const server = correctionServer();
  const operationRef: { current: CorrectionOperation | null } = { current: null };
  server.next = 'lose';
  await expect(sendTimeCorrection(operationRef, submission, server.submit)).rejects.toThrow('response lost');
  server.next = 'answer';
  return { server, operationRef };
}

test('an edited retry after a lost response is not reported as saved', async () => {
  const { server, operationRef } = await openingWithLostResponse();
  expect(await sendTimeCorrection(operationRef, edited, server.submit)).toEqual(EARLIER_VERSION_SAVED);
  expect([...server.saved.values()].map((input) => input.reason)).toEqual(['Stempeln vergessen']);
  // The next send of the edits is a new correction under a new id.
  expect(operationRef.current).toBeNull();
});

test('a plain retry after a lost response is reported as saved', async () => {
  const { server, operationRef } = await openingWithLostResponse();
  expect(await sendTimeCorrection(operationRef, submission, server.submit)).toEqual({
    saved: true,
    message: 'Die Korrektur wurde zur Prüfung eingereicht.',
  });
  expect(server.saved.size).toBe(1);
});

test('a refusal after a lost response keeps the earlier content', async () => {
  const { server, operationRef } = await openingWithLostResponse();
  const lost = operationRef.current;
  expect(lost?.savedContent).toBe(JSON.stringify(submission));
  server.next = 'refuse';
  expect(await sendTimeCorrection(operationRef, edited, server.submit)).toEqual({
    saved: false,
    message:
      'Die Änderung überschneidet sich mit einer anderen Buchung oder unterbricht eine bestehende Arbeitszeit. Bitte prüfe die Zeiten erneut.',
  });
  expect(operationRef.current).toEqual(lost);
  // The edits go in again under the same id and replay the lost first send.
  server.next = 'answer';
  expect(await sendTimeCorrection(operationRef, edited, server.submit)).toEqual(EARLIER_VERSION_SAVED);
});
