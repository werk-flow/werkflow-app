// The actual problem-report actions over the in-memory database
// (werk-flow/werkflow-planning#331, #334). A report goes only into an
// organization where the caller is a member. An employee, a Büro member and
// an admin of the same organization list only their own reports, and get
// `report_not_found` for a colleague's report from the file ticket and the
// finalize. A file ticket and a finalize reach only a report the caller filed.
import assert from 'node:assert/strict';
import { mock } from 'bun:test';
import type { ProblemReportContext } from '@/lib/problem-reports/schemas';
import {
  CALLER_ID,
  ORGANIZATION_A,
  ORGANIZATION_B,
  installActionWorld,
  signInAs,
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
const report = (id: string, organizationId: string, reporterId: string, number: number) => ({
  id,
  number,
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

const world = installActionWorld({
  problem_reports: [
    report(ownReportId, ORGANIZATION_A, CALLER_ID, 1),
    report(colleagueReportId, ORGANIZATION_A, colleagueId, 2),
    report(foreignReportId, ORGANIZATION_B, colleagueId, 1),
  ],
  problem_report_files: [],
  problem_report_events: [],
});
world.rpc = ({ name }) => {
  assert.ok(name === 'submit_problem_report' || name === 'register_problem_report_file', name);
  return { data: name === 'submit_problem_report' ? 3 : null, error: null };
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

const newReportId = '33100000-0000-4000-8000-000000000025';
const submitCalls = () => world.rpcCalls.filter((call) => call.name === 'submit_problem_report');
const submission = (organizationId: string) => ({
  organizationId,
  reportId: newReportId,
  description: 'Die Liste bleibt leer.',
  context,
});

// Signed out, nothing is submitted, read or uploaded.
world.callerId = null;
assert.deepEqual(await actions.submitProblemReport(submission(ORGANIZATION_A)), {
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
assert.deepEqual(await actions.submitProblemReport(submission(ORGANIZATION_B)), {
  success: false,
  error: 'not_a_member',
});
assert.equal(submitCalls().length, 0);

// A member's report saves in their organization under the device's id, with the
// caller as reporter and filer.
const submitted = await actions.submitProblemReport(submission(ORGANIZATION_A));
assert.ok(submitted.success);
assert.equal(submitted.number, 3);
assert.equal(submitted.reportId, newReportId);
assert.deepEqual(submitCalls().at(-1)?.args, {
  p_report_id: newReportId,
  p_organization_id: ORGANIZATION_A,
  p_actor_id: CALLER_ID,
  p_description: 'Die Liste bleibt leer.',
  p_context: context,
});

// No role of the same organization lists a colleague's report, and the file
// actions answer `report_not_found` for it; each lists their own.
const ticket = (organizationId: string, reportId: string) => ({
  organizationId,
  reportId,
  kind: 'screenshot' as const,
  fileName: 'bildschirm.png',
  mimeType: 'image/png',
  fileSizeBytes: 2048,
});
const finalize = (organizationId: string, reportId: string) => ({
  organizationId,
  reportId,
  fileId,
  kind: 'screenshot' as const,
  fileName: 'bildschirm.png',
});
for (const role of ['employee', 'buero', 'admin'] as const) {
  signInAs(world, role);
  const list = await actions.listOwnProblemReports();
  assert.ok(list.success);
  assert.ok(list.reports.some((entry) => entry.id === ownReportId && entry.number === 1));
  assert.ok(list.reports.every((entry) => entry.id !== colleagueReportId && entry.id !== foreignReportId));
  assert.deepEqual(
    await fileActions.createProblemReportFileUploadTicket(ticket(ORGANIZATION_A, colleagueReportId)),
    { success: false, error: 'report_not_found' },
  );
  assert.deepEqual(
    await fileActions.finalizeProblemReportFileUpload(finalize(ORGANIZATION_A, colleagueReportId)),
    { success: false, error: 'report_not_found' },
  );
}

// A file ticket and a finalize reach no report of another organization.
signInAs(world, 'admin');
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
// A refused ticket or finalize touches no storage key, not even a staged one.
assert.equal(storageCalls.length, 0, `storage was touched: ${storageCalls.join(', ')}`);
const issued = await fileActions.createProblemReportFileUploadTicket(ticket(ORGANIZATION_A, ownReportId));
assert.ok(issued.success);
assert.equal(
  storageCalls.at(-1),
  `sign ${ORGANIZATION_A}/problem-reports/${ownReportId}/${issued.ticket.fileId}/screenshot`,
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
assert.equal(world.rpcCalls.filter((call) => call.name === 'register_problem_report_file').length, 0);
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
