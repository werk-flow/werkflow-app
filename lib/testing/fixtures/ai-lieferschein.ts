// „Lieferschein lesen“ through the real turn route, harness, quarantined
// extractor and replay provider (werk-flow/werkflow-planning#535, B9, B13 to
// B15 of werk-flow/werkflow-planning#20). The files are synthetic and stored
// in the in-memory bucket. Each block states one invariant; a failing assert names it.
import assert from 'node:assert/strict';
import { mock } from 'bun:test';
import { installInMemoryBucket } from './in-memory-bucket';
import { AI_MODEL_PRICE, costMicroUsd } from '@/lib/ai/cost';
import { AI_EXTRACT_LIMITS, maxTurnCostMicroUsd } from '@/lib/ai/limits';
import { CALLER_ID, ORGANIZATION_A, signInAs, tableRows } from './action-boundary-world';
import {
  THREAD_ID,
  appendItem,
  postTurn,
  readTurn,
  resetAiTables,
  stopAnswer,
  toolCallOutcomes,
} from './ai-turn-world';
import { installAiToolWorld, toolResults } from './ai-tool-world';
import {
  attachFile,
  chatRequests,
  extractionRequests,
  lieferscheinPdf,
  lieferscheinPhoto,
} from './lieferscheine';

const bucket = installInMemoryBucket();
const world = await installAiToolWorld();
const registry = await import('@/lib/ai/tools/registry');
const { defineTool } = await import('@/lib/ai/tools/define-tool');
const { LIEFERSCHEIN_EXTRACTION } = await import('@/lib/ai/extract/lieferschein');
const { TOOL_RESULTS_FULL } = await import('@/lib/ai/tools/tool-calls');
const { z } = await import('@/lib/zod');

// A planted read tool with a large result, for the cap on all tool results of one turn.
const grossLesen = defineTool({
  name: 'gross_lesen',
  label: 'Groß lesen',
  description: 'Liest viel.',
  input: z.strictObject({}),
  roles: ['admin', 'buero'],
  control: 'read',
  audit: 'ledger',
  idempotency: 'not_needed',
  dataClasses: ['work'],
  writesMemory: false,
  async execute() {
    return { status: 'ok', value: { daten: 'x'.repeat(20_000) } };
  },
});
// A planted read tool whose first result fills the cap's room and whose later calls refuse with a long sentence.
let knappCalls = 0;
const knappLesen = defineTool({
  name: 'knapp_lesen',
  label: 'Knapp lesen',
  description: 'Liest fast alles.',
  input: z.strictObject({}),
  roles: ['admin', 'buero'],
  control: 'read',
  audit: 'ledger',
  idempotency: 'not_needed',
  dataClasses: ['work'],
  writesMemory: false,
  async execute() {
    knappCalls += 1;
    // Exactly the bytes a result may take, 1,000 short of the cap.
    if (knappCalls === 1) return { status: 'ok', value: { daten: 'x'.repeat(30_988) } };
    return { status: 'refused', message: 'Nein. '.repeat(150) };
  },
});
const { AI_TOOLS, aiToolsFor } = registry;
mock.module('@/lib/ai/tools/registry', () => ({
  AI_TOOLS: [...AI_TOOLS, grossLesen, knappLesen],
  aiToolsFor: (role: Parameters<typeof aiToolsFor>[0]) => [...aiToolsFor(role), grossLesen, knappLesen],
}));

const PDF = 'application/pdf';
const READ = JSON.stringify({ name: 'lieferschein_lesen', input: { datei: 1 } });
const modelCallRows = () =>
  tableRows(world, 'ai_run_attempts').filter((row) => String(row.p_idempotency_key).includes(':model-call:'));
/** What the model read from each tool call, in order. */
const readOutputs = () =>
  chatRequests(world)
    .flatMap((request) => toolResults(request))
    .slice(-3);
const lastOutput = () => JSON.stringify(toolResults(chatRequests(world).at(-1)).at(-1)?.output);
const answerItem = () => tableRows(world, 'ai_thread_items').find((row) => row.kind === 'assistant_message');

/** Posts one turn of `transcript` after attaching `file` to the caller's thread as `role`. */
async function readWith(
  file: Parameters<typeof attachFile>[2],
  transcript = 'werkzeug',
  role: 'admin' | 'buero' = 'buero',
  /** What lands while the turn runs, set after the reset. */
  meanwhile: () => void = () => undefined,
) {
  resetAiTables(world);
  signInAs(world, role);
  world.tables.ai_thread_files = [];
  world.rpcCalls.length = 0;
  attachFile(world, bucket, file);
  meanwhile();
  return readTurn(world, await postTurn(`[replay:${transcript}] ${READ}`));
}

