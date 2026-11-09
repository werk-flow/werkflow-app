// The actual problem-report actions over the in-memory database
// (werk-flow/werkflow-planning#331). A report goes only into an organization
// where the caller is a member. An employee, a Büro member and an admin of
// the same organization read only their own reports, never a colleague's. A
// file ticket and a finalize reach only a report the caller filed. Support
// opens any report only while the allowlist resolves and names the caller,
// and each opening enters the history.
import assert from 'node:assert/strict';
import { mock } from 'bun:test';
import type { ProblemReportContext } from '@/lib/problem-reports/schemas';
import {
  CALLER_ID,
  ORGANIZATION_A,
  ORGANIZATION_B,
  installActionWorld,
  signInAs,
  tableRows,
} from './action-boundary-world';

const colleagueId = '33100000-0000-4000-8000-000000000002';
const ownReportId = '33100000-0000-4000-8000-000000000020';
const colleagueReportId = '33100000-0000-4000-8000-000000000021';
const foreignReportId = '33100000-0000-4000-8000-000000000022';
const fileId = '33100000-0000-4000-8000-000000000030';

const context: ProblemReportContext = {
  routeTemplate: '/auftraege/[jobNumber]',
  recentActions: [{ routeTemplate: '/auftraege', controlLabel: 'Speichern' }],
  clientErrors: [{ name: 'TypeError', code: null, digest: '1234', routeTemplate: '/auftraege/[jobNumber]' }],
  appVersion: '2026.11.9',
  device: { platform: 'android', browser: 'chrome', viewport: { width: 412, height: 915 } },
  offline: false,
};
const report = (id: string, organizationId: string, reporterId: string) => ({
  id,
  organization_id: organizationId,
  reporter_id: reporterId,
  filed_by_id: reporterId,
  created_at: '2026-11-09T08:00:00.000Z',
  status: 'eingegangen',
  closed_at: null,
  response: null,
  description: 'Der Speichern-Knopf reagiert nicht.',
  context,
  originals_deleted_at: null,
});

const world = installActionWorld(
  {
    problem_reports: [
      report(ownReportId, ORGANIZATION_A, CALLER_ID),
      report(colleagueReportId, ORGANIZATION_A, colleagueId),
      report(foreignReportId, ORGANIZATION_B, colleagueId),
    ],
    problem_report_files: [],
    problem_report_events: [],
  },
  {
    problem_reports: () => ({
      created_at: '2026-11-09T09:00:00.000Z',
      status: 'eingegangen',
      closed_at: null,
      response: null,
      originals_deleted_at: null,
    }),
  },
);
world.rpc = ({ name }) => {
  assert.equal(name, 'register_problem_report_file');
  return { data: null, error: null };
};
const storageCalls: string[] = [];
mock.module('@/lib/storage/r2', () => ({
  createSignedUploadUrl: async ({ path }: { path: string }) => {
    storageCalls.push(`sign ${path}`);
    return 'https://storage.example.test/signed';
  },
  uploadStagingPath: (organizationId: string, path: string) =>
    `${organizationId}/staging/${path.slice(organizationId.length + 1)}`,
  promoteUploadedObject: async ({ path }: { path: string }) => {
    storageCalls.push(`promote ${path}`);
    return { exists: true, sizeBytes: 2048, contentType: 'image/png', path: `${path}-copy` };
  },
  discardStorageObjects: async ({ paths }: { paths: readonly string[] }) => {
    storageCalls.push(...paths.map((path) => `discard ${path}`));
  },
}));

const actions = await import('@/lib/problem-reports/actions');
const fileActions = await import('@/lib/problem-reports/file-actions');
const supportActions = await import('@/lib/problem-reports/support-actions');

const reportCount = (): number => tableRows(world, 'problem_reports').length;
const submission = (organizationId: string) => ({
  organizationId,
  description: 'Die Liste bleibt leer.',
  context,
});

// Signed out, nothing is submitted, read or uploaded.
world.callerId = null;
assert.deepEqual(await actions.submitProblemReport(submission(ORGANIZATION_A)), {
  success: false,
  error: 'not_authenticated',
});
assert.deepEqual(await actions.readOwnProblemReport(ownReportId), {
  success: false,
  error: 'not_authenticated',
});
assert.deepEqual(await actions.listOwnProblemReports(), { success: false, error: 'not_authenticated' });

// A context outside its fixed shape is refused before identity: another
// field, or a route that carries a record's id.
signInAs(world, 'employee');
const contextWithEmail = { ...context, email: 'x@example.test' };
assert.deepEqual(
  await actions.submitProblemReport({
    ...submission(ORGANIZATION_A),
    context: contextWithEmail,
  }),
  { success: false, error: 'invalid_input' },
);
assert.deepEqual(
  await actions.submitProblemReport({
    ...submission(ORGANIZATION_A),
    context: { ...context, routeTemplate: `/auftraege/${ownReportId}` },
  }),
  { success: false, error: 'invalid_input' },
);

// Submitting into an organization the caller is not a member of is refused and stores nothing.
const before = reportCount();
assert.deepEqual(await actions.submitProblemReport(submission(ORGANIZATION_B)), {
  success: false,
  error: 'not_a_member',
});
assert.equal(reportCount(), before);

// A member's report lands in their organization, filed and reported by them.
const submitted = await actions.submitProblemReport(submission(ORGANIZATION_A));
assert.ok(submitted.success);
const stored = tableRows(world, 'problem_reports').find((row) => row.id === submitted.reportId);
assert.equal(stored?.organization_id, ORGANIZATION_A);
assert.equal(stored?.reporter_id, CALLER_ID);
assert.equal(stored?.filed_by_id, CALLER_ID);

