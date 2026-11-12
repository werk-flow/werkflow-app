// The actual today snapshot handler (GET /api/field-sync/v1/today) over the
// in-memory database. A phone keeps only the caller's own job visits on the
// current Berlin day, with the field facts of the online work pack and no
// office-only column: another person's assignment, a visit on a job the
// caller is not assigned to, another day and another organization stay out.
// An organization hint naming another organization, a revoked membership and
// a missing or cross-site identity are refused; a bearer token and a cookie
// reach the same snapshot; an unchanged day answers 304 and a changed office
// instruction a new version; a failed read is a retry, never a shorter day.
import assert from 'node:assert/strict';
import { formatBerlinLocalDate, getLocalDayEnd, getLocalDayStart } from '@/lib/date-time/berlin';
import { fieldSyncTodaySchema } from '@/lib/field-sync/today-snapshot';
import {
  CALLER_ID,
  ORGANIZATION_A,
  ORGANIZATION_B,
  installActionWorld,
  signInAs,
} from './action-boundary-world';

const otherUserId = '8e000000-0000-4000-8000-000000000002';
const ownRecord = '8e000000-0000-4000-8000-000000000011';
const otherRecord = '8e000000-0000-4000-8000-000000000012';
const foreignRecord = '8e000000-0000-4000-8000-000000000013';
const ownJob = '8e000000-0000-4000-8000-000000000021';
const othersJob = '8e000000-0000-4000-8000-000000000022';
const unassignedJob = '8e000000-0000-4000-8000-000000000023';
const tomorrowJob = '8e000000-0000-4000-8000-000000000024';
const foreignJob = '8e000000-0000-4000-8000-000000000025';
const projectJob = '8e000000-0000-4000-8000-000000000026';
const clientId = '8e000000-0000-4000-8000-000000000031';
const projectClientId = '8e000000-0000-4000-8000-000000000032';
const siteId = '8e000000-0000-4000-8000-000000000041';
const contactId = '8e000000-0000-4000-8000-000000000051';
const projectId = '8e000000-0000-4000-8000-000000000061';
const accessToken = 'fixture-access-token';

/** Office-only values: none may appear anywhere in a snapshot. */
const OFFICE_ONLY = [
  'kunde-buero@example.test',
  'KD-OFFICE-0001',
  'Kundennotiz nur fürs Büro',
  'Einsatzort-Notiz nur fürs Büro',
  'kontakt-buero@example.test',
  'Kontaktnotiz nur fürs Büro',
  'Projektkunde',
];

const dayStart = getLocalDayStart(new Date());
const today = formatBerlinLocalDate(dayStart);
const at = (hours: number): string => new Date(dayStart.getTime() + hours * 3_600_000).toISOString();

function job(id: string, organizationId: string, title: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    organization_id: organizationId,
    job_number: `AUF-${id.slice(-2)}`,
    title,
    description: `Ziel von ${title}`,
    priority: 'mittel',
    planned_working_minutes: 90,
    location: null,
    client_id: null,
    project_id: null,
    site_id: null,
    contact_id: null,
    estimated_duration_minutes: 120,
    created_by: otherUserId,
    ...extra,
  };
}

function visit(id: string, organizationId: string, jobId: string, record: string, hours: [number, number]) {
  return {
    id,
    organization_id: organizationId,
    job_id: jobId,
    entry_kind: 'job_visit',
    status: 'scheduled',
    time_kind: 'timed',
    start_at: at(hours[0]),
    end_at: at(hours[1]),
    start_date: null,
    end_date_exclusive: null,
    assignee: [{ employee_record_id: record }],
  };
}

