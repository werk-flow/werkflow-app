// The actual submit action, the scrub of one stored report and the daily
// scrub run over the in-memory database (werk-flow/werkflow-planning#332).
// The receipt never waits for the scrub or fails with it. The dictionary of a
// scrub holds only its report's organization: a foreign organization's
// customer stays readable in the copy. The server removes a control label
// that is not one of the app's own UI strings. A dictionary that cannot be
// read, a scrub that throws and a context of another shape leave no copy and
// the failed state, and the report stays. The run scrubs every report with
// originals and no copy, each inside its own organization. Logs carry no
// report text. All names belong to made-up companies.
import assert from 'node:assert/strict';
import { mock } from 'bun:test';
import * as nextServer from 'next/server';
import type { ProblemReportContext } from '@/lib/problem-reports/schemas';
import {
  CALLER_ID,
  ORGANIZATION_A,
  ORGANIZATION_B,
  installActionWorld,
  signInAs,
  tableRows,
} from './action-boundary-world';

const id = (index: number): string => `33200000-0000-4000-8000-${String(index).padStart(12, '0')}`;
const ownCustomer = 'Erika Müller';
const foreignCustomer = 'Bodo Fremdmann';
// The reporting organization's own name is a term like a customer's; the other organization's name is not.
const ownOrganization = 'Sonnfeld Wärmetechnik GmbH';
const foreignOrganization = 'Fremdhaus Bäder GmbH';
const description = `Wir bei ${ownOrganization}, nicht ${foreignOrganization}: Bei ${ownCustomer} (0171 2345678) und bei ${foreignCustomer} speichert der Auftrag nicht.`;
const scrubbedDescription = `Wir bei [Kunde 1], nicht ${foreignOrganization}: Bei [Kunde 2] ([Telefon 1]) und bei ${foreignCustomer} speichert der Auftrag nicht.`;

const context: ProblemReportContext = {
  routeTemplate: '/auftraege/[jobNumber]',
  recentActions: [
    { routeTemplate: '/auftraege', controlLabel: 'Speichern' },
    // What a crafted client could send: a customer's name as the label.
    { routeTemplate: '/kunden', controlLabel: ownCustomer },
  ],
  clientErrors: [{ name: 'TypeError', code: null, digest: '1234', routeTemplate: '/auftraege/[jobNumber]' }],
  appVersion: '2026.11.11',
  device: { platform: 'android', browser: 'chrome', viewport: { width: 412, height: 915 } },
  offline: false,
};
const scrubbedContext = {
  ...context,
  recentActions: [
    { routeTemplate: '/auftraege', controlLabel: 'Speichern' },
    { routeTemplate: '/kunden', controlLabel: null },
  ],
};

const report = (reportId: string, organizationId: string, fields: Record<string, unknown> = {}) => ({
  id: reportId,
  organization_id: organizationId,
  reporter_id: CALLER_ID,
  filed_by_id: CALLER_ID,
  description,
  context,
  originals_deleted_at: null,
  scrubbed_description: null,
  scrubbed_context: null,
  scrub_state: 'ausstehend',
  ...fields,
});

const world = installActionWorld({
  organizations: [
    { id: ORGANIZATION_A, name: ownOrganization },
    { id: ORGANIZATION_B, name: foreignOrganization },
  ],
  problem_reports: [],
  clients: [
    { id: id(1), organization_id: ORGANIZATION_A, name: ownCustomer, address: null, phone: null },
    { id: id(2), organization_id: ORGANIZATION_B, name: foreignCustomer, address: null, phone: null },
  ],
  client_contacts: [],
  client_sites: [],
  client_requests: [],
  employee_records: [],
  organization_members: [{ id: id(3), organization_id: ORGANIZATION_A, user_id: CALLER_ID }],
  profiles: [{ id: CALLER_ID, first_name: 'Jonas', last_name: 'Weiß' }],
});
const reports = () => tableRows(world, 'problem_reports');
const stored = (reportId: string) => reports().find((row) => row.id === reportId);
// The two database functions, answered from the tables as supabase/tests/problem_reports.sql proves them.
world.rpc = ({ name, args }) => {
  const row = reports().find(
    (entry) => entry.id === args.p_report_id && entry.organization_id === args.p_organization_id,
  );
  if (name === 'submit_problem_report') {
    if (!row) {
      reports().push(
        report(String(args.p_report_id), String(args.p_organization_id), {
          description: args.p_description,
          context: args.p_context,
        }),
      );
    }
    return { data: 1, error: null };
  }
  assert.equal(name, 'record_problem_report_scrub');
  if (!row) return { data: null, error: { code: 'P0001', message: 'report_not_found' } };
  const copy = args.p_scrubbed_description !== null;
  const version = (value: unknown) => (typeof value === 'number' ? value : 0);
  if (
    row.scrub_state !== 'bereinigt' ||
    (copy && version(row.scrub_version) < version(args.p_scrub_version))
  ) {
    row.scrubbed_description = args.p_scrubbed_description;
    row.scrubbed_context = args.p_scrubbed_context;
    row.scrub_state = copy ? 'bereinigt' : 'nicht_bereinigbar';
    row.scrub_version = copy ? args.p_scrub_version : null;
  }
  return { data: row.scrub_state, error: null };
};
const scrubWrites = () => world.rpcCalls.filter((call) => call.name === 'record_problem_report_scrub');

