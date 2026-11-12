// The actual hand-out route handlers over the in-memory database
// (werk-flow/werkflow-planning#336). Without PROBLEM_REPORT_HANDOUT_SECRET
// every handler answers 503 and reads nothing; a missing or wrong token is
// refused, and so is every signed-in person without it: an admin, a Büro
// member, an employee and a support person. The list names ids only and
// leaves out a report already handed out. A hand-out carries none of the
// seeded originals, no attachment, no name and no id but the report's own;
// a report without a scrubbed copy, a closed one and one already handed out
// are refused with their codes, and an unknown id answers like a malformed
// one. The write-back refuses an invalid bucket or status, and its history
// reads as the Agent's in support's view and its answer as automatic in
// „Meine Meldungen“. supabase/tests/problem_report_handout.sql proves the
// database functions the stand-ins below answer for.
import assert from 'node:assert/strict';
import { mock } from 'bun:test';
import * as nextServer from 'next/server';
import {
  CALLER_ID,
  ORGANIZATION_A,
  ORGANIZATION_B,
  installActionWorld,
  signInAs,
  tableRows,
} from './action-boundary-world';

const secret = 'synthetic-handout-secret-0123456789abcdef';
const filerId = '33600000-0000-4000-8000-000000000003';
const assigneeId = '33600000-0000-4000-8000-000000000004';
const waitingId = '33600000-0000-4000-8000-000000000020';
const pendingId = '33600000-0000-4000-8000-000000000021';
const unscrubbableId = '33600000-0000-4000-8000-000000000022';
const claimedId = '33600000-0000-4000-8000-000000000023';
const closedId = '33600000-0000-4000-8000-000000000024';
const unknownId = '33600000-0000-4000-8000-0000000000ff';
const screenshotId = '33600000-0000-4000-8000-000000000030';
const attachmentId = '33600000-0000-4000-8000-000000000031';

// The originals of a made-up company. None of these strings may leave.
const ORGANIZATION_NAME = 'Beispiel Sanitär GmbH';
const OTHER_ORGANIZATION_NAME = 'Muster Haustechnik GmbH';
const ORIGINAL_DESCRIPTION =
  'Bei Familie Sonnberg in der Lindenallee 7 speichert der Auftrag nicht, Tel. 0170 5550123.';
const ORIGINAL_LABEL = 'Auftrag Sonnberg Heizung';
const ATTACHMENT_NAME = 'zaehler-sonnberg.jpg';
const PERSON_NAMES = ['Rita', 'Melder', 'Fiona', 'Filer', 'Arne', 'Assist'];
const SCRUBBED_DESCRIPTION =
  'Bei [Person 1] in der [Adresse 1] speichert der Auftrag nicht, Tel. [Telefon 1].';
const ORIGINAL_CONTEXT = {
  routeTemplate: '/auftraege/[jobNumber]',
  recentActions: [{ routeTemplate: '/auftraege/[jobNumber]', controlLabel: ORIGINAL_LABEL }],
  clientErrors: [{ name: 'TypeError', code: null, digest: '4182', routeTemplate: '/auftraege/[jobNumber]' }],
  appVersion: 'v2026.11.12',
  device: { platform: 'android', browser: 'chrome', viewport: { width: 412, height: 915 } },
  offline: false,
};
const SCRUBBED_CONTEXT = {
  ...ORIGINAL_CONTEXT,
  recentActions: [{ routeTemplate: '/auftraege/[jobNumber]', controlLabel: null }],
  appVersion: null,
};
const filePath = (reportId: string, fileId: string, kind: string) =>
  `${ORGANIZATION_B}/problem-reports/${reportId}/${fileId}/${kind}`;

const report = (id: string, organizationId: string, number: number, extra: object) => ({
  id,
  number,
  organization_id: organizationId,
  reporter_id: CALLER_ID,
  filed_by_id: filerId,
  created_at: `2026-11-0${number}T08:00:00.000Z`,
  status: 'eingegangen',
  bucket: null,
  assignee_id: assigneeId,
  closed_at: null,
  response: null,
  response_by_agent: false,
  description: ORIGINAL_DESCRIPTION,
  context: ORIGINAL_CONTEXT,
  originals_deleted_at: null,
  scrub_state: 'bereinigt',
  scrubbed_description: SCRUBBED_DESCRIPTION,
  scrubbed_context: SCRUBBED_CONTEXT,
  handed_out_at: null,
  ...extra,
});
const unscrubbed = { scrub_state: 'ausstehend', scrubbed_description: null, scrubbed_context: null };