const world = installActionWorld({
  employee_records: [
    { id: ownRecord, organization_id: ORGANIZATION_A, user_id: CALLER_ID },
    { id: otherRecord, organization_id: ORGANIZATION_A, user_id: otherUserId },
    { id: foreignRecord, organization_id: ORGANIZATION_B, user_id: CALLER_ID },
  ],
  jobs: [
    job(ownJob, ORGANIZATION_A, 'Heizung tauschen', {
      client_id: clientId,
      site_id: siteId,
      contact_id: contactId,
    }),
    job(othersJob, ORGANIZATION_A, 'Auftrag eines Kollegen'),
    job(unassignedJob, ORGANIZATION_A, 'Besuch ohne Zuweisung'),
    job(tomorrowJob, ORGANIZATION_A, 'Auftrag von morgen'),
    job(foreignJob, ORGANIZATION_B, 'Auftrag der anderen Firma'),
    job(projectJob, ORGANIZATION_A, 'Bad im Projekt', { client_id: clientId, project_id: projectId }),
  ],
  job_assignments: [
    {
      id: '8e000000-0000-4000-8000-000000000071',
      organization_id: ORGANIZATION_A,
      job_id: ownJob,
      user_id: CALLER_ID,
    },
    {
      id: '8e000000-0000-4000-8000-000000000072',
      organization_id: ORGANIZATION_A,
      job_id: othersJob,
      user_id: otherUserId,
    },
    {
      id: '8e000000-0000-4000-8000-000000000073',
      organization_id: ORGANIZATION_A,
      job_id: tomorrowJob,
      user_id: CALLER_ID,
    },
    {
      id: '8e000000-0000-4000-8000-000000000074',
      organization_id: ORGANIZATION_B,
      job_id: foreignJob,
      user_id: CALLER_ID,
    },
    {
      id: '8e000000-0000-4000-8000-000000000075',
      organization_id: ORGANIZATION_A,
      job_id: projectJob,
      user_id: CALLER_ID,
    },
  ],
  planning_occurrences: [
    visit('8e000000-0000-4000-8000-000000000081', ORGANIZATION_A, ownJob, ownRecord, [13, 15]),
    visit('8e000000-0000-4000-8000-000000000082', ORGANIZATION_A, othersJob, otherRecord, [8, 10]),
    visit('8e000000-0000-4000-8000-000000000083', ORGANIZATION_A, unassignedJob, ownRecord, [8, 9]),
    visit('8e000000-0000-4000-8000-000000000084', ORGANIZATION_A, tomorrowJob, ownRecord, [32, 34]),
    visit('8e000000-0000-4000-8000-000000000085', ORGANIZATION_B, foreignJob, foreignRecord, [9, 10]),
    visit('8e000000-0000-4000-8000-000000000086', ORGANIZATION_A, projectJob, ownRecord, [7, 9]),
    {
      ...visit('8e000000-0000-4000-8000-000000000087', ORGANIZATION_A, ownJob, ownRecord, [16, 17]),
      status: 'cancelled',
    },
  ],
  clients: [
    {
      id: clientId,
      organization_id: ORGANIZATION_A,
      name: 'Familie Muster',
      phone: '+49 30 1234567',
      email: 'kunde-buero@example.test',
      customer_number: 'KD-OFFICE-0001',
      notes: 'Kundennotiz nur fürs Büro',
    },
    { id: projectClientId, organization_id: ORGANIZATION_A, name: 'Hausverwaltung Beispiel', phone: null },
  ],
  projects: [
    {
      id: projectId,
      organization_id: ORGANIZATION_A,
      name: 'Sanierung Musterweg',
      project_number: 'PRJ-2026-7',
      client_id: projectClientId,
      description: 'Projektkunde',
    },
  ],
  client_sites: [
    {
      id: siteId,
      organization_id: ORGANIZATION_A,
      client_id: clientId,
      name: 'Wohnhaus',
      street: 'Musterweg 1',
      postal_code: '10115',
      city: 'Berlin',
      access_notes: 'Schlüssel beim Hausmeister',
      notes: 'Einsatzort-Notiz nur fürs Büro',
    },
  ],
  client_contacts: [
    {
      id: contactId,
      organization_id: ORGANIZATION_A,
      client_id: clientId,
      name: 'Erika Muster',
      role: 'Eigentümerin',
      phone: '+49 170 7654321',
      email: 'kontakt-buero@example.test',
      notes: 'Kontaktnotiz nur fürs Büro',
    },
  ],
  job_instruction_items: [
    {
      id: '8e000000-0000-4000-8000-000000000092',
      organization_id: ORGANIZATION_A,
      job_id: ownJob,
      content: 'Druckprobe dokumentieren',
      group_label: 'Abschluss',
      notes: null,
      requirement_state: 'required',
      is_completed: false,
      sort_order: 2,
    },
    {
      id: '8e000000-0000-4000-8000-000000000091',
      organization_id: ORGANIZATION_A,
      job_id: ownJob,
      content: 'Wasser absperren',
      group_label: null,
      notes: 'Haupthahn im Keller',
      requirement_state: 'optional',
      is_completed: true,
      sort_order: 1,
    },
    {
      id: '8e000000-0000-4000-8000-000000000093',
      organization_id: ORGANIZATION_A,
      job_id: othersJob,
      content: 'Anweisung eines Kollegen',
      group_label: null,
      notes: null,
      requirement_state: 'required',
      is_completed: false,
      sort_order: 1,
    },
  ],
});
world.accessTokens = { [accessToken]: CALLER_ID };