const afterTasks: Array<() => Promise<unknown>> = [];
mock.module('next/server', () => ({
  ...nextServer,
  after: (task: () => Promise<unknown>) => {
    afterTasks.push(task);
  },
}));
const logged: string[] = [];
console.error = (...parts: unknown[]) => {
  logged.push(parts.map((part) => JSON.stringify(part)).join(' '));
};
// The build inlines the catalog; here the environment holds it.
const catalog = JSON.stringify(['Speichern']);
process.env.WERKFLOW_UI_STRING_CATALOG = catalog;

const actions = await import('@/lib/problem-reports/actions');
const { scrubStoredProblemReport, scrubPendingProblemReports } = await import(
  '@/lib/problem-reports/scrub/scrub-report'
);

/** Submits as a member of organization A and returns the scrub the action left for after the answer. */
async function submit(reportId: string) {
  signInAs(world, 'employee');
  afterTasks.length = 0;
  const result = await actions.submitProblemReport({
    organizationId: ORGANIZATION_A,
    reportId,
    description,
    context,
  });
  assert.ok(result.success, 'the submit failed');
  assert.equal(afterTasks.length, 1, 'the submit did not leave exactly one scrub');
  return afterTasks[0] ?? assert.fail('no scrub');
}

// The receipt comes first: the report is saved and still pending when the action answers.
const scrubSubmitted = await submit(id(10));
assert.equal(stored(id(10))?.scrub_state, 'ausstehend');
assert.equal(scrubWrites().length, 0, 'the receipt waited for the scrub');

// The scrub writes the copy and its state in one call, inside the caller's
// organization. Its own name, its own customer and the phone number are
// replaced; the foreign organization's name and customer stay, so the
// dictionary held only organization A. The crafted label is gone, the app's own label stays.
await scrubSubmitted();
assert.deepEqual(scrubWrites().at(-1)?.args, {
  p_organization_id: ORGANIZATION_A,
  p_report_id: id(10),
  p_scrubbed_description: scrubbedDescription,
  p_scrubbed_context: scrubbedContext,
  p_scrub_version: 1,
});
assert.equal(stored(id(10))?.scrub_state, 'bereinigt');
assert.equal(stored(id(10))?.description, description, 'the original changed');

// A refused submit leaves no scrub.
afterTasks.length = 0;
signInAs(world, 'employee');
const refused = await actions.submitProblemReport({
  organizationId: ORGANIZATION_B,
  reportId: id(11),
  description,
  context,
});
assert.deepEqual(refused, { success: false, error: 'not_a_member' });
assert.equal(afterTasks.length, 0);

// A report that has its copy keeps it: a second scrub reads no dictionary and writes nothing.
const writesBefore = scrubWrites().length;
world.failingTables.add('clients');
assert.equal(await scrubStoredProblemReport(ORGANIZATION_A, id(10)), true);
assert.equal(scrubWrites().length, writesBefore);

// Fails closed, and the receipt does not depend on it: with a dictionary read
// that fails, the submit succeeds, the report stays, and it has no copy.
const scrubUnreadable = await submit(id(12));
await scrubUnreadable();
assert.deepEqual(scrubWrites().at(-1)?.args, {
  p_organization_id: ORGANIZATION_A,
  p_report_id: id(12),
  p_scrubbed_description: null,
  p_scrubbed_context: null,
  p_scrub_version: 1,
});
assert.equal(stored(id(12))?.scrub_state, 'nicht_bereinigbar');
assert.equal(stored(id(12))?.description, description, 'the report was not kept');
world.failingTables.delete('clients');

