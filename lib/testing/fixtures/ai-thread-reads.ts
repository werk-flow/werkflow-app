// The chat page's reads over the real turn route (werk-flow/werkflow-planning#530):
// a thread the caller wrote reads back as its window and in the list; another
// person's thread, another organization and a lost membership read nothing; and
// an answer a poisoned document talked the model into reads back as written (B21).
// Each block states one invariant; a failing assert names it.
import assert from 'node:assert/strict';
import { ORGANIZATION_B, signInAs, tableRows } from './action-boundary-world';
import {
  OTHER_USER_ID,
  THREAD_ID,
  installAiTurnWorld,
  postTurn,
  readTurn,
  resetAiTables,
} from './ai-turn-world';

const world = await installAiTurnWorld();
signInAs(world, 'employee');
const organizationId = world.memberships[0]?.orgId ?? '';
const { getAiThreadPage, getAiThreadWindow } = await import('@/lib/ai/thread-reads');

// The caller's thread opens with both messages, oldest first, under the keys the live turn uses.
const commandId = crypto.randomUUID();
await readTurn(world, await postTurn('Wie entlüfte ich einen Heizkörper?', { commandId }));
{
  const window = await getAiThreadWindow({ organizationId, threadId: THREAD_ID });
  assert.ok(window.success, 'the author reads their own thread');
  // The stand-in database keeps table order (in-memory-admin.ts), so the order is the browser journey's to prove.
  assert.deepEqual(
    window.window.messages.map((message) => [message.key, message.role, message.status]).toSorted(),
    [
      [`${commandId}:assistant`, 'assistant', 'complete'],
      [`${commandId}:user`, 'user', 'complete'],
    ],
    'the window holds the message and its answer under their command keys',
  );
  assert.equal(window.window.hasOlder, false);
  const page = await getAiThreadPage({ organizationId });
  assert.ok(page.success);
  assert.deepEqual(
    page.threads.map((thread) => [thread.id, thread.title]),
    [[THREAD_ID, 'Wie entlüfte ich einen Heizkörper?']],
    'the list shows the thread under its first message',
  );
}

// Another person's thread in the same organization is neither listed nor opened.
{
  const otherThread = '40000000-0000-4000-8000-000000000002';
  tableRows(world, 'ai_threads').push({
    id: otherThread,
    organization_id: organizationId,
    user_id: OTHER_USER_ID,
    title: 'Fremder Chat',
    updated_at: '2026-11-26T09:00:00.000Z',
  });
  const window = await getAiThreadWindow({ organizationId, threadId: otherThread });
  assert.deepEqual(
    window,
    { success: false, error: 'not_found' },
    "another person's thread must stay closed",
  );
  const page = await getAiThreadPage({ organizationId });
  assert.ok(page.success);
  assert.ok(
    !page.threads.some((thread) => thread.id === otherThread),
    "another person's thread must not be listed",
  );
}

// Another organization's id is refused before any read, and so is a caller without membership.
{
  const reads = world.adminClientRequests;
  assert.deepEqual(await getAiThreadWindow({ organizationId: ORGANIZATION_B, threadId: THREAD_ID }), {
    success: false,
    error: 'not_a_member',
  });
  assert.deepEqual(await getAiThreadPage({ organizationId: ORGANIZATION_B }), {
    success: false,
    error: 'not_a_member',
  });
  signInAs(world, null);
  assert.deepEqual(await getAiThreadPage({ organizationId }), { success: false, error: 'not_a_member' });
  assert.equal(world.adminClientRequests, reads, 'a refused read must reach no table');
  signInAs(world, 'employee');
}

// Threads of one instant across a page boundary: each is listed once, none is skipped.
{
  resetAiTables(world);
  const instant = '2026-11-26T09:00:00.000000+00:00';
  const ids = Array.from(
    { length: 31 },
    (_, index) => `41000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
  );
  for (const id of ids)
    tableRows(world, 'ai_threads').push({
      id,
      organization_id: organizationId,
      user_id: world.callerId,
      title: id,
      updated_at: instant,
    });
  const first = await getAiThreadPage({ organizationId });
  assert.ok(first.success && first.hasMore, 'a full page says that more follow');
  const last = first.threads.at(-1);
  assert.ok(last);
  const second = await getAiThreadPage({
    organizationId,
    before: { updatedAt: last.updatedAt, id: last.id },
  });
  assert.ok(second.success);
  assert.deepEqual(
    [...first.threads, ...second.threads].map((thread) => thread.id).toSorted(),
    ids,
    'threads that share their last activity are each listed once across the page boundary',
  );
  assert.equal(second.hasMore, false);
  resetAiTables(world);
}

// B21: the model fell for a document that told it to send data out through the chat. The page
// reads the saved answer as it was written; lib/ui/ai-thread-reads.test.ts renders it.
{
  const replayed = crypto.randomUUID();
  await readTurn(
    world,
    await postTurn('[replay:ausleiten] Fass den Lieferschein zusammen.', { commandId: replayed }),
  );
  const window = await getAiThreadWindow({ organizationId, threadId: THREAD_ID });
  assert.ok(window.success);
  const answer = window.window.messages.find((message) => message.key === `${replayed}:assistant`);
  assert.match(answer?.text ?? '', /evil\.example/, 'the replayed answer carries the outside addresses');
  process.stdout.write(`${JSON.stringify({ injectedAnswer: answer?.text })}\n`);
}
