// The actual support actions over the in-memory database
// (werk-flow/werkflow-planning#335). Support is no organization role: an
// admin, a Büro member and an employee of a customer organization are refused
// on every support action, and so is everyone while the allowlist cannot be
// resolved. A support person reaches the reports of every organization, sees
// no original text before „Original öffnen“, and each opening enters the
// history first. A triage of an unknown report and a report filed for a
// person outside the chosen organization are refused.
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
import { z } from '@/lib/zod';

const reporterId = '33500000-0000-4000-8000-000000000002';
const otherSupportId = '33500000-0000-4000-8000-000000000003';
const outsiderId = '33500000-0000-4000-8000-000000000004';
const scrubbedReportId = '33500000-0000-4000-8000-000000000020';
const pendingReportId = '33500000-0000-4000-8000-000000000021';
const deletedReportId = '33500000-0000-4000-8000-000000000022';
const filedReportId = '33500000-0000-4000-8000-000000000023';
const unknownReportId = '33500000-0000-4000-8000-000000000029';
const screenshotId = '33500000-0000-4000-8000-000000000030';
const attachmentId = '33500000-0000-4000-8000-000000000031';
const uploadId = '33500000-0000-4000-8000-000000000032';
const newReportId = '33500000-0000-4000-8000-000000000040';
/** An allowlisted id whose account was deleted: no profile. */
const goneSupportId = '33500000-0000-4000-8000-0000000000ff';

const ORIGINAL_TEXT = 'Bei Familie Beispiel in der Musterstraße 1 speichert der Auftrag nicht.';
const SCRUBBED_TEXT = 'Bei [Kunde] in [Adresse] speichert der Auftrag nicht.';
const SCRUBBED_CONTEXT = {
  routeTemplate: '/auftraege/[jobNumber]',
  recentActions: [{ routeTemplate: '/auftraege/[jobNumber]', controlLabel: null }],
  clientErrors: [{ name: null, code: null, digest: '4182', routeTemplate: '/auftraege/[jobNumber]' }],
  appVersion: null,
  device: { platform: 'android', browser: 'chrome', viewport: { width: 412, height: 915 } },
  offline: false,
};

const report = (id: string, organizationId: string, number: number, createdAt: string, extra: object) => ({
  id,
  number,
  organization_id: organizationId,
  reporter_id: reporterId,
  filed_by_id: reporterId,
  created_at: createdAt,
  status: 'eingegangen',
  bucket: null,
  assignee_id: null,
  closed_at: null,
  response: null,
  description: ORIGINAL_TEXT,
  context: {},
  originals_deleted_at: null,
  scrub_state: 'ausstehend',
  scrubbed_description: null,
  scrubbed_context: null,
  ...extra,
});
const filePath = (reportId: string, fileId: string, kind: string) =>
  `${ORGANIZATION_B}/problem-reports/${reportId}/${fileId}/${kind}`;

