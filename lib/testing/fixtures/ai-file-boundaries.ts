// WerkFlow KI files over their real actions, reader and turn route
// (werk-flow/werkflow-planning#534). The upload signs only the caller's own
// staging key; the finalize registers only what the caller's own session
// staged, refuses a PDF over its declared page cap or a file whose bytes are
// not of its type and discards its copy; another person's and another
// organization's file is never opened; and a message attaches files only as the session's own
// person, in the session's organization, into their own thread. The database
// functions answer as their SQL does (supabase/tests/ai_thread_files.sql
// proves the SQL). Each block states one invariant; a failing assert names it.
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { CALLER_ID, ORGANIZATION_A, ORGANIZATION_B, signInAs, tableRows } from './action-boundary-world';
import { z } from '@/lib/zod';
import { OTHER_USER_ID, appendItem, installAiTurnWorld, postTurn } from './ai-turn-world';
import { installInMemoryBucket } from './in-memory-bucket';

type Row = Record<string, unknown>;

const startedSchema = z.object({
  type: z.literal('started'),
  userItem: z.object({ sequence: z.number() }),
  files: z.array(z.object({ fileId: z.string(), sequence: z.number() })),
});

const writes: string[] = [];
const bucket = installInMemoryBucket(writes);
const world = await installAiTurnWorld();
signInAs(world, 'employee');
world.tables.ai_thread_files = [];
const files = (): Row[] => tableRows(world, 'ai_thread_files');
const raise = (message: string) => ({ data: null, error: { message, code: 'P0001' } });

// The three file functions over the stand-in rows; everything else answers as the turn world does.
const turnRpc = world.rpc;
world.rpc = (call) => {
  const args = call.args;
  if (call.name === 'register_ai_thread_file') {
    if (files().some((file) => file.id === args.p_file_id)) return raise('already_finalized');
    files().push({
      id: args.p_file_id,
      organization_id: args.p_organization_id,
      user_id: args.p_user_id,
      item_id: null,
      storage_path: args.p_storage_path,
      file_name: args.p_file_name,
      mime_type: args.p_mime_type,
      size_bytes: args.p_size_bytes,
      page_count: args.p_page_count,
    });
    return { data: null, error: null };
  }
  if (call.name === 'discard_ai_thread_file') {
    const index = files().findIndex(
      (file) =>
        file.id === args.p_file_id &&
        file.organization_id === args.p_organization_id &&
        file.user_id === args.p_user_id &&
        file.item_id === null,
    );
    if (index >= 0) files().splice(index, 1);
    return { data: null, error: null };
  }
  if (call.name === 'start_ai_turn_with_files') {
    // One transaction, as the SQL function: a refusal leaves nothing behind.
    const thread = tableRows(world, 'ai_threads').find((row) => row.id === args.p_thread_id);
    if (thread && (thread.user_id !== args.p_user_id || thread.organization_id !== args.p_organization_id))
      return raise('ai_thread_not_found');
    const ids = Array.isArray(args.p_file_ids) ? args.p_file_ids : [];
    const own = files().filter(
      (file) =>
        ids.includes(file.id) &&
        file.organization_id === args.p_organization_id &&
        file.user_id === args.p_user_id &&
        file.item_id === null,
    );
    if (own.length !== ids.length) return raise('ai_file_not_found');
    if (!thread)
      tableRows(world, 'ai_threads').push({
        id: args.p_thread_id,
        organization_id: args.p_organization_id,
        user_id: args.p_user_id,
        title: args.p_title,
      });
    const attached = own.map((file) => {
      const item = appendItem(
        world,
        args,
        'file',
        'complete',
        { fileId: file.id, name: file.file_name, origin: 'upload' },
        `${String(args.p_command_id)}:file:${String(file.id)}`,
      );
      file.item_id = item.id;
      return { fileId: file.id, sequence: item.sequence };
    });
    const started = turnRpc({ name: 'start_ai_turn', args });
    if (started instanceof Promise || !Array.isArray(started.data)) return started;
    return { data: started.data.map((row) => Object.assign({}, row, { files: attached })), error: null };
  }
  return turnRpc(call);
};