// A clean PDF: the extractor's own request carries the document and the fixed request, no tool, no
// chat prompt and no word of the person; the model reads only the capped fields, labelled as document
// text, and the call is ledgered at its usage under the extractor's version before the run settles.
{
  const events = await readWith({ body: lieferscheinPdf('sauber'), mimeType: PDF, pages: 1 });
  assert.deepEqual(events.at(-1), { type: 'end', status: 'complete' });
  const [extraction, ...more] = extractionRequests(world);
  assert.ok(extraction && more.length === 0, 'the read must call the extractor once');
  assert.equal(extraction.tools, undefined, 'the extractor’s request must carry no tools (B9)');
  assert.equal(extraction.responseFormat?.type, 'json', 'the extractor answers in its schema');
  assert.deepEqual(
    extraction.prompt.map((message) =>
      message.role === 'system'
        ? message.content
        : message.content.map((part) => (part.type === 'text' ? part.text : part.type)),
    ),
    [LIEFERSCHEIN_EXTRACTION.instructions, ['file', LIEFERSCHEIN_EXTRACTION.request]],
    'the extractor reads its own instructions, the document and its fixed request, nothing of the chat',
  );
  const [read] = readOutputs();
  const output = JSON.stringify(read?.output);
  assert.equal(read?.tool, 'lieferschein_lesen');
  for (const field of ['GC Großhandel Stuttgart', 'LS-2026-1187', 'Kupferrohr 15 x 1 mm, Stange 5 m']) {
    assert.ok(
      output.includes(JSON.stringify({ source: 'document', text: field })),
      `${field} must reach the model labelled as document text`,
    );
  }
  assert.ok(output.includes('"datum":"2026-11-20"') && output.includes('KI-Entwurf'));
  assert.deepEqual(toolCallOutcomes(world), ['tool_call_lieferschein_lesen_ok']);
  const [row] = modelCallRows();
  assert.equal(row?.p_outcome, 'extract_completed');
  assert.equal(row?.p_prompt_version, LIEFERSCHEIN_EXTRACTION.promptVersion);
  assert.equal(
    row?.p_cost_micro_usd,
    costMicroUsd(
      { inputTokens: 2200, cacheReadTokens: 200, cacheWriteTokens: 0, outputTokens: 300 },
      AI_MODEL_PRICE,
    ),
    'the extraction is ledgered at the usage the provider reported',
  );
  const order = world.rpcCalls.map((call) =>
    call.name === 'record_ai_run_attempt' && String(call.args.p_idempotency_key).includes(':model-call:')
      ? 'extraction'
      : call.name,
  );
  assert.ok(order.indexOf('extraction') < order.indexOf('settle_ai_run'), 'the extraction is ledgered first');
  assert.equal(
    tableRows(world, 'ai_runs')[0]?.reserved_micro_usd,
    maxTurnCostMicroUsd('chat'),
    'the run reserves its extractions at their caps',
  );
}

// A phone photo goes to the extractor as an image, for the admin too.
{
  const events = await readWith(
    { body: lieferscheinPhoto('sauber'), mimeType: 'image/jpeg' },
    'werkzeug',
    'admin',
  );
  assert.deepEqual(events.at(-1), { type: 'end', status: 'complete' });
  const [extraction] = extractionRequests(world);
  const file = extraction?.prompt.flatMap((message) =>
    message.role === 'user' ? message.content.filter((part) => part.type === 'file') : [],
  );
  assert.deepEqual(
    file?.map((part) => part.mediaType),
    ['image/jpeg'],
  );
  assert.deepEqual(toolCallOutcomes(world), ['tool_call_lieferschein_lesen_ok']);
}