const world = installActionWorld(
  {
    organizations: [
      { id: ORGANIZATION_A, name: 'Muster Haustechnik GmbH' },
      { id: ORGANIZATION_B, name: 'Beispiel Sanitär GmbH' },
    ],
    organization_members: [{ organization_id: ORGANIZATION_B, user_id: reporterId, role: 'employee' }],
    profiles: [
      { id: CALLER_ID, first_name: 'Sina', last_name: 'Support', email: 'sina@example.test' },
      { id: otherSupportId, first_name: 'Timo', last_name: 'Support', email: 'timo@example.test' },
      { id: reporterId, first_name: 'Rita', last_name: 'Melder', email: 'rita@example.test' },
    ],
    problem_reports: [
      report(scrubbedReportId, ORGANIZATION_B, 1, '2026-11-01T08:00:00.000Z', {
        scrub_state: 'bereinigt',
        scrubbed_description: SCRUBBED_TEXT,
        scrubbed_context: SCRUBBED_CONTEXT,
      }),
      report(pendingReportId, ORGANIZATION_A, 1, '2026-11-02T08:00:00.000Z', {}),
      report(deletedReportId, ORGANIZATION_B, 2, '2026-11-03T08:00:00.000Z', {
        status: 'erledigt',
        closed_at: '2026-11-04T08:00:00.000Z',
        description: null,
        context: null,
        originals_deleted_at: '2026-11-05T08:00:00.000Z',
      }),
      report(filedReportId, ORGANIZATION_B, 3, '2026-11-04T08:00:00.000Z', { filed_by_id: CALLER_ID }),
    ],
    problem_report_files: [
      {
        id: screenshotId,
        organization_id: ORGANIZATION_B,
        report_id: scrubbedReportId,
        kind: 'screenshot',
        storage_path: filePath(scrubbedReportId, screenshotId, 'screenshot'),
        file_name: 'screenshot.png',
        mime_type: 'image/png',
        size_bytes: 2048,
      },
      {
        id: attachmentId,
        organization_id: ORGANIZATION_B,
        report_id: scrubbedReportId,
        kind: 'anhang',
        storage_path: filePath(scrubbedReportId, attachmentId, 'anhang'),
        file_name: 'zaehler.jpg',
        mime_type: 'image/jpeg',
        size_bytes: 4096,
      },
    ],
    problem_report_events: [],
  },
  { problem_report_events: () => ({ payload: {}, created_at: '2026-11-11T09:00:00.000Z' }) },
);
/**
 * The support functions over the world's tables: an opening writes its
 * history entry, unless the history cannot be written; the writes answer
 * success, and a filing its number.
 */
const fieldValues = z.record(z.string(), z.unknown());
const supportFunctions: typeof world.rpc = ({ name, args }) => {
  if (name === 'record_problem_report_opening') {
    if (world.failingTables.has('problem_report_events'))
      return { data: null, error: { code: '08006', message: 'connection failure' } };
    world.tables.problem_report_events?.push({
      organization_id: args.p_organization_id,
      report_id: args.p_report_id,
      event_type: 'original_opened',
      actor_id: args.p_actor_id,
      payload: args.p_file_id === null ? {} : { file_id: args.p_file_id },
    });
    return { data: null, error: null };
  }
  if (name === 'triage_problem_report') {
    // As the database function: a changed field must still hold the value its page showed.
    const row = world.tables.problem_reports?.find((candidate) => candidate.id === args.p_report_id);
    const changes = fieldValues.parse(args.p_changes);
    const expected = fieldValues.parse(args.p_expected);
    if (row === undefined) return { data: null, error: { code: 'P0001', message: 'report_not_found' } };
    if (Object.keys(changes).some((field) => row[field] !== expected[field]))
      return { data: null, error: { code: 'P0001', message: 'triage_conflict' } };
    Object.assign(row, changes);
    return { data: null, error: null };
  }
  assert.ok(name === 'file_problem_report_for_caller' || name === 'register_problem_report_file', name);
  return { data: name === 'file_problem_report_for_caller' ? 4 : null, error: null };
};
world.rpc = supportFunctions;
const storageCalls: string[] = [];
mock.module('@/lib/storage/r2', () => ({
  createSignedDownloadUrl: async ({ path }: { path: string }) => {
    storageCalls.push(`view ${path}`);
    return `https://storage.example.test/${path}`;
  },
  createSignedUploadUrl: async ({ path }: { path: string }) => {
    storageCalls.push(`sign ${path}`);
    return 'https://storage.example.test/signed';
  },
  uploadStagingPath: (organizationId: string, path: string) =>
    `${organizationId}/staging/${path.slice(organizationId.length + 1)}`,
  promoteUploadedObject: async ({ path }: { path: string }) => {
    storageCalls.push(`promote ${path}`);
    return { exists: true, sizeBytes: 2048, contentType: 'image/jpeg', path: `${path}-copy` };
  },
  discardStorageObjects: async ({ paths }: { paths: readonly string[] }) => {
    storageCalls.push(...paths.map((path) => `discard ${path}`));
  },
}));