const { GET } = await import('@/app/api/field-sync/v1/today/route');

function cookieRequest(query = '', headers: Record<string, string> = {}, site = 'same-origin'): Request {
  return new Request(`http://localhost/api/field-sync/v1/today${query}`, {
    headers: { 'content-type': 'application/json', 'sec-fetch-site': site, ...headers },
  });
}

function bearerRequest(token = accessToken): Request {
  return new Request('http://localhost/api/field-sync/v1/today', {
    headers: { authorization: `Bearer ${token}` },
  });
}

async function expectRefusal(response: Response, status: number, verdict: Record<string, string>) {
  assert.equal(response.status, status);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(await response.json(), verdict);
}

// The caller's own day: only the assigned job with a scheduled visit today,
// in start order, with the field facts and the instructions in their order.
signInAs(world, 'employee');
const response = await GET(cookieRequest());
assert.equal(response.status, 200);
assert.equal(response.headers.get('cache-control'), 'private, no-store');
const text = await response.text();
const snapshot = fieldSyncTodaySchema.parse(JSON.parse(text));
assert.equal(snapshot.berlinDate, today);
assert.equal(
  snapshot.validUntil,
  new Date(getLocalDayEnd(dayStart).getTime() + 1).toISOString(),
  'the snapshot ends at the next Berlin midnight',
);
assert.equal(snapshot.userId, CALLER_ID);
assert.equal(snapshot.organizationId, ORGANIZATION_A);
assert.equal(response.headers.get('etag'), `"${snapshot.version}"`);
assert.deepEqual(
  snapshot.assignments.map((assignment) => assignment.jobId),
  [projectJob, ownJob],
  "the day holds another person's assignment, an unassigned visit, another day or another organization",
);
const [projectAssignment, ownAssignment] = snapshot.assignments;
assert.deepEqual(ownAssignment, {
  jobId: ownJob,
  jobNumber: 'AUF-21',
  title: 'Heizung tauschen',
  requestedOutcome: 'Ziel von Heizung tauschen',
  plannedWorkingMinutes: 90,
  visits: [{ startAt: at(13), endAt: at(15) }],
  customerName: 'Familie Muster',
  customerPhone: '+49 30 1234567',
  siteName: 'Wohnhaus',
  siteAddress: 'Musterweg 1, 10115 Berlin',
  accessNotes: 'Schlüssel beim Hausmeister',
  contactName: 'Erika Muster',
  contactRole: 'Eigentümerin',
  contactPhone: '+49 170 7654321',
  project: null,
  instructions: [
    {
      id: '8e000000-0000-4000-8000-000000000091',
      content: 'Wasser absperren',
      groupLabel: null,
      notes: 'Haupthahn im Keller',
      required: false,
      done: true,
    },
    {
      id: '8e000000-0000-4000-8000-000000000092',
      content: 'Druckprobe dokumentieren',
      groupLabel: 'Abschluss',
      notes: null,
      required: true,
      done: false,
    },
  ],
});
// A job in a project shows the project's customer, as the online pack does.
assert.equal(projectAssignment?.customerName, 'Hausverwaltung Beispiel');
assert.deepEqual(projectAssignment?.project, { name: 'Sanierung Musterweg', projectNumber: 'PRJ-2026-7' });
for (const value of [
  ...OFFICE_ONLY,
  'Auftrag eines Kollegen',
  'Anweisung eines Kollegen',
  'Auftrag der anderen Firma',
])
  assert.ok(!text.includes(value), `the snapshot carries an office-only or foreign value: ${value}`);