const world = installActionWorld(
  {
    organizations: [
      { id: ORGANIZATION_A, name: OTHER_ORGANIZATION_NAME },
      { id: ORGANIZATION_B, name: ORGANIZATION_NAME },
    ],
    organization_members: [{ organization_id: ORGANIZATION_B, user_id: CALLER_ID, role: 'employee' }],
    profiles: [
      { id: CALLER_ID, first_name: 'Rita', last_name: 'Melder', email: 'rita@example.test' },
      { id: filerId, first_name: 'Fiona', last_name: 'Filer', email: 'fiona@example.test' },
      { id: assigneeId, first_name: 'Arne', last_name: 'Assist', email: 'arne@example.test' },
    ],
    problem_reports: [
      report(waitingId, ORGANIZATION_B, 1, {}),
      report(pendingId, ORGANIZATION_A, 2, unscrubbed),
      report(unscrubbableId, ORGANIZATION_A, 3, { ...unscrubbed, scrub_state: 'nicht_bereinigbar' }),
      report(claimedId, ORGANIZATION_B, 4, { handed_out_at: '2026-11-10T08:00:00.000Z' }),
      report(closedId, ORGANIZATION_B, 5, { status: 'erledigt', closed_at: '2026-11-06T08:00:00.000Z' }),
    ],
    problem_report_files: [
      {
        id: screenshotId,
        organization_id: ORGANIZATION_B,
        report_id: waitingId,
        kind: 'screenshot',
        storage_path: filePath(waitingId, screenshotId, 'screenshot'),
        file_name: 'screenshot.png',
        mime_type: 'image/png',
        size_bytes: 2048,
      },
      {
        id: attachmentId,
        organization_id: ORGANIZATION_B,
        report_id: waitingId,
        kind: 'anhang',
        storage_path: filePath(waitingId, attachmentId, 'anhang'),
        file_name: ATTACHMENT_NAME,
        mime_type: 'image/jpeg',
        size_bytes: 4096,
      },
    ],
    problem_report_events: [],
  },
  {
    problem_report_events: () => ({
      id: crypto.randomUUID(),
      payload: {},
      created_at: '2026-11-12T09:00:00.000Z',
    }),
  },
);

const reports = () => tableRows(world, 'problem_reports');
const events = () => tableRows(world, 'problem_report_events');
const reportRow = (args: Record<string, unknown>) =>
  reports().find((row) => row.id === args.p_report_id && row.organization_id === args.p_organization_id);
const refused = (code: string) => ({ data: null, error: { code: 'P0001', message: code } });
const recordAgent = (args: Record<string, unknown>, eventType: string) => {
  events().push({
    id: crypto.randomUUID(),
    organization_id: args.p_organization_id,
    report_id: args.p_report_id,
    event_type: eventType,
    actor_id: null,
    payload: {},
    created_at: '2026-11-12T09:00:00.000Z',
  });
};

/** The hand-out functions and the Agent's triage over the world's tables, with their refusals. */
world.rpc = ({ name, args }) => {
  const row = reportRow(args);
  if (!row) return refused('report_not_found');
  if (name === 'hand_out_problem_report') {
    if (row.scrub_state === 'ausstehend') return refused('copy_pending');
    if (row.scrub_state !== 'bereinigt') return refused('copy_unavailable');
    if (row.closed_at !== null) return refused('report_closed');
    if (row.handed_out_at !== null) return refused('already_handed_out');
    row.handed_out_at = '2026-11-12T09:00:00.000Z';
    recordAgent(args, 'copy_handed_out');
    const hasScreenshot = tableRows(world, 'problem_report_files').some(
      (file) => file.report_id === row.id && file.kind === 'screenshot',
    );
    return {
      data: {
        description: row.scrubbed_description,
        context: row.scrubbed_context,
        status: row.status,
        bucket: row.bucket,
        has_screenshot: hasScreenshot,
      },
      error: null,
    };
  }
  if (name === 'hand_out_problem_report_screenshot') {
    if (row.handed_out_at === null) return refused('report_not_handed_out');
    const file = tableRows(world, 'problem_report_files').find(
      (candidate) => candidate.report_id === row.id && candidate.kind === 'screenshot',
    );
    if (!file) return refused('no_screenshot');
    recordAgent(args, 'screenshot_handed_out');
    return {
      data: { path: file.storage_path, mime_type: file.mime_type },
      error: null,
    };
  }
  assert.equal(name, 'triage_problem_report');
  if (row.handed_out_at === null) return refused('report_not_handed_out');
  const changes = Object.entries(args.p_changes ?? {});
  for (const [field, value] of changes) {
    row[field] = value;
    recordAgent(args, `${field}_changed`);
  }
  if (changes.some(([field]) => field === 'response')) row.response_by_agent = true;
  return { data: null, error: null };
};