// The scrub a filing leaves for after its answer; problem-report-scrub-boundaries.ts runs the scrub itself.
const scrubsAfterAnswer: string[] = [];
mock.module('next/server', () => ({
  ...nextServer,
  after: () => {
    scrubsAfterAnswer.push('scrub');
  },
}));
const support = await import('@/lib/problem-reports/support-actions');
const memberFiles = await import('@/lib/problem-reports/file-actions');

const events = () => tableRows(world, 'problem_report_events');
const ticket = (reportId: string, kind: 'anhang' | 'screenshot' = 'anhang') => ({
  organizationId: ORGANIZATION_B,
  reportId,
  kind,
  fileName: 'zaehler.jpg',
  mimeType: 'image/jpeg',
  fileSizeBytes: 2048,
});
const finalize = (reportId: string) => ({
  organizationId: ORGANIZATION_B,
  reportId,
  fileId: uploadId,
  kind: 'anhang' as const,
  fileName: 'zaehler.jpg',
});
const filing = (organizationId: string, reporter: string) => ({
  organizationId,
  reporterId: reporter,
  reportId: newReportId,
  description: 'Am Telefon: die Liste bleibt leer.',
});

/** Every support action with a valid input, each naming its call for a failed assertion. */
const everyAction: Array<[string, () => Promise<{ success: boolean; error?: string }>]> = [
  [
    'listSupportProblemReports',
    () => support.listSupportProblemReports({ status: 'alle', bucket: 'alle', page: 1 }),
  ],
  ['readSupportProblemReport', () => support.readSupportProblemReport(scrubbedReportId)],
  [
    'triageProblemReport',
    () =>
      support.triageProblemReport({
        reportId: scrubbedReportId,
        changes: { bucket: 'fehler' },
        expected: { bucket: null },
      }),
  ],
  ['openProblemReportOriginal', () => support.openProblemReportOriginal(scrubbedReportId)],
  [
    'openProblemReportAttachment',
    () => support.openProblemReportAttachment({ reportId: scrubbedReportId, fileId: attachmentId }),
  ],
  ['listSupportFilingOptions', () => support.listSupportFilingOptions(ORGANIZATION_B)],
  [
    'fileProblemReportForCaller',
    () => support.fileProblemReportForCaller(filing(ORGANIZATION_B, reporterId)),
  ],
  [
    'createSupportReportFileUploadTicket',
    () => support.createSupportReportFileUploadTicket(ticket(filedReportId)),
  ],
  ['finalizeSupportReportFileUpload', () => support.finalizeSupportReportFileUpload(finalize(filedReportId))],
];

/** Every action answers `error`, and none reached the database, the history or storage. */
async function assertEveryActionRefuses(error: string, who: string): Promise<void> {
  const adminRequests = world.adminClientRequests;
  for (const [name, call] of everyAction) {
    assert.deepEqual(await call(), { success: false, error }, `${name} for ${who}`);
  }
  assert.equal(world.adminClientRequests, adminRequests, `${who} reached the service-role client`);
  assert.equal(world.rpcCalls.length, 0, `${who} reached a database function`);
  assert.equal(events().length, 0, `${who} wrote history`);
  assert.equal(storageCalls.length, 0, `${who} reached storage`);
}

// Signed out, nothing is read, written or opened.
process.env.SUPPORT_USER_IDS = CALLER_ID;
world.callerId = null;
await assertEveryActionRefuses('not_authenticated', 'a signed-out caller');

// No role of a customer organization is support: an admin, a Büro member and
// an employee are refused on every action, also in the report's own organization.
process.env.SUPPORT_USER_IDS = otherSupportId;
for (const role of ['admin', 'buero', 'employee'] as const) {
  for (const organizationId of [ORGANIZATION_A, ORGANIZATION_B]) {
    signInAs(world, role, organizationId);
    await assertEveryActionRefuses('not_authorized', `${role} of ${organizationId}`);
  }
}