const { createAiFileUploadTicket, discardAiFile, finalizeAiFileUpload } = await import(
  '@/lib/ai/files/actions'
);
const { getAiFileUrl } = await import('@/lib/ai/files/thread-files');

/** A PDF of `pages` empty pages, kept to ASCII so the in-memory bucket stores it byte for byte. */
async function pdfBody(pages: number): Promise<string> {
  const pdf = await PDFDocument.create();
  for (let page = 0; page < pages; page += 1) pdf.addPage();
  const body = Buffer.from(await pdf.save({ useObjectStreams: false })).toString('latin1');
  // The binary comment line keeps its length, so every offset stays right.
  const ascii = body.replace(/^(%PDF-[\d.]+\n%)[^\n]+/, (line, head: string) =>
    head.padEnd(line.length, 'A'),
  );
  assert.ok(/^[\x00-\x7f]*$/.test(ascii), 'the test PDF must be ASCII');
  return ascii;
}

/** The leading bytes of a WebP image, ASCII so the in-memory bucket stores them byte for byte. */
const WEBP_BODY = 'RIFF\0\0\0\0WEBPVP8 ';

/** Signs, stages the body as the browser's PUT would, and finalizes it. */
async function upload(body: string, mimeType: string, fileName: string, organizationId = ORGANIZATION_A) {
  const ticket = await createAiFileUploadTicket({
    organizationId,
    mimeType,
    fileSizeBytes: Buffer.byteLength(body),
  });
  assert.ok(ticket.success, `the ticket was refused: ${ticket.success ? '' : ticket.error}`);
  const signed = new URL(ticket.uploadUrl);
  assert.equal(
    signed.searchParams.get('X-Amz-SignedHeaders'),
    'content-length;content-type;host',
    'the signed PUT pins the checked size and type',
  );
  const key = decodeURIComponent(signed.pathname).replace('/synthetic-bucket/', '');
  bucket.set(key, { body, contentType: mimeType });
  return {
    key,
    fileId: ticket.fileId,
    result: await finalizeAiFileUpload({ organizationId, fileId: ticket.fileId, fileName }),
  };
}

// The ticket signs a PUT to the caller's own staging folder, never a key a row references.
const twoPages = await upload(await pdfBody(2), 'application/pdf', 'Lieferschein 4711.pdf');
assert.match(
  twoPages.key,
  new RegExp(`^${ORGANIZATION_A}/staging/ki/${CALLER_ID}/${twoPages.fileId}/datei$`),
  'the signed PUT must name the staging key under the caller and the file',
);
assert.deepEqual(
  twoPages.result,
  {
    success: true,
    file: {
      fileId: twoPages.fileId,
      name: 'Lieferschein 4711.pdf',
      mimeType: 'application/pdf',
      sizeBytes: Buffer.byteLength(await pdfBody(2)),
      pages: 2,
    },
  },
  'a PDF within the caps registers with its counted pages',
);
const registered = files().find((file) => file.id === twoPages.fileId);
assert.ok(
  String(registered?.storage_path).startsWith(`${ORGANIZATION_A}/ki/${CALLER_ID}/${twoPages.fileId}/`),
  'the registered copy lies under the caller and the file',
);
assert.ok(!bucket.has(twoPages.key), 'the finalize removes the staging object');

// A retry whose answer got lost finds its registration; it copies nothing again.
{
  const before = writes.length;
  const again = await finalizeAiFileUpload({
    organizationId: ORGANIZATION_A,
    fileId: twoPages.fileId,
    fileName: 'Lieferschein 4711.pdf',
  });
  assert.ok(again.success && again.file.pages === 2, 'a repeated finalize answers with the registered file');
  assert.equal(writes.length, before, 'a repeated finalize must not touch storage');
}