const storageReads: string[] = [];
const SCREENSHOT_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
mock.module('@/lib/storage/r2', () => ({
  readStorageObject: async ({ path }: { path: string }) => {
    storageReads.push(path);
    return SCREENSHOT_BYTES;
  },
  createSignedDownloadUrl: async ({ path }: { path: string }) => `https://storage.example.test/${path}`,
  // Support's filing reaches these; nothing here files.
  createSignedUploadUrl: async () => assert.fail('an upload was signed'),
  uploadStagingPath: () => assert.fail('an upload path was built'),
  promoteUploadedObject: async () => assert.fail('an upload was promoted'),
  discardStorageObjects: async () => assert.fail('an object was discarded'),
}));
mock.module('next/server', () => ({ ...nextServer, connection: async () => {} }));
const logged: string[] = [];
console.error = (...parts: unknown[]) => {
  logged.push(parts.map((part) => JSON.stringify(part)).join(' '));
};

const waitingRoute = await import('../../../app/api/problem-reports/v1/reports/route');
const handOutRoute = await import('../../../app/api/problem-reports/v1/reports/[reportId]/hand-out/route');
const screenshotRoute = await import(
  '../../../app/api/problem-reports/v1/reports/[reportId]/screenshot/route'
);
const writeBackRoute = await import(
  '../../../app/api/problem-reports/v1/reports/[reportId]/write-back/route'
);
const support = await import('@/lib/problem-reports/support-actions');
const own = await import('@/lib/problem-reports/actions');