// An allowlist that is missing, empty or malformed refuses everyone, the
// listed person included.
signInAs(world, null);
for (const setting of [undefined, '', '   ', `${CALLER_ID},not-an-id`, `${CALLER_ID};${otherSupportId}`]) {
  if (setting === undefined) delete process.env.SUPPORT_USER_IDS;
  else process.env.SUPPORT_USER_IDS = setting;
  await assertEveryActionRefuses('support_unavailable', `allowlist ${JSON.stringify(setting)}`);
}

// A support person needs no membership. The queue holds every organization's
// reports, oldest first, with the scrubbed copy and never an original text.
process.env.SUPPORT_USER_IDS = `${otherSupportId}, ${CALLER_ID.toUpperCase()}`;
const queue = await support.listSupportProblemReports({ status: 'alle', bucket: 'alle', page: 1 });
assert.ok(queue.success);
assert.deepEqual(
  queue.page.entries.map((entry) => [entry.id, entry.organizationName, entry.scrubbedDescription]),
  [
    [scrubbedReportId, 'Beispiel Sanitär GmbH', SCRUBBED_TEXT],
    [pendingReportId, 'Muster Haustechnik GmbH', null],
    [deletedReportId, 'Beispiel Sanitär GmbH', null],
    [filedReportId, 'Beispiel Sanitär GmbH', null],
  ],
);
assert.equal(queue.page.total, 4);
// A report whose original went before it had a scrubbed copy holds no text;
// the queue knows it, to say so.
assert.deepEqual(
  queue.page.entries.map((entry) => entry.originalsDeleted),
  [false, false, true, false],
);
assert.ok(!JSON.stringify(queue).includes('Familie Beispiel'), 'the queue carries an original text');
assert.ok(!JSON.stringify(queue).includes(reporterId), 'the queue names the reporter');
assert.deepEqual(
  queue.page.entries.map((entry) => entry.filedForCaller),
  [false, false, false, true],
);
const open = await support.listSupportProblemReports({ status: 'offen', bucket: 'ohne', page: 1 });
assert.ok(open.success);
assert.ok(open.page.entries.every((entry) => entry.id !== deletedReportId));
assert.deepEqual(await support.listSupportProblemReports({ status: 'alle', bucket: 'alle', page: 0 }), {
  success: false,
  error: 'invalid_input',
});

// A report's page shows the scrubbed copy and the redrawn screenshot, and no
// original: neither the text nor an attachment's name.
const detail = await support.readSupportProblemReport(scrubbedReportId);
assert.ok(detail.success);
assert.equal(detail.report.scrubbedDescription, SCRUBBED_TEXT);
assert.deepEqual(detail.report.scrubbedContext, SCRUBBED_CONTEXT);
assert.equal(
  detail.report.screenshotUrl,
  `https://storage.example.test/${filePath(scrubbedReportId, screenshotId, 'screenshot')}`,
);
assert.equal(detail.report.attachmentCount, 1);
assert.ok(!JSON.stringify(detail).includes('Familie Beispiel'));
assert.ok(!JSON.stringify(detail).includes('zaehler.jpg'));
assert.deepEqual(
  detail.report.assignees.map((assignee) => assignee.name),
  ['Sina Support', 'Timo Support'],
);
// An allowlisted id whose account is gone names nobody a report can point to: it is no assignee.
process.env.SUPPORT_USER_IDS = `${otherSupportId}, ${CALLER_ID}, ${goneSupportId}`;
const withGoneId = await support.readSupportProblemReport(scrubbedReportId);
assert.ok(withGoneId.success);
assert.deepEqual(
  withGoneId.report.assignees.map((assignee) => assignee.userId),
  [CALLER_ID, otherSupportId],
);
process.env.SUPPORT_USER_IDS = `${otherSupportId}, ${CALLER_ID.toUpperCase()}`;
const pending = await support.readSupportProblemReport(pendingReportId);
assert.ok(pending.success);
assert.equal(pending.report.scrubbedDescription, null);
assert.equal(pending.report.scrubState, 'ausstehend');
assert.equal(pending.report.scrubbedContext, null);
assert.ok(!JSON.stringify(pending).includes('Familie Beispiel'), 'an unscrubbed report shows its original');
assert.deepEqual(await support.readSupportProblemReport(unknownReportId), {
  success: false,
  error: 'report_not_found',
});
assert.equal(events().length, 0, 'reading a report page wrote history');

