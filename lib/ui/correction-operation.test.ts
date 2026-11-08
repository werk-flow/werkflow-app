import { expect, test } from 'bun:test';
import {
  sendUnderOperation,
  type CorrectionOperation,
  type CorrectionSendResult,
} from '@/components/correction-operation';

// The server's replay rule: the first content saved under an operation id
// stands, a repeated id answers with it, and a refusal saves nothing.
function correctionServer() {
  const saved = new Map<string, string>();
  const send =
    (content: string, answer: 'answer' | 'lose' | 'refuse') =>
    async (operationId: string): Promise<CorrectionSendResult> => {
      if (answer === 'refuse') return { saved: false, message: 'Nein.' };
      const replayed = saved.has(operationId);
      if (!replayed) saved.set(operationId, content);
      if (answer === 'lose') throw new Error('response lost');
      return { saved: true, replayed, status: 'submitted' };
    };
  return { saved, send };
}

const newId = () => 'operation-1';

async function sendLost(
  operationRef: { current: CorrectionOperation | null },
  content: string,
  send: (operationId: string) => Promise<CorrectionSendResult>,
): Promise<void> {
  await expect(sendUnderOperation(operationRef, content, send, newId)).rejects.toThrow('response lost');
}

test('an answered send is saved, and the next send is a new correction', async () => {
  const server = correctionServer();
  const operationRef: { current: CorrectionOperation | null } = { current: null };
  expect(await sendUnderOperation(operationRef, 'A', server.send('A', 'answer'), newId)).toEqual({
    kind: 'saved',
    status: 'submitted',
  });
  expect(operationRef.current).toBeNull();
});

test('a plain retry after a lost response counts as saved', async () => {
  const server = correctionServer();
  const operationRef: { current: CorrectionOperation | null } = { current: null };
  await sendLost(operationRef, 'A', server.send('A', 'lose'));
  // A thrown send keeps the operation: its outcome is unknown.
  expect(operationRef.current).toEqual({ id: 'operation-1', savedContent: 'A' });
  expect(await sendUnderOperation(operationRef, 'A', server.send('A', 'answer'), newId)).toEqual({
    kind: 'saved',
    status: 'submitted',
  });
  expect(operationRef.current).toBeNull();
});

test('an edited retry after a lost response is not reported as saved', async () => {
  const server = correctionServer();
  const operationRef: { current: CorrectionOperation | null } = { current: null };
  await sendLost(operationRef, 'A', server.send('A', 'lose'));
  expect(await sendUnderOperation(operationRef, 'B', server.send('B', 'answer'), newId)).toEqual({
    kind: 'earlier-version-saved',
  });
  expect(server.saved.get('operation-1')).toBe('A');
  // The earlier version stands; the next send of the edits is a new correction.
  expect(operationRef.current).toBeNull();
});

test('an edit after a refusal is the correction, since the refusal saved nothing', async () => {
  const server = correctionServer();
  const operationRef: { current: CorrectionOperation | null } = { current: null };
  expect(await sendUnderOperation(operationRef, 'A', server.send('A', 'refuse'), newId)).toEqual({
    kind: 'failed',
    message: 'Nein.',
  });
  expect(operationRef.current).toEqual({ id: 'operation-1', savedContent: null });

  // The edit B goes in under the same id; the server saves it, the response is lost.
  await sendLost(operationRef, 'B', server.send('B', 'lose'));
  expect(operationRef.current).toEqual({ id: 'operation-1', savedContent: 'B' });

  const afterLostB = operationRef.current;

  // Retrying B replays the saved B: saved, not „earlier version“.
  expect(await sendUnderOperation({ current: afterLostB }, 'B', server.send('B', 'answer'), newId)).toEqual({
    kind: 'saved',
    status: 'submitted',
  });
  // Editing to C instead: B stands and the form says so.
  expect(await sendUnderOperation({ current: afterLostB }, 'C', server.send('C', 'answer'), newId)).toEqual({
    kind: 'earlier-version-saved',
  });
});

test('a refusal after a lost response keeps the content that may have been saved', async () => {
  const server = correctionServer();
  const operationRef: { current: CorrectionOperation | null } = { current: null };
  await sendLost(operationRef, 'A', server.send('A', 'lose'));
  // Edited to B, the retry is refused before it reaches the server.
  expect(await sendUnderOperation(operationRef, 'B', server.send('B', 'refuse'), newId)).toEqual({
    kind: 'failed',
    message: 'Nein.',
  });
  expect(operationRef.current).toEqual({ id: 'operation-1', savedContent: 'A' });
  // The next send of B replays A: the form says the earlier version stands.
  expect(await sendUnderOperation(operationRef, 'B', server.send('B', 'answer'), newId)).toEqual({
    kind: 'earlier-version-saved',
  });
});

test('an answer that arrives after the form started a new operation leaves the new one', async () => {
  const operationRef: { current: CorrectionOperation | null } = { current: null };
  let answer: (result: CorrectionSendResult) => void = () => undefined;
  const pending = sendUnderOperation(
    operationRef,
    'A',
    () =>
      new Promise<CorrectionSendResult>((resolve) => {
        answer = resolve;
      }),
    newId,
  );
  // The dialog closes and opens again while the send runs.
  operationRef.current = null;
  answer({ saved: false, message: 'Nein.' });
  expect(await pending).toEqual({ kind: 'failed', message: 'Nein.' });
  expect(operationRef.current).toBeNull();
});