// A PDF over the page cap, a "PDF" without the PDF header and an image whose bytes are no image
// are refused, and their copies discarded.
for (const [body, mimeType, error] of [
  [await pdfBody(21), 'application/pdf', 'file_too_many_pages'],
  ['kein PDF', 'application/pdf', 'file_unreadable'],
  ['<html><img src=x></html>', 'image/png', 'file_unreadable'],
] as const) {
  const objects = bucket.size;
  const refused = await upload(body, mimeType, 'abgelehnt');
  assert.deepEqual(refused.result, { success: false, error }, `the finalize must refuse with ${error}`);
  assert.equal(bucket.size, objects, `a ${error} copy must not stay in storage`);
  assert.ok(!files().some((file) => file.id === refused.fileId), `a ${error} file must not register`);
}

// A PDF whose page tree the counter cannot follow is stored with its pages unknown: the page cap is
// advisory, and the size cap bounds what is stored.
{
  const unknown = await upload('%PDF-1.7 ohne Seitenbaum', 'application/pdf', 'Scan.pdf');
  assert.ok(
    unknown.result.success && unknown.result.file.pages === null,
    'a PDF whose pages cannot be counted must register with its pages unknown',
  );
  assert.equal(files().find((file) => file.id === unknown.fileId)?.page_count, null);
}

// The ticket refuses a type or a size outside the caps before it signs anything.
for (const [mimeType, size, error] of [
  ['image/heic', 1000, 'file_type_not_allowed'],
  ['application/pdf', 10 * 1024 * 1024 + 1, 'file_too_large'],
] as const) {
  assert.deepEqual(
    await createAiFileUploadTicket({ organizationId: ORGANIZATION_A, mimeType, fileSizeBytes: size }),
    { success: false, error },
    `a ${mimeType} of ${size} bytes must be refused as ${error}`,
  );
}

// Another organization's id is refused before any key is signed or read.
{
  const reads = world.adminClientRequests;
  assert.deepEqual(
    await createAiFileUploadTicket({
      organizationId: ORGANIZATION_B,
      mimeType: 'image/jpeg',
      fileSizeBytes: 10,
    }),
    { success: false, error: 'not_a_member' },
  );
  assert.deepEqual(
    await finalizeAiFileUpload({
      organizationId: ORGANIZATION_B,
      fileId: twoPages.fileId,
      fileName: 'x.pdf',
    }),
    { success: false, error: 'not_a_member' },
  );
  assert.deepEqual(await getAiFileUrl({ organizationId: ORGANIZATION_B, fileId: twoPages.fileId }), {
    success: false,
    error: 'not_a_member',
  });
  assert.deepEqual(await discardAiFile({ organizationId: ORGANIZATION_B, fileId: twoPages.fileId }), {
    success: false,
    error: 'not_a_member',
  });
  assert.equal(world.adminClientRequests, reads, 'a foreign organization must reach no table');
}

// A member of another organization who stages bytes under this file id finalizes nothing of it:
// their session recomputes a key under their own organization and finds nothing there.
{
  signInAs(world, 'employee', ORGANIZATION_B);
  const stranger = crypto.randomUUID();
  bucket.set(`${ORGANIZATION_A}/staging/ki/${CALLER_ID}/${stranger}/datei`, {
    body: 'fremd',
    contentType: 'image/jpeg',
  });
  assert.deepEqual(
    await finalizeAiFileUpload({ organizationId: ORGANIZATION_B, fileId: stranger, fileName: 'x.jpg' }),
    { success: false, error: 'file_missing' },
    "a foreign session must not finalize another organization's staged bytes",
  );
  signInAs(world, 'employee');
}