// A triage of an unknown report is refused; an assignee is a support person
// of the allowlist; the call is scoped by the report's own organization and
// names only the fields the input names.
assert.deepEqual(
  await support.triageProblemReport({
    reportId: unknownReportId,
    changes: { status: 'erledigt' },
    expected: { status: 'eingegangen' },
  }),
  { success: false, error: 'report_not_found' },
);
assert.deepEqual(
  await support.triageProblemReport({
    reportId: scrubbedReportId,
    changes: { assigneeId: reporterId },
    expected: { assigneeId: null },
  }),
  { success: false, error: 'assignee_not_support' },
);
assert.deepEqual(
  await support.triageProblemReport({
    reportId: 'keine-meldung',
    changes: { bucket: 'fehler' },
    expected: { bucket: null },
  }),
  { success: false, error: 'invalid_input' },
);
// A save names what it was based on for exactly the fields it changes.
assert.deepEqual(
  await support.triageProblemReport({
    reportId: scrubbedReportId,
    changes: { bucket: 'fehler' },
    expected: {},
  }),
  { success: false, error: 'invalid_input' },
);
assert.equal(world.rpcCalls.length, 0);
assert.deepEqual(
  await support.triageProblemReport({
    reportId: scrubbedReportId,
    changes: { status: 'erledigt', assigneeId: otherSupportId, response: '  Behoben, ab morgen live.  ' },
    expected: { status: 'eingegangen', assigneeId: null, response: null },
  }),
  { success: true },
);
assert.deepEqual(world.rpcCalls.at(-1), {
  name: 'triage_problem_report',
  args: {
    p_organization_id: ORGANIZATION_B,
    p_report_id: scrubbedReportId,
    p_actor_id: CALLER_ID,
    p_changes: { status: 'erledigt', assignee_id: otherSupportId, response: 'Behoben, ab morgen live.' },
    p_expected: { status: 'eingegangen', assignee_id: null, response: null },
    // The other support persons of the allowlist; the caller's own page reads again itself.
    p_support_ids: [otherSupportId],
  },
});
// An emptied answer clears it.
await support.triageProblemReport({
  reportId: scrubbedReportId,
  changes: { response: '   ' },
  expected: { response: 'Behoben, ab morgen live.' },
});
assert.deepEqual(world.rpcCalls.at(-1)?.args.p_changes, { response: null });
// Two saves from the same state: the first is saved, the second is refused and
// changes nothing, so a late save never replaces the newer answer.
const sameState = { response: null };
assert.deepEqual(
  await support.triageProblemReport({
    reportId: scrubbedReportId,
    changes: { response: 'Erste Antwort' },
    expected: sameState,
  }),
  { success: true },
);
assert.deepEqual(
  await support.triageProblemReport({
    reportId: scrubbedReportId,
    changes: { response: 'Zweite Antwort' },
    expected: sameState,
  }),
  { success: false, error: 'triage_conflict' },
);
assert.equal(
  world.tables.problem_reports?.find((row) => row.id === scrubbedReportId)?.response,
  'Erste Antwort',
);
world.rpc = () => ({ data: null, error: { code: 'P0001', message: 'assignee_not_support' } });
assert.deepEqual(
  await support.triageProblemReport({
    reportId: scrubbedReportId,
    changes: { assigneeId: otherSupportId },
    expected: { assigneeId: otherSupportId },
  }),
  { success: false, error: 'assignee_not_support' },
);
world.rpc = () => ({ data: null, error: { code: 'P0001', message: 'report_not_found' } });
assert.deepEqual(
  await support.triageProblemReport({
    reportId: scrubbedReportId,
    changes: { bucket: 'wunsch' },
    expected: { bucket: null },
  }),
  { success: false, error: 'report_not_found' },
);

