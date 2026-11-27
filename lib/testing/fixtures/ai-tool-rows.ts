// WerkFlow KI's tool rows (werk-flow/werkflow-planning#533), through the real turn route, harness,
// replay provider and thread reads: a tool call shows as a row while it runs and when it ends, its
// row and ledger row are written in one call, the thread opens without the row's result, and only
// the author opens it. A question ends the turn and the model reads it back next turn; a to-do list
// keeps one row. Each block states one invariant; a failing assert names it.
import assert from 'node:assert/strict';
import { ORGANIZATION_B, signInAs, tableRows } from './action-boundary-world';
import { OTHER_USER_ID, THREAD_ID, postTurn, resetAiTables, toolCallOutcomes } from './ai-turn-world';
import { installAiToolWorld } from './ai-tool-world';

const world = await installAiToolWorld();
const { getAiThreadWindow, getAiToolDetail } = await import('@/lib/ai/thread-reads');
const { z } = await import('@/lib/zod');

const lineSchema = z.object({ type: z.string(), row: z.unknown().optional() });

/** Posts a turn and returns its stream's lines once its run settled. */
async function turn(text: string, commandId = crypto.randomUUID()) {
  const response = await postTurn(text, { commandId });
  assert.equal(response.status, 200, `the turn must start: ${await response.clone().text()}`);
  const body = await response.text();
  await Promise.all(world.pending);
  return {
    commandId,
    events: body
      .split('\n')
      .filter(Boolean)
      .map((line) => lineSchema.parse(JSON.parse(line))),
  };
}

const items = () => tableRows(world, 'ai_thread_items');
const liveRows = () =>
  world.liveSends.flatMap((send) =>
    send.events.flatMap((event) => {
      const parsed = lineSchema.safeParse(event);
      return parsed.success && parsed.data.type === 'row' ? [parsed.data.row] : [];
    }),
  );
const organizationId = () => world.memberships[0]?.orgId ?? '';

// A tool call shows running and then done, on the caller's stream and the live channel; its row and its
// ledger row land together, and the thread opens with the row's summary but without its result.
{
  resetAiTables(world);
  signInAs(world, 'buero');
  const { commandId, events } = await turn(
    `[replay:werkzeug] ${JSON.stringify({ name: 'kunden_finden', input: { suche: 'Müller' } })}`,
  );
  const key = `${commandId}:tool:1`;
  const streamed = events.flatMap((event) => (event.type === 'row' ? [event.row] : []));
  assert.deepEqual(
    streamed.map((row) => z.object({ key: z.string(), status: z.string() }).parse(row)),
    [
      { key, status: 'streaming' },
      { key, status: 'complete' },
    ],
    'the caller sees the row while the tool runs and when it ended',
  );
  assert.deepEqual(liveRows(), streamed, "the author's other tabs see the same rows");
  const row = items().find((item) => item.idempotency_key === key);
  assert.equal(row?.kind, 'tool_call');
  assert.equal(row?.status, 'complete');
  assert.deepEqual(toolCallOutcomes(world), ['tool_call_kunden_finden_ok'], 'the call has its ledger row');
  const window = await getAiThreadWindow({ organizationId: organizationId(), threadId: THREAD_ID });
  assert.ok(window.success);
  const shown = window.window.messages.find((entry) => entry.key === key);
  assert.deepEqual(
    shown && { role: shown.role, status: shown.status },
    { role: 'tool', status: 'complete' },
    'the thread shows the tool row',
  );
  assert.equal(
    JSON.stringify(window.window).includes('Müller Haustechnik'),
    false,
    'the thread opens without the tool result (brief non-negotiable 5)',
  );
  const detail = await getAiToolDetail({ organizationId: organizationId(), threadId: THREAD_ID, key });
  assert.ok(detail.success, 'the author opens the row');
  assert.deepEqual(detail.detail.input, { suche: 'Müller' });
  assert.equal(JSON.stringify(detail.detail.result).includes('Müller Haustechnik'), true);

  // Another person and another organization open nothing.
  const thread = tableRows(world, 'ai_threads').find((entry) => entry.id === THREAD_ID);
  if (thread) thread.user_id = OTHER_USER_ID;
  assert.deepEqual(
    await getAiToolDetail({ organizationId: organizationId(), threadId: THREAD_ID, key }),
    { success: false, error: 'not_found' },
    "another person's tool row must stay closed",
  );
  assert.deepEqual(
    await getAiToolDetail({ organizationId: ORGANIZATION_B, threadId: THREAD_ID, key }),
    { success: false, error: 'not_a_member' },
    "another organization's id is refused before any read",
  );
}

// A question ends the turn without another model step; the next turn's model reads it back.
{
  resetAiTables(world);
  signInAs(world, 'employee');
  const { commandId } = await turn('[replay:frage] Was steht bei Müller an?');
  assert.equal(world.streamRequests.length, 1, 'the turn ends at the question');
  const asked = items().find((item) => item.kind === 'question');
  assert.deepEqual(
    asked && { key: asked.idempotency_key, body: asked.body },
    {
      key: `${commandId}:tool:1`,
      body: {
        revision: 1,
        question: 'Welchen Kunden meinst du?',
        options: ['Müller Haustechnik', 'Müller Bau'],
      },
    },
    'the question is a row of the thread',
  );
  await turn('[replay:echo] Müller Bau');
  const prompt = JSON.stringify(world.streamRequests.at(-1)?.prompt);
  assert.equal(
    prompt.includes('Welchen Kunden meinst du?\\n- Müller Haustechnik\\n- Müller Bau'),
    true,
    'the model reads its question and the answers it offered',
  );
}

// The to-do list keeps one row, which each call replaces with its ticked steps.
{
  resetAiTables(world);
  signInAs(world, 'admin');
  const { commandId } = await turn('[replay:plan] Prüf die offenen Heizungsaufträge.');
  const lists = items().filter((item) => item.kind === 'todo_list');
  assert.equal(lists.length, 1, 'a turn keeps one to-do list');
  assert.deepEqual(
    lists[0]?.body,
    {
      revision: 2,
      steps: [
        { text: 'Aufträge suchen', done: true },
        { text: 'Antwort schreiben', done: false },
      ],
    },
    'the list shows the latest call',
  );
  assert.equal(lists[0]?.idempotency_key, `${commandId}:plan`);
  assert.deepEqual(toolCallOutcomes(world), ['tool_call_plan_zeigen_ok', 'tool_call_plan_zeigen_ok']);
}

// Injection case (B21): a record talked the model into a question whose text and answers carry links
// and images to an outside host. The row stores them as text; the renderer must show them inert.
{
  resetAiTables(world);
  signInAs(world, 'buero');
  await turn('[replay:frage-falle] Was soll ich tun?');
  const asked = items().find((item) => item.kind === 'question');
  assert.ok(asked, 'the injected question is a row');
  process.stdout.write(`${JSON.stringify({ injectedQuestion: asked.body })}\n`);
}
