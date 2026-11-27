import { afterEach, expect, spyOn, test } from 'bun:test';

import { describeTurnRefusal, sendTurn, type TurnEvent } from '@/components/ki/turn-client';

// The turn route's answer ends with an `end` event (docs/features/ai-automations.md,
// "Model path"). A stream that closes without it broke off: the chat must say so,
// never treat the turn as answered (werk-flow/werkflow-planning#530).

const fetchSpy = spyOn(globalThis, 'fetch');

afterEach(() => {
  fetchSpy.mockReset();
});

function streamOf(events: readonly TurnEvent[]): Response {
  const body = events.map((event) => `${JSON.stringify(event)}\n`).join('');
  return new Response(body, { headers: { 'Content-Type': 'application/x-ndjson' } });
}

async function send(events: readonly TurnEvent[]) {
  fetchSpy.mockResolvedValue(streamOf(events));
  const received: TurnEvent[] = [];
  const outcome = await sendTurn({
    organizationId: '00000000-0000-4000-8000-0000000000a1',
    threadId: '00000000-0000-4000-8000-0000000000c1',
    commandId: '00000000-0000-4000-8000-0000000000d1',
    text: 'Wie viel Rohr?',
    signal: new AbortController().signal,
    onEvent: (event) => received.push(event),
  });
  return { outcome, received };
}

const STARTED: TurnEvent = {
  type: 'started',
  userItem: { id: 'u', sequence: 1 },
  assistantItem: { id: 'a', sequence: 2 },
};

test('a stream that closes before the message is saved is a failure the person reads', async () => {
  const { outcome } = await send([]);
  expect(outcome, 'a broken stream must not read as answered').toEqual({
    kind: 'refused',
    message: describeTurnRefusal('unavailable'),
  });
});

test('a stream that closes after the message is saved, without its end, is no answer', async () => {
  const { outcome, received } = await send([STARTED, { type: 'text', delta: 'Zwei Meter.' }]);
  expect(received.map((event) => event.type)).toEqual(['started', 'text']);
  expect(outcome.kind, 'a broken stream must not read as answered').not.toBe('answered');
});

test('a stream that ends with its end event is answered', async () => {
  const { outcome } = await send([STARTED, { type: 'end', status: 'complete' }]);
  expect(outcome).toEqual({ kind: 'answered' });
});

// A command the route answers `command_conflict` can never run (docs/features/ai-automations.md,
// "Retries and failures"): only a new command sends the message again. Every other refusal keeps it.
async function refusedWith(error: string) {
  fetchSpy.mockResolvedValue(Response.json({ error }, { status: 409 }));
  return sendTurn({
    organizationId: '00000000-0000-4000-8000-0000000000a1',
    threadId: '00000000-0000-4000-8000-0000000000c1',
    commandId: '00000000-0000-4000-8000-0000000000d1',
    text: 'Wie viel Rohr?',
    signal: new AbortController().signal,
    onEvent: () => undefined,
  });
}

test('a command conflict tells the chat to send the message as a new command', async () => {
  expect(await refusedWith('command_conflict')).toEqual({
    kind: 'refused',
    message: describeTurnRefusal('command_conflict'),
    spent: true,
  });
});

test('a refusal of a command that may still run keeps the command', async () => {
  const outcome = await refusedWith('run_active');
  expect(
    outcome.kind === 'refused' && outcome.spent,
    'a run_active refusal must keep its command',
  ).toBeFalsy();
});