// „Original öffnen“ writes the opening into the history, then hands out the
// original. When the history cannot be written, no original leaves.
world.rpc = supportFunctions;
world.failingTables.add('problem_report_events');
assert.deepEqual(await support.openProblemReportOriginal(scrubbedReportId), {
  success: false,
  error: 'load_failed',
});
world.failingTables.delete('problem_report_events');
world.tables.problem_report_events = [];
const original = await support.openProblemReportOriginal(scrubbedReportId);
assert.ok(original.success);
assert.equal(original.original?.description, ORIGINAL_TEXT);
assert.equal(original.original?.reporterName, 'Rita Melder');
assert.deepEqual(
  original.original?.attachments.map((file) => file.fileName),
  ['zaehler.jpg'],
);
assert.deepEqual(
  events().map((event) => [event.organization_id, event.report_id, event.event_type, event.actor_id]),
  [[ORGANIZATION_B, scrubbedReportId, 'original_opened', CALLER_ID]],
);
assert.deepEqual(world.rpcCalls.at(-1)?.args.p_support_ids, [otherSupportId]);
// A report whose originals are deleted says so and gets no history entry.
assert.deepEqual(await support.openProblemReportOriginal(deletedReportId), { success: true, original: null });
assert.deepEqual(await support.openProblemReportOriginal(unknownReportId), {
  success: false,
  error: 'report_not_found',
});
assert.equal(events().length, 1);

// An attachment opens only as a file of its own report, never the
// screenshot's row or a file through another report, and each opening is a
// history entry that names the file.
storageCalls.length = 0;
for (const target of [
  { reportId: pendingReportId, fileId: attachmentId },
  { reportId: scrubbedReportId, fileId: screenshotId },
  { reportId: deletedReportId, fileId: attachmentId },
]) {
  assert.deepEqual(await support.openProblemReportAttachment(target), {
    success: false,
    error: 'file_not_found',
  });
}
assert.equal(events().length, 1);
assert.equal(storageCalls.length, 0);
const opened = await support.openProblemReportAttachment({
  reportId: scrubbedReportId,
  fileId: attachmentId,
});
assert.ok(opened.success);
assert.equal(
  opened.url,
  `https://storage.example.test/${filePath(scrubbedReportId, attachmentId, 'anhang')}`,
);
assert.deepEqual(events().at(-1)?.payload, { file_id: attachmentId });
assert.equal(events().length, 2);

// Filing for a caller: the choices are every organization and the members of
// the chosen one. The call names the member as reporter and the caller as
// filer; a person outside the chosen organization is the database's refusal.
const options = await support.listSupportFilingOptions(ORGANIZATION_B);
assert.ok(options.success);
assert.equal(options.options.organizations.length, 2);
assert.deepEqual(options.options.members, [{ userId: reporterId, name: 'Rita Melder' }]);
const noChoice = await support.listSupportFilingOptions(null);
assert.ok(noChoice.success);
assert.deepEqual(noChoice.options.members, []);

world.rpcCalls.length = 0;
world.rpc = ({ args }) =>
  args.p_reporter_id === reporterId && args.p_organization_id === ORGANIZATION_B
    ? { data: 4, error: null }
    : { data: null, error: { code: 'P0001', message: 'reporter_not_member' } };