// Another person's file in the same organization never opens, not even by its id.
{
  const foreign = crypto.randomUUID();
  files().push({
    id: foreign,
    organization_id: ORGANIZATION_A,
    user_id: OTHER_USER_ID,
    item_id: 'item-x',
    storage_path: `${ORGANIZATION_A}/ki/${OTHER_USER_ID}/${foreign}/a-datei`,
    file_name: 'fremd.pdf',
  });
  assert.deepEqual(
    await getAiFileUrl({ organizationId: ORGANIZATION_A, fileId: foreign }),
    { success: false, error: 'not_found' },
    "another person's file must stay closed",
  );
  // A discard runs as the session's person, so it removes nothing of another person's.
  await discardAiFile({ organizationId: ORGANIZATION_A, fileId: foreign });
  assert.equal(world.rpcCalls.at(-1)?.args.p_user_id, CALLER_ID, 'the discard names the session person');
  assert.ok(
    files().some((file) => file.id === foreign),
    "a discard must leave another person's file",
  );
}

// A message attaches its files as the session's person, in the session's organization, before its own item.
{
  const commandId = crypto.randomUUID();
  const body = await (
    await postTurn('Lies den Lieferschein.', { commandId, fileIds: [twoPages.fileId] })
  ).text();
  await Promise.all(world.pending);
  const attach = world.rpcCalls.find((call) => call.name === 'start_ai_turn_with_files');
  assert.equal(attach?.args.p_user_id, CALLER_ID, 'the turn names the session person');
  assert.equal(attach?.args.p_organization_id, ORGANIZATION_A, "the turn names the session's organization");
  const started = startedSchema.parse(JSON.parse(body.split('\n')[0] ?? ''));
  assert.deepEqual(
    started.files,
    [{ fileId: twoPages.fileId, sequence: 1 }],
    'the started event names the file item before the message',
  );
  assert.equal(started.userItem.sequence, 2, "the message follows its file in the thread's sequence");
  const opened = await getAiFileUrl({ organizationId: ORGANIZATION_A, fileId: twoPages.fileId });
  assert.ok(opened.success, 'the author opens their attached file');
  const signed = new URL(opened.url);
  assert.ok(
    signed.pathname.includes(`/${ORGANIZATION_A}/ki/${CALLER_ID}/`),
    'the URL signs the registered copy',
  );
  assert.ok(Number(signed.searchParams.get('X-Amz-Expires')) <= 600, 'the URL lives at most ten minutes');
}

// Another organization's file id and another person's thread are refused at the route, writing nothing.
{
  const foreignFile = crypto.randomUUID();
  files().push({
    id: foreignFile,
    organization_id: ORGANIZATION_B,
    user_id: CALLER_ID,
    item_id: null,
    storage_path: `${ORGANIZATION_B}/ki/${CALLER_ID}/${foreignFile}/a-datei`,
  });
  const items = tableRows(world, 'ai_thread_items').length;
  const refusedFile = await postTurn('Und die?', { fileIds: [foreignFile] });
  assert.equal(refusedFile.status, 409, "another organization's file must be refused");
  assert.deepEqual(await refusedFile.json(), { error: 'file_not_found' });

  const otherThread = '40000000-0000-4000-8000-000000000009';
  tableRows(world, 'ai_threads').push({
    id: otherThread,
    organization_id: ORGANIZATION_A,
    user_id: OTHER_USER_ID,
    title: 'Fremder Chat',
  });
  const own = await upload(WEBP_BODY, 'image/webp', 'Foto.webp');
  assert.ok(own.result.success);
  const refusedThread = await postTurn('Hier rein', { threadId: otherThread, fileIds: [own.fileId] });
  assert.equal(refusedThread.status, 404, "another person's thread must be refused");
  assert.equal(tableRows(world, 'ai_thread_items').length, items, 'a refused message writes no item');
  assert.equal(
    files().find((file) => file.id === own.fileId)?.item_id,
    null,
    'a refused message leaves the upload unsent',
  );
}

// A message with more files than the cap is refused before anything runs.
{
  const calls = world.rpcCalls.length;
  const response = await postTurn('Zu viele', {
    fileIds: Array.from({ length: 6 }, () => crypto.randomUUID()),
  });
  assert.equal(response.status, 400, 'six files are over the cap of five');
  assert.equal(world.rpcCalls.length, calls, 'an over-cap message reaches no function');
}