// A PDF that declares one page and holds 25: the stored count is not trusted, the provider's token
// count is past the extractor's input cap, and nothing reaches a paid call (B13).
{
  await readWith({
    body: lieferscheinPdf('sauber', { pages: 25, declaredPages: 1 }),
    mimeType: PDF,
    pages: 1,
  });
  assert.equal(extractionRequests(world).length, 0, 'a document past the cap must never reach the model');
  assert.deepEqual(modelCallRows(), [], 'a refused read costs nothing');
  assert.deepEqual(toolCallOutcomes(world), ['tool_call_lieferschein_lesen_refused']);
  assert.match(lastOutput(), /"status":"refused","meldung":"Die Datei ist zu lang zum Lesen/);
}

// The lines past the cap are counted for the model, never dropped silently.
{
  await readWith({ body: lieferscheinPdf('lang'), mimeType: PDF, pages: 1 });
  const value = z
    .object({ value: z.object({ positionen: z.array(z.unknown()), weggelassenePositionen: z.number() }) })
    .parse(readOutputs()[0]?.output).value;
  assert.equal(value.positionen.length, AI_EXTRACT_LIMITS.maxLines);
  assert.equal(value.weggelassenePositionen, 60 - AI_EXTRACT_LIMITS.maxLines);
}

// An answer that is no Lieferschein reads as nothing, and the call is still ledgered.
{
  await readWith({ body: lieferscheinPdf('kaputt'), mimeType: PDF, pages: 1 });
  assert.match(lastOutput(), /"meldung":"Aus der Datei ließ sich kein Lieferschein lesen/);
  assert.deepEqual(
    modelCallRows().map((row) => row.p_outcome),
    ['extract_completed'],
  );
}

// An answer cut at the output cap reads as too long, and its call is ledgered at what it used.
{
  await readWith({ body: lieferscheinPdf('abgeschnitten'), mimeType: PDF, pages: 1 });
  assert.match(lastOutput(), /"meldung":"Die Datei ist zu lang zum Lesen/);
  assert.deepEqual(
    modelCallRows().map((row) => [row.p_outcome, row.p_output_tokens]),
    [['extract_completed', AI_EXTRACT_LIMITS.maxOutputTokens]],
  );
}

// A stop that lands while the tool reads the file, before its paid call: the turn's gate is read
// again at the call's admission, so no extraction starts and nothing is charged for one.
{
  const answer = world.rpc;
  world.rpc = (call) => {
    const item = answerItem();
    if (call.name === 'record_ai_tool_item' && call.args.p_status === 'streaming' && item) stopAnswer(item);
    return answer(call);
  };
  const events = await readWith({ body: lieferscheinPdf('sauber'), mimeType: PDF, pages: 1 });
  world.rpc = answer;
  assert.equal(extractionRequests(world).length, 0, 'a stopped turn must start no paid extraction');
  assert.deepEqual(modelCallRows(), []);
  assert.equal(events.at(-1)?.failure, 'stopped');
  assert.deepEqual(toolCallOutcomes(world), ['tool_call_lieferschein_lesen_failed']);
}

// A member suspended while the tool reads the file sends nothing to the provider, not even to its
// free token count; one lowered to employee while the document is counted starts no paid call.
{
  const get = bucket.get.bind(bucket);
  bucket.get = (key) => {
    world.memberships = [{ orgId: ORGANIZATION_A, role: 'buero', accessState: 'suspended' }];
    return get(key);
  };
  await readWith({ body: lieferscheinPdf('sauber'), mimeType: PDF, pages: 1 });
  bucket.get = get;
  assert.equal(world.documentCounts, 0, 'a suspended member’s document must never reach the token count');
  assert.equal(extractionRequests(world).length, 0);
  await readWith({ body: lieferscheinPdf('sauber'), mimeType: PDF, pages: 1 }, 'werkzeug', 'buero', () => {
    world.onDocumentCount = () => {
      world.memberships = [{ orgId: ORGANIZATION_A, role: 'employee' }];
    };
  });
  assert.equal(world.documentCounts, 1);
  assert.equal(
    extractionRequests(world).length,
    0,
    'a member lowered to employee must start no paid extraction',
  );
  assert.deepEqual(modelCallRows(), []);
}

// A file another tab attached after this turn's message, such as with a message refused while this
// turn ran, is never this turn's: the tool reads the latest file before the turn's message.
{
  const answer = world.rpc;
  world.rpc = (call) => {
    if (call.name === 'record_ai_tool_item' && call.args.p_status === 'streaming')
      attachFile(world, bucket, { body: lieferscheinPdf('kaputt'), mimeType: PDF, pages: 1 });
    return answer(call);
  };
  await readWith({ body: lieferscheinPdf('sauber'), mimeType: PDF, pages: 1 });
  world.rpc = answer;
  assert.equal(
    tableRows(world, 'ai_thread_files').length,
    2,
    'the later file was attached while the turn ran',
  );
  assert.match(lastOutput(), /LS-2026-1187/, 'the turn must read the file of its own message');
}

// Three reads in one step: the turn's model-call cap refuses the third before it calls the model.
{
  await readWith({ body: lieferscheinPdf('sauber'), mimeType: PDF, pages: 1 }, 'drei-lieferscheine');
  assert.deepEqual(toolCallOutcomes(world), [
    'tool_call_lieferschein_lesen_ok',
    'tool_call_lieferschein_lesen_ok',
    'tool_call_lieferschein_lesen_refused',
  ]);
  assert.equal(extractionRequests(world).length, 2);
  assert.equal(new Set(modelCallRows().map((row) => row.p_idempotency_key)).size, 2, 'each call has its key');
  assert.match(lastOutput(), /höchstens 2 Dateien/);
}

// „Antwort anhalten“ while the extractor writes: the next partial save of the waiting turn refuses,
// which aborts the extractor's provider request; its call is ledgered at its caps before the run
// settles, and the turn ends as stopped.
{
  const answer = world.rpc;
  let rowsAtSettlement: number | null = null;
  world.rpc = (call) => {
    const item = answerItem();
    // The extraction's ledger row lands only after every pending piece of work of the turn ran:
    // a turn that did not wait for it would have settled by then.
    if (call.name === 'record_ai_run_attempt' && String(call.args.p_idempotency_key).includes(':model-call:'))
      return new Promise((resolve) => setImmediate(() => resolve(answer(call))));
    if (call.name === 'settle_ai_run') rowsAtSettlement = modelCallRows().length;
    if (
      call.name === 'update_ai_thread_item' &&
      call.args.p_status === 'streaming' &&
      extractionRequests(world).length > 0 &&
      item?.status === 'streaming'
    )
      stopAnswer(item);
    return answer(call);
  };
  const events = await readWith({ body: lieferscheinPdf('langsam'), mimeType: PDF, pages: 1 });
  world.rpc = answer;
  const index = world.streamRequests.findIndex((request) => extractionRequests(world).includes(request));
  assert.equal(world.streamSignals[index]?.aborted, true, 'a stop must abort the extractor’s request');
  assert.equal(events.at(-1)?.failure, 'stopped');
  assert.deepEqual(toolCallOutcomes(world), ['tool_call_lieferschein_lesen_failed']);
  const [row] = modelCallRows();
  assert.equal(row?.p_outcome, 'extract_stopped');
  assert.ok(
    Number(row?.p_cost_micro_usd) >=
      costMicroUsd(
        {
          inputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          outputTokens: AI_EXTRACT_LIMITS.maxOutputTokens,
        },
        AI_MODEL_PRICE,
      ),
    'a stopped extraction is charged at its caps',
  );
  assert.equal(rowsAtSettlement, 1, 'the run settles only after the stopped extraction is ledgered');
  assert.deepEqual(
    tableRows(world, 'ai_runs').map((run) => run.status),
    ['cancelled'],
  );
  assert.equal(chatRequests(world).length, 1, 'a stopped turn starts no further step');
}

// The tool results of one turn share one cap, and a long thread leaves their room: with the history
// at the input cap, two large results still fit the next steps, the call past the cap reads the
// refusal's sentence, and a later one only its status.
{
  resetAiTables(world);
  signInAs(world, 'buero');
  const call = JSON.stringify({ name: 'gross_lesen', input: {} });
  // Earlier messages that alone fill the input cap.
  for (let index = 0; index < 20; index += 1)
    appendItem(
      world,
      { p_thread_id: THREAD_ID, p_organization_id: ORGANIZATION_A },
      index % 2 === 0 ? 'user_message' : 'assistant_message',
      'complete',
      { text: 'Rohr '.repeat(600) },
      `history:${index}`,
    );
  world.tables.ai_threads = [
    { id: THREAD_ID, organization_id: ORGANIZATION_A, user_id: CALLER_ID, title: 'Lang' },
  ];
  const events = await readTurn(world, await postTurn(`[replay:dreimal] ${call}`));
  assert.deepEqual(
    events.at(-1),
    { type: 'end', status: 'complete' },
    'the turn must finish within its input cap',
  );
  assert.deepEqual(toolCallOutcomes(world), [
    'tool_call_gross_lesen_ok',
    'tool_call_gross_lesen_refused',
    'tool_call_gross_lesen_refused',
  ]);
  const outputs = toolResults(chatRequests(world).at(-1)).map((result) => result.output);
  assert.deepEqual(outputs.slice(-2), [
    { type: 'json', value: { status: 'refused', meldung: TOOL_RESULTS_FULL } },
    { type: 'json', value: { status: 'refused' } },
  ]);
}

// Every output counts against the cap, a refusal's sentence too: one that does not fit reads as the
// bare status, and once even that would not fit, the turn ends before another step.
{
  resetAiTables(world);
  signInAs(world, 'buero');
  const call = JSON.stringify({ name: 'knapp_lesen', input: {} });
  const events = await readTurn(world, await postTurn(`[replay:sechsmal] ${call}`));
  assert.equal(events.at(-1)?.failure, 'input_too_large');
  assert.equal(chatRequests(world).length, 1, 'no step may start with the results past their cap');
  assert.equal(toolCallOutcomes(world).length, 6, 'every call is ledgered');
}