assert.deepEqual(await support.fileProblemReportForCaller(filing(ORGANIZATION_B, reporterId)), {
  success: true,
  reportId: newReportId,
  number: 4,
});
assert.deepEqual(world.rpcCalls.at(-1), {
  name: 'file_problem_report_for_caller',
  args: {
    p_report_id: newReportId,
    p_organization_id: ORGANIZATION_B,
    p_reporter_id: reporterId,
    p_actor_id: CALLER_ID,
    p_description: 'Am Telefon: die Liste bleibt leer.',
    p_support_ids: [otherSupportId],
  },
});
// The saved report is scrubbed after the answer; a refused filing leaves nothing to scrub.
assert.equal(scrubsAfterAnswer.length, 1);
for (const refused of [filing(ORGANIZATION_A, reporterId), filing(ORGANIZATION_B, outsiderId)]) {
  assert.deepEqual(await support.fileProblemReportForCaller(refused), {
    success: false,
    error: 'reporter_not_member',
  });
}
assert.equal(scrubsAfterAnswer.length, 1);

// Support adds attachments only to a report it filed itself, and never a screenshot.
storageCalls.length = 0;
world.rpcCalls.length = 0;
world.rpc = () => ({ data: null, error: null });
assert.deepEqual(await support.createSupportReportFileUploadTicket(ticket(scrubbedReportId)), {
  success: false,
  error: 'report_not_found',
});
assert.deepEqual(await support.finalizeSupportReportFileUpload(finalize(scrubbedReportId)), {
  success: false,
  error: 'report_not_found',
});
assert.deepEqual(
  await support.createSupportReportFileUploadTicket({
    ...ticket(filedReportId),
    organizationId: ORGANIZATION_A,
  }),
  { success: false, error: 'report_not_found' },
);
assert.deepEqual(await support.createSupportReportFileUploadTicket(ticket(filedReportId, 'screenshot')), {
  success: false,
  error: 'invalid_input',
});
assert.equal(storageCalls.length, 0, `storage was touched: ${storageCalls.join(', ')}`);
assert.equal(world.rpcCalls.length, 0);
const issued = await support.createSupportReportFileUploadTicket(ticket(filedReportId));
assert.ok(issued.success);
assert.equal(storageCalls.at(-1), `sign ${filePath(filedReportId, issued.ticket.fileId, 'anhang')}`);
assert.deepEqual(await support.finalizeSupportReportFileUpload(finalize(filedReportId)), { success: true });
assert.equal(world.rpcCalls.at(-1)?.args.p_actor_id, CALLER_ID);
assert.equal(world.rpcCalls.at(-1)?.args.p_organization_id, ORGANIZATION_B);

// A support person who is also a member of the report's organization reaches
// a report support filed for a caller only through support's actions: the
// member's own ticket and finalize refuse it, after the person left the
// allowlist and while the allowlist cannot be resolved.
signInAs(world, 'employee', ORGANIZATION_B);
storageCalls.length = 0;
world.rpcCalls.length = 0;
for (const setting of [otherSupportId, 'not-an-id']) {
  process.env.SUPPORT_USER_IDS = setting;
  const memberTicket = { ...ticket(filedReportId), kind: 'anhang' as const };
  assert.deepEqual(await memberFiles.createProblemReportFileUploadTicket(memberTicket), {
    success: false,
    error: 'report_not_found',
  });
  assert.deepEqual(await memberFiles.finalizeProblemReportFileUpload(finalize(filedReportId)), {
    success: false,
    error: 'report_not_found',
  });
  assert.deepEqual(await support.createSupportReportFileUploadTicket(ticket(filedReportId)), {
    success: false,
    error: setting === otherSupportId ? 'not_authorized' : 'support_unavailable',
  });
}
assert.equal(storageCalls.length, 0, `storage was touched: ${storageCalls.join(', ')}`);
assert.equal(world.rpcCalls.length, 0);