// A scrub that throws fails closed too: without the UI string catalog nothing is copied.
delete process.env.WERKFLOW_UI_STRING_CATALOG;
reports().push(report(id(13), ORGANIZATION_A));
assert.equal(await scrubStoredProblemReport(ORGANIZATION_A, id(13)), false);
assert.equal(stored(id(13))?.scrub_state, 'nicht_bereinigbar');
assert.equal(stored(id(13))?.scrubbed_description, null);
process.env.WERKFLOW_UI_STRING_CATALOG = catalog;

// A stored context of another shape is never copied: not one with another
// field, and not a part of a capture.
reports().push(
  report(id(14), ORGANIZATION_A, { context: { ...context, customer: ownCustomer } }),
  report(id(18), ORGANIZATION_A, { context: { appVersion: 'Erika.Mueller' } }),
);
for (const reportId of [id(14), id(18)]) {
  assert.equal(await scrubStoredProblemReport(ORGANIZATION_A, reportId), false);
  assert.equal(stored(reportId)?.scrub_state, 'nicht_bereinigbar');
  assert.equal(stored(reportId)?.scrubbed_context, null);
}

// A report of another organization is not found: nothing is read into a copy, nothing is written.
reports().push(report(id(15), ORGANIZATION_B));
const writesBeforeForeign = scrubWrites().length;
assert.equal(await scrubStoredProblemReport(ORGANIZATION_A, id(15)), false);
assert.equal(scrubWrites().length, writesBeforeForeign);
assert.equal(stored(id(15))?.scrub_state, 'ausstehend');

// The daily run scrubs every report with originals and no copy, page by page:
// the failed ones again, the pending one of organization B with B's own
// dictionary, and a report filed without a capture. A report whose originals
// the deletion run removed before any scrub succeeded keeps no text: it ends
// as `nicht_bereinigbar`, with no copy. One that already failed is left alone.
const orphaned = { description: null, context: null, originals_deleted_at: '2026-11-01' };
reports().push(
  report(id(16), ORGANIZATION_A, orphaned),
  report(id(19), ORGANIZATION_A, { ...orphaned, scrub_state: 'nicht_bereinigbar' }),
  report(id(17), ORGANIZATION_A, { context: {} }),
  ...Array.from({ length: 100 }, (_, index) => report(id(100 + index), ORGANIZATION_A)),
);
const run = await scrubPendingProblemReports();
// Reports 14 and 18 keep their foreign shape, so they stay without a copy; 16 has no text left.
assert.deepEqual(run, { ok: true, scrubbed: 104, notScrubbed: 3 });
assert.equal(stored(id(12))?.scrubbed_description, scrubbedDescription);
assert.equal(stored(id(13))?.scrub_state, 'bereinigt');
assert.equal(stored(id(14))?.scrub_state, 'nicht_bereinigbar');
assert.equal(
  stored(id(15))?.scrubbed_description,
  `Wir bei ${ownOrganization}, nicht [Kunde 1]: Bei ${ownCustomer} ([Telefon 1]) und bei [Kunde 2] speichert der Auftrag nicht.`,
  "organization B's report was not scrubbed with B's own dictionary",
);
assert.equal(stored(id(16))?.scrub_state, 'nicht_bereinigbar');
assert.equal(stored(id(16))?.scrubbed_description, null);
assert.equal(stored(id(16))?.scrubbed_context, null);
assert.ok(
  scrubWrites().every((call) => call.args.p_report_id !== id(19)),
  'the run wrote a report whose originals are gone and whose state was already final',
);
assert.deepEqual(stored(id(17))?.scrubbed_context, {});
assert.equal(stored(id(199))?.scrub_state, 'bereinigt', 'the run stopped after its first page');

// The next run leaves the orphaned report alone and does not fail; only 14 and 18 are tried again.
const writesBeforeNextRun = scrubWrites().length;
assert.deepEqual(await scrubPendingProblemReports(), { ok: true, scrubbed: 0, notScrubbed: 2 });
assert.deepEqual(
  scrubWrites()
    .slice(writesBeforeNextRun)
    .map((call) => call.args.p_report_id),
  [id(14), id(18)],
);

// A run that cannot list its reports says so.
world.failingTables.add('problem_reports');
assert.deepEqual(await scrubPendingProblemReports(), { ok: false, scrubbed: 0, notScrubbed: 0 });
world.failingTables.delete('problem_reports');

// The failures were logged, by code only: no name, number or report text.
assert.ok(logged.length >= 4, 'a failed scrub was not logged');
for (const line of logged) {
  for (const secret of ['Müller', 'Fremdmann', '2345678', 'speichert', id(12)]) {
    assert.ok(!line.includes(secret), `a log line carried "${secret}"`);
  }
}
