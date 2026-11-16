import { afterEach, describe, expect, mock, test } from 'bun:test';

import type { ActionResult } from '@/lib/action-result';

// A finalize whose answer was lost, thrown by the transport or resolved as
// `finalize_failed` from a lost database answer, is repeated once under the
// same file id, so a registered upload answers as registered instead of a
// new upload being refused as `file_changed` (werk-flow/werkflow-planning#378).

const finalizeAnswers: Array<() => Promise<ActionResult>> = [];
const finalizeCalls: unknown[] = [];
mock.module('@/lib/company-profile/actions', () => ({
  createCompanyDocumentFileUploadTicket: async () => ({
    success: true,
    ticket: { fileId: '37800000-0000-4000-8000-000000000060', uploadUrl: 'https://storage.example.test/put' },
  }),
  finalizeCompanyDocumentFileUpload: async (input: unknown) => {
    finalizeCalls.push(input);
    const answer = finalizeAnswers.shift();
    if (!answer) throw new Error('unexpected finalize');
    return answer();
  },
}));
const browserFetch = globalThis.fetch;
globalThis.fetch = Object.assign(async () => new Response(null, { status: 200 }), browserFetch);
const { uploadCompanyFile } = await import('./upload-client');

const upload = () =>
  uploadCompanyFile(
    '20000000-0000-4000-8000-00000000000a',
    'logo',
    new File(['png'], 'logo.png', { type: 'image/png' }),
    null,
  );

afterEach(() => {
  finalizeAnswers.length = 0;
  finalizeCalls.length = 0;
});

describe('the upload client', () => {
  test.each([
    ['a thrown answer', () => Promise.reject(new Error('connection lost'))],
    [
      'a lost database answer',
      async (): Promise<ActionResult> => ({ success: false, error: 'finalize_failed' }),
    ],
  ] as const)('repeats a finalize after %s once, under the same file id', async (_case, firstAnswer) => {
    finalizeAnswers.push(firstAnswer, async () => ({ success: true }));
    expect(await upload()).toEqual({ success: true });
    expect(finalizeCalls).toHaveLength(2);
    expect(finalizeCalls[1]).toEqual(finalizeCalls[0]);
  });

  test('a refusal is answered at once, without a repeat', async () => {
    finalizeAnswers.push(async () => ({ success: false, error: 'file_changed' }));
    expect(await upload()).toEqual({ success: false, error: 'file_changed' });
    expect(finalizeCalls).toHaveLength(1);
  });
});