const BASE = 'https://app.example.test/api/problem-reports/v1/reports';
// `null` sends no Authorization header.
const request = (path: string, authorization: string | null, body?: unknown) =>
  new Request(`${BASE}${path}`, {
    method: path === '' ? 'GET' : 'POST',
    headers: authorization ? { authorization, 'content-type': 'application/json' } : {},
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const params = (reportId: string) => ({ params: Promise.resolve({ reportId }) });
const BEARER = `Bearer ${secret}`;

const call = {
  waiting: (authorization: string | null) => waitingRoute.GET(request('', authorization)),
  handOut: (reportId: string, authorization: string | null = BEARER) =>
    handOutRoute.POST(request(`/${reportId}/hand-out`, authorization), params(reportId)),
  screenshot: (reportId: string, authorization: string | null = BEARER) =>
    screenshotRoute.POST(request(`/${reportId}/screenshot`, authorization), params(reportId)),
  writeBack: (reportId: string, body: unknown, authorization: string | null = BEARER) =>
    writeBackRoute.POST(request(`/${reportId}/write-back`, authorization, body), params(reportId)),
};
const everyHandler = (authorization: string | null): Array<[string, () => Promise<Response>]> => [
  ['waiting', () => call.waiting(authorization)],
  ['hand-out', () => call.handOut(waitingId, authorization)],
  ['screenshot', () => call.screenshot(waitingId, authorization)],
  ['write-back', () => call.writeBack(waitingId, { status: 'erledigt' }, authorization)],
];

/** Every handler answers `status` with no-store, and nothing reached the database, the history or storage. */
async function assertEveryHandlerRefuses(status: number, authorization: string | null, who: string) {
  const adminRequests = world.adminClientRequests;
  for (const [name, handler] of everyHandler(authorization)) {
    const response = await handler();
    assert.equal(response.status, status, `${name} for ${who}`);
    assert.equal(response.headers.get('cache-control'), 'no-store', `${name} for ${who} may be stored`);
  }
  assert.equal(world.adminClientRequests, adminRequests, `${who} reached the service-role client`);
  assert.equal(world.rpcCalls.length, 0, `${who} reached a database function`);
  assert.equal(events().length, 0, `${who} wrote history`);
  assert.equal(storageReads.length, 0, `${who} reached storage`);
}

// Off by default: without the secret, and with one too short to count, every
// handler answers 503 and reads nothing, also for a caller who sends a token.
delete process.env.PROBLEM_REPORT_HANDOUT_SECRET;
await assertEveryHandlerRefuses(503, BEARER, 'an unconfigured hand-out');
process.env.PROBLEM_REPORT_HANDOUT_SECRET = 'too-short';
await assertEveryHandlerRefuses(503, 'Bearer too-short', 'a placeholder secret');

// A missing or wrong token is refused: another value, the secret without
// `Bearer`, a longer value and a cron-style secret.
process.env.PROBLEM_REPORT_HANDOUT_SECRET = secret;
process.env.CRON_SECRET = 'synthetic-cron-secret-0123456789abcdef';
for (const authorization of [
  null,
  'Bearer wrong',
  secret,
  `${BEARER}x`,
  `Bearer ${process.env.CRON_SECRET}`,
]) {
  await assertEveryHandlerRefuses(401, authorization, `token ${JSON.stringify(authorization)}`);
}
// A secret in the query string counts for nothing.
const queryRequest = new Request(`${BASE}?token=${secret}&secret=${secret}`);
assert.equal((await waitingRoute.GET(queryRequest)).status, 401);

// A signed-in person is refused like anyone else: an admin, a Büro member and
// an employee of either organization, and a support person of the allowlist.
for (const role of ['admin', 'buero', 'employee'] as const) {
  for (const organizationId of [ORGANIZATION_A, ORGANIZATION_B]) {
    signInAs(world, role, organizationId);
    await assertEveryHandlerRefuses(401, null, `${role} of ${organizationId}`);
  }
}
process.env.SUPPORT_USER_IDS = CALLER_ID;
signInAs(world, null);
await assertEveryHandlerRefuses(401, null, 'a support person');

// The list names only the ids of open reports with a scrubbed copy that no
// thread received yet: no number, no organization, no text.
const waiting = await call.waiting(BEARER);
assert.equal(waiting.status, 200);
assert.equal(waiting.headers.get('cache-control'), 'no-store');
const waitingBody = await waiting.text();
assert.deepEqual(JSON.parse(waitingBody), { reportIds: [waitingId] });

// The hand-out carries the scrubbed copy, its context, status, bucket and the
// screenshot's address on this API, and nothing of the originals.
const handedOut = await call.handOut(waitingId);
assert.equal(handedOut.status, 200);
assert.equal(handedOut.headers.get('cache-control'), 'no-store');
const handOutBody = await handedOut.text();
assert.deepEqual(JSON.parse(handOutBody), {
  reportId: waitingId,
  description: SCRUBBED_DESCRIPTION,
  context: SCRUBBED_CONTEXT,
  status: 'eingegangen',
  bucket: null,
  screenshot: `/api/problem-reports/v1/reports/${waitingId}/screenshot`,
});
for (const original of [
  ORIGINAL_DESCRIPTION,
  'Sonnberg',
  'Lindenallee',
  '0170 5550123',
  ORIGINAL_LABEL,
  'v2026.11.12',
  ORGANIZATION_NAME,
  OTHER_ORGANIZATION_NAME,
  ATTACHMENT_NAME,
  'anhang',
  'storage.example.test',
  ...PERSON_NAMES,
]) {
  assert.ok(!handOutBody.includes(original), `the hand-out carries the original ${original}`);
}
for (const id of [
  ORGANIZATION_A,
  ORGANIZATION_B,
  CALLER_ID,
  filerId,
  assigneeId,
  screenshotId,
  attachmentId,
]) {
  assert.ok(!handOutBody.toLowerCase().includes(id), `the hand-out names the id ${id}`);
}
// The hand-out claimed the report: its entry names no person, and the list leaves it out.
assert.deepEqual(
  events().map((event) => [event.report_id, event.event_type, event.actor_id]),
  [[waitingId, 'copy_handed_out', null]],
);
assert.deepEqual(await (await call.waiting(BEARER)).json(), { reportIds: [] });

/** The answer to a refused request: its status and its code alone. */
async function refusal(response: Promise<Response>): Promise<[number, unknown]> {
  const answered = await response;
  assert.equal(answered.headers.get('cache-control'), 'no-store');
  return [answered.status, await answered.json()];
}

// A second hand-out, a report without a scrubbed copy, a closed one and one
// another thread took are refused with their codes and write no history.
const historyBefore = events().length;
assert.deepEqual(await refusal(call.handOut(waitingId)), [409, { error: 'already_handed_out' }]);
assert.deepEqual(await refusal(call.handOut(claimedId)), [409, { error: 'already_handed_out' }]);
assert.deepEqual(await refusal(call.handOut(pendingId)), [409, { error: 'copy_pending' }]);
assert.deepEqual(await refusal(call.handOut(unscrubbableId)), [409, { error: 'copy_unavailable' }]);
assert.deepEqual(await refusal(call.handOut(closedId)), [409, { error: 'report_closed' }]);
assert.equal(events().length, historyBefore, 'a refused hand-out wrote history');
// An unknown id answers exactly like an id that is none, so the answer tells nothing about existence.
const unknown = await refusal(call.handOut(unknownId));
assert.deepEqual(unknown, [404, { error: 'report_not_found' }]);
assert.deepEqual(await refusal(call.handOut('not-a-report')), unknown);
assert.deepEqual(await refusal(call.screenshot(unknownId)), unknown);
assert.deepEqual(await refusal(call.writeBack(unknownId, { status: 'erledigt' })), unknown);

// The screenshot leaves only a report a thread received, as the redrawn
// image's bytes through this server, with its own history entry.
assert.deepEqual(await refusal(call.screenshot(pendingId)), [409, { error: 'report_not_handed_out' }]);
assert.equal(storageReads.length, 0, 'a refused screenshot reached storage');
const screenshot = await call.screenshot(waitingId);
assert.equal(screenshot.status, 200);
assert.equal(screenshot.headers.get('content-type'), 'image/png');
assert.equal(screenshot.headers.get('cache-control'), 'no-store');
assert.deepEqual(new Uint8Array(await screenshot.arrayBuffer()), SCREENSHOT_BYTES);
assert.deepEqual(storageReads, [filePath(waitingId, screenshotId, 'screenshot')]);
assert.equal(events().at(-1)?.event_type, 'screenshot_handed_out');

// The write-back refuses an invalid bucket or status, an assignee, an empty
// answer and an empty change, before any database call.
const rpcsBefore = world.rpcCalls.length;
for (const body of [
  { bucket: 'egal' },
  { status: 'vergessen' },
  { assigneeId: assigneeId },
  { response: '   ' },
  { bucket: null },
  {},
  'erledigt',
]) {
  assert.deepEqual(
    await refusal(call.writeBack(waitingId, body)),
    [400, { error: 'invalid_input' }],
    JSON.stringify(body),
  );
}
assert.equal(world.rpcCalls.length, rpcsBefore, 'an invalid write-back reached the database');
// A report no thread received takes no write-back.
assert.deepEqual(await refusal(call.writeBack(pendingId, { status: 'erledigt' })), [
  409,
  { error: 'report_not_handed_out' },
]);

// A valid write-back is one triage call without an actor, which signals every support person.
process.env.SUPPORT_USER_IDS = `${CALLER_ID},${assigneeId}`;
const written = await call.writeBack(waitingId, {
  bucket: 'fehler',
  status: 'erledigt',
  response: 'Behoben, ab morgen live.',
});
assert.equal(written.status, 204);
assert.equal(written.headers.get('cache-control'), 'no-store');
const triage = world.rpcCalls.at(-1);
assert.equal(triage?.name, 'triage_problem_report');
assert.deepEqual(triage?.args, {
  p_organization_id: ORGANIZATION_B,
  p_report_id: waitingId,
  p_actor_id: null,
  p_changes: { bucket: 'fehler', status: 'erledigt', response: 'Behoben, ab morgen live.' },
  p_support_ids: [CALLER_ID, assigneeId],
});

// Support reads the Agent in the history and the answer as automatic.
const detail = await support.readSupportProblemReport(waitingId);
assert.ok(detail.success);
assert.ok(detail.report.responseByAgent, 'support does not see the answer as automatic');
assert.deepEqual(
  detail.report.history.map((entry) => `${entry.actorName}: ${entry.change.kind}`).toSorted(),
  ['Agent: bucket', 'Agent: handed_out', 'Agent: handed_out', 'Agent: response', 'Agent: status'],
);
// The reporter reads the answer as automatic in „Meine Meldungen“.
signInAs(world, 'employee', ORGANIZATION_B);
const mine = await own.listOwnProblemReports();
assert.ok(mine.success);
assert.deepEqual(
  mine.reports
    .filter((entry) => entry.id === waitingId)
    .map((entry) => [entry.response, entry.responseByAgent]),
  [['Behoben, ab morgen live.', true]],
);

// Logs carry codes and ids at most, never a report's text or a name.
for (const line of logged) {
  for (const original of [ORIGINAL_DESCRIPTION, SCRUBBED_DESCRIPTION, 'Behoben', ...PERSON_NAMES]) {
    assert.ok(!line.includes(original), `a log line carries ${original}`);
  }
}
