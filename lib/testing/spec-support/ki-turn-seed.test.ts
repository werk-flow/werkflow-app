import { expect, test } from 'bun:test';
import { unfinishedSeededRows } from '../../../tests/golden/support/db/ki';

// The KI row captures seed one finished turn through the harness's database calls
// (tests/golden/support/db/ki.ts). A repeat of the seed finds the turn already started; it may
// hand the thread to a capture only when an earlier attempt wrote every row the capture reads.

const command = 'c1';
const finished = [
  { idempotency_key: 'c1:user', kind: 'user_message', status: 'complete', body: { text: 'Müller?' } },
  { idempotency_key: 'c1:assistant', kind: 'assistant_message', status: 'complete', body: { text: 'Zwei.' } },
  { idempotency_key: 'c1:plan', kind: 'todo_list', status: 'complete', body: { revision: 3, steps: [] } },
  { idempotency_key: 'c1:tool:2', kind: 'tool_call', status: 'complete', body: { revision: 2 } },
  { idempotency_key: 'c1:tool:4', kind: 'question', status: 'complete', body: { revision: 1 } },
];

test('a repeated KI turn seed accepts only a thread that holds every row its capture reads', () => {
  expect(unfinishedSeededRows(finished, command)).toEqual([]);
  // The first attempt stopped after its first plan write: the answer is still being written.
  const stopped = [
    { idempotency_key: 'c1:user', kind: 'user_message', status: 'complete', body: { text: 'Müller?' } },
    { idempotency_key: 'c1:assistant', kind: 'assistant_message', status: 'streaming', body: { text: '' } },
    { idempotency_key: 'c1:plan', kind: 'todo_list', status: 'complete', body: { revision: 1, steps: [] } },
  ];
  expect(
    unfinishedSeededRows(stopped, command),
    'a part-way thread must fail the seed instead of reaching the capture',
  ).toEqual(['c1:plan', 'c1:tool:2', 'c1:assistant', 'c1:tool:4']);
});