for (const column of [
  'email',
  'customerNumber',
  'customer_number',
  'estimated_duration_minutes',
  'createdBy',
])
  assert.ok(!text.includes(`"${column}"`), `the snapshot carries the office-only field ${column}`);

// A bearer token reaches the same snapshot without a cookie session.
world.callerId = null;
const viaBearer = await GET(bearerRequest());
assert.equal(viaBearer.status, 200);
assert.deepEqual(await viaBearer.json(), snapshot);
await expectRefusal(await GET(bearerRequest('wrong-token')), 401, {
  outcome: 'retry',
  code: 'unauthenticated',
});
await expectRefusal(await GET(cookieRequest()), 401, { outcome: 'retry', code: 'unauthenticated' });
signInAs(world, 'employee');
await expectRefusal(await GET(cookieRequest('', {}, 'cross-site')), 403, {
  outcome: 'rejected',
  code: 'forbidden',
});

// An unchanged day answers 304; a changed office instruction is a new version on the next refresh.
const notModified = await GET(cookieRequest('', { 'if-none-match': `"${snapshot.version}"` }));
assert.equal(notModified.status, 304);
assert.equal(notModified.headers.get('cache-control'), 'private, no-store');
assert.equal(await notModified.text(), '');
const instruction = world.tables.job_instruction_items?.find(
  (item) => item.content === 'Druckprobe dokumentieren',
);
assert.ok(instruction);
instruction.content = 'Druckprobe mit 6 bar dokumentieren';
const changed = await GET(cookieRequest('', { 'if-none-match': `"${snapshot.version}"` }));
assert.equal(changed.status, 200);
const changedSnapshot = fieldSyncTodaySchema.parse(await changed.json());
assert.notEqual(changedSnapshot.version, snapshot.version);
assert.ok(
  changedSnapshot.assignments[1]?.instructions.some(
    (item) => item.content === 'Druckprobe mit 6 bar dokumentieren',
  ),
);

// The organization hint is never a switch: another organization is refused,
// also one the caller belongs to but is not active in; a malformed hint is invalid.
await expectRefusal(await GET(cookieRequest(`?organizationId=${ORGANIZATION_B}`)), 403, {
  outcome: 'rejected',
  code: 'organization_mismatch',
});
world.memberships = [
  { orgId: ORGANIZATION_A, role: 'employee' },
  { orgId: ORGANIZATION_B, role: 'employee' },
];
await expectRefusal(await GET(cookieRequest(`?organizationId=${ORGANIZATION_B}`)), 403, {
  outcome: 'rejected',
  code: 'organization_mismatch',
});
await expectRefusal(await GET(cookieRequest('?organizationId=not-an-id')), 400, {
  outcome: 'rejected',
  code: 'invalid',
});
assert.equal((await GET(cookieRequest(`?organizationId=${ORGANIZATION_A}`))).status, 200);

// After a switch, the day is the other organization's, and only that.
world.activeOrganizationCookie = ORGANIZATION_B;
const switched = fieldSyncTodaySchema.parse(await (await GET(cookieRequest())).json());
assert.equal(switched.organizationId, ORGANIZATION_B);
assert.deepEqual(
  switched.assignments.map((assignment) => assignment.jobId),
  [foreignJob],
);

// A revoked membership reads no organization's day, through either identity.
world.memberships = [];
await expectRefusal(await GET(cookieRequest()), 403, { outcome: 'rejected', code: 'forbidden' });
await expectRefusal(await GET(bearerRequest()), 403, { outcome: 'rejected', code: 'forbidden' });

// A failed read is a retry, never a shorter day.
signInAs(world, 'employee');
for (const table of [
  'employee_records',
  'planning_occurrences',
  'job_assignments',
  'job_instruction_items',
  'client_sites',
]) {
  world.failingTables.add(table);
  await expectRefusal(await GET(cookieRequest()), 503, { outcome: 'retry', code: 'unavailable' });
  world.failingTables.delete(table);
}
assert.equal((await GET(cookieRequest())).status, 200);