// No role of the same organization reads a colleague's report; each reads their own.
for (const role of ['employee', 'buero', 'admin'] as const) {
  signInAs(world, role);
  assert.deepEqual(await actions.readOwnProblemReport(colleagueReportId), {
    success: false,
    error: 'report_not_found',
  });
  const own = await actions.readOwnProblemReport(ownReportId);
  assert.ok(own.success);
  assert.equal(own.report.id, ownReportId);
  const list = await actions.listOwnProblemReports();
  assert.ok(list.success);
  assert.ok(list.reports.every((entry) => entry.id !== colleagueReportId && entry.id !== foreignReportId));
}

// A file ticket and a finalize reach only a report the caller filed.
signInAs(world, 'admin');
const ticket = (organizationId: string, reportId: string) => ({
  organizationId,
  reportId,
  kind: 'screenshot' as const,
  fileName: 'bildschirm.png',
  mimeType: 'image/png',
  fileSizeBytes: 2048,
});
assert.deepEqual(
  await fileActions.createProblemReportFileUploadTicket(ticket(ORGANIZATION_A, colleagueReportId)),
  {
    success: false,
    error: 'report_not_found',
  },
);
assert.deepEqual(
  await fileActions.createProblemReportFileUploadTicket(ticket(ORGANIZATION_B, foreignReportId)),
  {
    success: false,
    error: 'not_a_member',
  },
);
assert.deepEqual(
  await fileActions.createProblemReportFileUploadTicket(ticket(ORGANIZATION_A, foreignReportId)),
  {
    success: false,
    error: 'report_not_found',
  },
);
assert.deepEqual(
  await fileActions.createProblemReportFileUploadTicket({
    ...ticket(ORGANIZATION_A, ownReportId),
    mimeType: 'text/html',
  }),
  { success: false, error: 'file_type_not_allowed' },
);
assert.deepEqual(
  await fileActions.createProblemReportFileUploadTicket({
    ...ticket(ORGANIZATION_A, ownReportId),
    fileSizeBytes: 50 * 1024 * 1024,
  }),
  { success: false, error: 'file_too_large' },
);
assert.equal(storageCalls.length, 0);
const issued = await fileActions.createProblemReportFileUploadTicket(ticket(ORGANIZATION_A, ownReportId));
assert.ok(issued.success);
assert.equal(
  storageCalls.at(-1),
  `sign ${ORGANIZATION_A}/problem-reports/${ownReportId}/${issued.ticket.fileId}/screenshot`,
);

const finalize = (organizationId: string, reportId: string) => ({
  organizationId,
  reportId,
  fileId,
  kind: 'screenshot' as const,
  fileName: 'bildschirm.png',
});
assert.deepEqual(
  await fileActions.finalizeProblemReportFileUpload(finalize(ORGANIZATION_A, colleagueReportId)),
  {
    success: false,
    error: 'report_not_found',
  },
);
assert.deepEqual(
  await fileActions.finalizeProblemReportFileUpload(finalize(ORGANIZATION_B, foreignReportId)),
  {
    success: false,
    error: 'not_a_member',
  },
);
assert.deepEqual(
  await fileActions.finalizeProblemReportFileUpload(finalize(ORGANIZATION_A, foreignReportId)),
  {
    success: false,
    error: 'report_not_found',
  },
);
assert.equal(world.rpcCalls.length, 0);
assert.ok(storageCalls.every((call) => !call.startsWith('promote')));

assert.deepEqual(await fileActions.finalizeProblemReportFileUpload(finalize(ORGANIZATION_A, ownReportId)), {
  success: true,
});
const ownPath = `${ORGANIZATION_A}/problem-reports/${ownReportId}/${fileId}/screenshot`;
assert.deepEqual(world.rpcCalls.at(-1)?.args, {
  p_actor_id: CALLER_ID,
  p_organization_id: ORGANIZATION_A,
  p_report_id: ownReportId,
  p_file_id: fileId,
  p_kind: 'screenshot',
  p_storage_path: `${ownPath}-copy`,
  p_file_name: 'bildschirm.png',
  p_mime_type: 'image/png',
  p_size_bytes: 2048,
  p_max_attachments: 5,
});

// Support: an allowlist that is missing or malformed refuses, a user outside
// it is refused, and a listed user opens a report of any organization with
// the opening in its history.
const supportCases: Array<[string | undefined, string]> = [
  [undefined, 'support_unavailable'],
  ['', 'support_unavailable'],
  [`${CALLER_ID},not-an-id`, 'support_unavailable'],
  [colleagueId, 'not_authorized'],
];
for (const role of ['employee', 'buero', 'admin'] as const) {
  signInAs(world, role);
  for (const [setting, error] of supportCases) {
    if (setting === undefined) delete process.env.SUPPORT_USER_IDS;
    else process.env.SUPPORT_USER_IDS = setting;
    assert.deepEqual(await supportActions.openProblemReportAsSupport(colleagueReportId), {
      success: false,
      error,
    });
  }
}
assert.equal(tableRows(world, 'problem_report_events').length, 0);

world.memberships = [];
process.env.SUPPORT_USER_IDS = `${colleagueId}, ${CALLER_ID}`;
const opened = await supportActions.openProblemReportAsSupport(foreignReportId);
assert.ok(opened.success);
assert.equal(opened.report.organizationId, ORGANIZATION_B);
assert.deepEqual(
  tableRows(world, 'problem_report_events').map((event) => [
    event.report_id,
    event.event_type,
    event.actor_id,
  ]),
  [[foreignReportId, 'original_opened', CALLER_ID]],
);
