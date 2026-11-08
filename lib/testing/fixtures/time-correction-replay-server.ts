// A stand-in for create_time_correction_request's replay rule: a repeated
// operation id answers with the request it first saved and never compares the
// payload. `next` sets how the next call ends: answered, saved with its
// response lost, or refused before anything is saved.

import type { TimeCorrectionResult } from '@/lib/time-corrections/types';
import type { SubmitTimeCorrectionInput } from '@/lib/time-corrections/validation';

export function timeCorrectionReplayServer() {
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
