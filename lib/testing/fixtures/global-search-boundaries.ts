// The header search over the in-memory database, through the real domain
// readers. The list functions answer from the world's tables by organization,
// role and a plain text match; their own matching rules are SQL-tested
// (supabase/tests/global_search_matches.sql, operational_list_pages.sql).
// Proves: identity, organization and role come from the session; a matching
// record of another organization is never a hit; an employee reaches only
// their assigned jobs and no customer, request, Anlage or document; no role
// reads a Mitarbeiter, time, absence, sickness, qualification or price table;
// a failed source fails only its own groups, and a retry reads only it;
// Ansprechpartner and Einsatzorte are found under any matching customer, not
// only under the first page of matching customers.
import assert from 'node:assert/strict';
import {
  CALLER_ID,
  ORGANIZATION_A,
  ORGANIZATION_B,
  installActionWorld,
  signInAs,
  tableRows,
} from './action-boundary-world';

type Row = Record<string, unknown>;

const coworkerId = '31000000-0000-4000-8000-000000000001';
const ids = {
  client: '34000000-0000-4000-8000-000000000001',
  foreignClient: '34000000-0000-4000-8000-000000000002',
  assignedJob: '35000000-0000-4000-8000-000000000001',
  coworkerJob: '35000000-0000-4000-8000-000000000002',
  foreignJob: '35000000-0000-4000-8000-000000000003',
  request: '36000000-0000-4000-8000-000000000001',
  foreignRequest: '36000000-0000-4000-8000-000000000002',
  contact: '37000000-0000-4000-8000-000000000001',
  foreignContact: '37000000-0000-4000-8000-000000000002',
  site: '38000000-0000-4000-8000-000000000001',
  foreignSite: '38000000-0000-4000-8000-000000000002',
  seventhClient: '34000000-0000-4000-8000-000000000017',
  seventhContact: '37000000-0000-4000-8000-000000000017',
  foreignMuellerContact: '37000000-0000-4000-8000-000000000018',
} as const;
let query = 'Lindenhof';
const createdAt = '2026-11-02T08:00:00.000Z';

function client(id: string, organizationId: string, name = 'Hausverwaltung Lindenhof GmbH'): Row {
  return {
    id,
    organization_id: organizationId,
    name,
    client_type: 'gewerblich',
    customer_number: 'K-1001',
    email: null,
    phone: '0711 12345',
    address: 'Lindenstraße 1, 70173 Stuttgart',
    notes: null,
    archived_at: null,
    created_at: createdAt,
    updated_at: createdAt,
  };
}

function contact(id: string, organizationId: string, clientId: string, name: string, email: string): Row {
  return {
    id,
    organization_id: organizationId,
    client_id: clientId,
    name,
    email,
    phone: '030 4440777',
    is_active: true,
  };
}

function site(id: string, organizationId: string, clientId: string): Row {
  return {
    id,
    organization_id: organizationId,
    client_id: clientId,
    name: 'Wohnanlage Lindenhof',
    street: 'Lindenstraße 3',
    postal_code: '70173',
    city: 'Stuttgart',
    is_active: true,
  };
}

// Six customers „Müller“ fill the customer page of five; a seventh holds the contact „Müller“.
const muellerClients = [1, 2, 3, 4, 5, 6].map((n) =>
  client(`34000000-0000-4000-8000-00000000001${n}`, ORGANIZATION_A, `Müller Haustechnik ${n}`),
);

function job(id: string, organizationId: string, title: string, assignee: string): Row[] {
  return [
    {
      id,
      organization_id: organizationId,
      project_id: null,
      client_id: organizationId === ORGANIZATION_A ? ids.client : ids.foreignClient,
      job_number: `A-${id.slice(-1)}`,
      title,
      description: null,
      status: 'nicht_bearbeitet',
      created_at: createdAt,
      updated_at: createdAt,
    },
    {
      id: `${id.slice(0, -2)}9${id.slice(-1)}`,
      organization_id: organizationId,
      job_id: id,
      user_id: assignee,
    },
  ];
}

function request(id: string, organizationId: string): Row {
  return {
    id,
    organization_id: organizationId,
    request_number: 'ANF-2026-0007',
    client_id: null,
    contact_id: null,
    site_id: null,
    equipment_id: null,
    caller_name: 'Erika Musterfrau',
    caller_phone: '0711 12345',
    caller_email: null,
    caller_address: null,
    summary: 'Heizung Lindenhof ausgefallen',
    details: null,
    category: 'stoerung',
    urgency: 'normal',
    source: 'telefon',
    status: 'offen',
    assigned_to: null,
    received_at: createdAt,
    callback_due_at: null,
    closed_reason: null,
    closed_note: null,
    closed_by: null,
    closed_at: null,
    converted_job_id: null,
    converted_project_id: null,
    converted_by: null,
    converted_at: null,
    created_by: CALLER_ID,
    created_at: createdAt,
    updated_at: createdAt,
  };
}

const [assignedJob, assignedLink] = job(ids.assignedJob, ORGANIZATION_A, 'Wartung Lindenhof', CALLER_ID);
const [coworkerJob, coworkerLink] = job(ids.coworkerJob, ORGANIZATION_A, 'Bad Lindenhof', coworkerId);
const [foreignJob, foreignLink] = job(ids.foreignJob, ORGANIZATION_B, 'Fremd Lindenhof', CALLER_ID);

// The tables no search source may read: each read fails, so a source that
// touched one would come back failed.
const NEVER_READ = [
  'employee_records',
  'personnel_documents',
  'time_entries',
  'time_sessions',
  'vacation_requests',
  'sickness_reports',
  'employee_capabilities',
  'qualifications',
  'inventory_article_prices',
  'price_catalog_entries',
];

const world = installActionWorld({
  clients: [
    client(ids.client, ORGANIZATION_A),
    client(ids.foreignClient, ORGANIZATION_B),
    ...muellerClients,
    client(ids.seventhClient, ORGANIZATION_A, 'Sonnenberg Wohnbau GmbH'),
  ],
  client_contacts: [
    contact(ids.contact, ORGANIZATION_A, ids.client, 'Max Mustermann', 'max@lindenhof.example'),
    contact(ids.foreignContact, ORGANIZATION_B, ids.foreignClient, 'Max Mustermann', 'max@lindenhof.example'),
    contact(
      ids.seventhContact,
      ORGANIZATION_A,
      ids.seventhClient,
      'Erika Müller',
      'erika@sonnenberg.example',
    ),
    contact(
      ids.foreignMuellerContact,
      ORGANIZATION_B,
      ids.foreignClient,
      'Erika Müller',
      'erika@sonnenberg.example',
    ),
  ],
  client_sites: [
    site(ids.site, ORGANIZATION_A, ids.client),
    site(ids.foreignSite, ORGANIZATION_B, ids.foreignClient),
  ],
  jobs: [assignedJob, coworkerJob, foreignJob].flatMap((row) => (row ? [row] : [])),
  job_assignments: [assignedLink, coworkerLink, foreignLink].flatMap((row) => (row ? [row] : [])),
  projects: [],
  client_requests: [request(ids.request, ORGANIZATION_A), request(ids.foreignRequest, ORGANIZATION_B)],
  installed_equipment: [],
  ordinary_documents: [],
});
for (const table of NEVER_READ) world.failingTables.add(table);

const failingFunctions = new Set<string>();
const matches = (value: unknown): boolean =>
  typeof value === 'string' && value.toLowerCase().includes(query.toLowerCase());
const limited = <T>(rows: T[], limit: unknown): T[] => rows.slice(0, Number(limit));
const inOrganization = (table: string, organizationId: unknown): Row[] =>
  tableRows(world, table).filter((row) => row.organization_id === organizationId);

function jobEntriesPage(args: Row) {
  const visible = inOrganization('jobs', args.p_organization_id).filter(
    (row) =>
      args.p_is_manager === true ||
      tableRows(world, 'job_assignments').some(
        (link) => link.job_id === row.id && link.user_id === args.p_user_id,
      ),
  );
  const entries = visible
    .filter((row) => matches(row.title) || matches(row.job_number))
    .map((row) => ({
      id: row.id,
      type: 'standalone-job',
      jobCount: 0,
      completedJobCount: 0,
      inProgressJobCount: 0,
      parkedJobCount: 0,
      assignedUserIds: [],
    }));
  const section = (rows: typeof entries) => ({
    entries: rows,
    total: rows.length,
    sectionTotal: rows.length,
    statusCounts: { alle: rows.length, not_started: 0, in_progress: 0, interrupted: 0 },
  });
  return { active: section(entries), parked: section([]), archived: section([]) };
}

world.rpc = ({ name, args }) => {
  if (failingFunctions.has(name)) return { data: null, error: { message: 'private provider detail' } };
  const search = String(args.p_search ?? '');
  assert.equal(search === '' || search === query, true, `${name} searches the query`);
  if (name === 'list_customer_page') {
    const matching = inOrganization('clients', args.p_organization_id)
      .filter(
        (row) =>
          matches(row.name) ||
          tableRows(world, 'client_contacts').some((link) => link.client_id === row.id && matches(link.name)),
      )
      .toSorted((left, right) => String(left.name).localeCompare(String(right.name), 'de'));
    const clients = limited(matching, args.p_page_size).map((row) => ({
      id: row.id,
      organizationId: row.organization_id,
      name: row.name,
      clientType: row.client_type,
      customerNumber: row.customer_number,
      email: row.email,
      phone: row.phone,
      address: row.address,
      notes: row.notes,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      matchedSites: [],
      matchedSiteTotal: 0,
    }));
    return { data: { total: matching.length, clients }, error: null };
  }
  if (name === 'search_customer_sites_and_contacts') {
    const owner = (clientId: unknown) =>
      inOrganization('clients', args.p_organization_id).find((row) => row.id === clientId);
    const shape = (row: Row) => ({
      id: row.id,
      organizationId: row.organization_id,
      name: row.name,
      clientId: row.client_id,
      clientName: owner(row.client_id)?.name,
    });
    const sites = inOrganization('client_sites', args.p_organization_id)
      .filter((row) => matches(row.name) || matches(row.street))
      .map((row) => ({ ...shape(row), street: row.street, postalCode: row.postal_code, city: row.city }));
    const contacts = inOrganization('client_contacts', args.p_organization_id)
      .filter((row) => matches(row.name) || matches(row.email))
      .map((row) => ({ ...shape(row), email: row.email, phone: row.phone }));
    return {
      data: { sites: limited(sites, args.p_limit), contacts: limited(contacts, args.p_limit) },
      error: null,
    };
  }
  if (name === 'list_job_entries_page') return { data: jobEntriesPage(args), error: null };
  if (name === 'list_request_page') {
    const rows = inOrganization('client_requests', args.p_organization_id)
      .filter((row) => matches(row.summary))
      .map((row) => ({
        id: row.id,
        clientName: null,
        hasAssignee: false,
        assigneeFirstName: null,
        assigneeLastName: null,
        assigneeEmail: null,
        jobNumber: null,
        jobTitle: null,
        projectNumber: null,
        projectName: null,
      }));
    return { data: { total: rows.length, hasAny: true, rows }, error: null };
  }
  if (name === 'list_equipment_page') return { data: { total: 0, hasAny: false, ids: [] }, error: null };
  if (name === 'list_document_page') return { data: { total: 0, ids: [] }, error: null };
  throw new Error(`The search called ${name}`);
};

const { searchEverywhere } = await import('@/lib/search/global-search-server');

const LIST_FUNCTIONS = [
  'list_customer_page',
  'search_customer_sites_and_contacts',
  'list_job_entries_page',
  'list_request_page',
  'list_equipment_page',
  'list_document_page',
];

async function search(
  input: {
    organizationId?: string;
    sources?: Array<'kunden' | 'auftraege' | 'anfragen' | 'anlagen' | 'dokumente'>;
  } = {},
) {
  world.rpcCalls = [];
  return searchEverywhere({ organizationId: ORGANIZATION_A, query, ...input });
}

function hitIds(result: Awaited<ReturnType<typeof search>>): string[] {
  assert.equal(result.success, true, JSON.stringify(result));
  if (!result.success) return [];
  return result.groups.flatMap((group) => (group.status === 'loaded' ? group.hits.map((hit) => hit.id) : []));
}

// Signed out: a failure the person sees, never an empty result, and no read.
signInAs(world, null);
world.callerId = null;
assert.deepEqual(await search(), { success: false, error: 'not_authenticated' });
assert.equal(world.rpcCalls.length, 0);

for (const role of ['admin', 'buero'] as const) {
  signInAs(world, role);
  // Every domain, each through its own list reader, for the session's organization only.
  const result = await search();
  assert.equal(result.success, true);
  if (!result.success) throw new Error('unreachable');
  assert.deepEqual(
    result.groups.map((group) => [group.kind, group.status]),
    [
      ['kunden', 'loaded'],
      ['einsatzorte', 'loaded'],
      ['ansprechpartner', 'loaded'],
      ['auftraege', 'loaded'],
      ['anfragen', 'loaded'],
      ['anlagen', 'loaded'],
      ['dokumente', 'loaded'],
    ],
    `${role} searches every domain and reads no HR, time or price table`,
  );
  assert.deepEqual(world.rpcCalls.map((call) => call.name).toSorted(), LIST_FUNCTIONS.toSorted());
  for (const call of world.rpcCalls) assert.equal(call.args.p_organization_id, ORGANIZATION_A, call.name);
  const found = hitIds(result);
  assert.deepEqual(
    found.toSorted(),
    [ids.client, ids.site, ids.contact, ids.assignedJob, ids.coworkerJob, ids.request].toSorted(),
  );
  for (const foreign of [
    ids.foreignClient,
    ids.foreignContact,
    ids.foreignSite,
    ids.foreignJob,
    ids.foreignRequest,
  ])
    assert.equal(found.includes(foreign), false, `${role} finds no record of another organization`);
  for (const group of result.groups) {
    if (group.status !== 'loaded') continue;
    for (const hit of group.hits)
      assert.deepEqual(Object.keys(hit).toSorted(), ['detail', 'href', 'id', 'title']);
  }

  // The organization the client names must be the session's; it never selects one.
  assert.deepEqual(await search({ organizationId: ORGANIZATION_B }), {
    success: false,
    error: 'organization_changed',
  });
  assert.equal(world.rpcCalls.length, 0);
}

// A failed source fails its own groups; the others still answer.
signInAs(world, 'buero');
failingFunctions.add('list_document_page');
const partial = await search();
assert.equal(partial.success, true);
if (!partial.success) throw new Error('unreachable');
assert.deepEqual(
  partial.groups.filter((group) => group.status === 'failed').map((group) => group.kind),
  ['dokumente'],
);
failingFunctions.clear();
// A customer read that answers another organization's row is a failure, never a hit.
const foreignAnswer = world.rpc;
for (const customerRead of ['list_customer_page', 'search_customer_sites_and_contacts']) {
  world.rpc = (call) =>
    call.name === customerRead
      ? foreignAnswer({ ...call, args: { ...call.args, p_organization_id: ORGANIZATION_B } })
      : foreignAnswer(call);
  const scoped = await search({ sources: ['kunden'] });
  assert.equal(scoped.success, true);
  if (!scoped.success) throw new Error('unreachable');
  assert.deepEqual(
    scoped.groups.map((group) => [group.kind, group.status]),
    [
      ['kunden', 'failed'],
      ['einsatzorte', 'failed'],
      ['ansprechpartner', 'failed'],
    ],
    customerRead,
  );
}
world.rpc = foreignAnswer;
// The retry reads only the sources it names.
const retry = await search({ sources: ['dokumente'] });
assert.deepEqual(
  world.rpcCalls.map((call) => call.name),
  ['list_document_page'],
);
assert.equal(retry.success, true);

// Six customers „Müller“ fill the customer page; the contact „Müller“ under a
// seventh is still found, the foreign one never.
query = 'Müller';
const mueller = await search({ sources: ['kunden'] });
assert.equal(mueller.success, true);
if (!mueller.success) throw new Error('unreachable');
const groupHits = (kind: string) =>
  mueller.groups.flatMap((group) =>
    group.kind === kind && group.status === 'loaded' ? group.hits.map((hit) => hit.id) : [],
  );
assert.equal(groupHits('kunden').length, 5);
assert.equal(
  groupHits('kunden').includes(ids.seventhClient),
  false,
  'the seventh customer is beyond the page',
);
assert.deepEqual(groupHits('ansprechpartner'), [ids.seventhContact]);
query = 'Lindenhof';

// An employee: only their assigned jobs, through the job list's employee scope.
signInAs(world, 'employee');
const own = await search();
assert.equal(own.success, true);
if (!own.success) throw new Error('unreachable');
assert.deepEqual(
  own.groups.map((group) => group.kind),
  ['auftraege'],
);
assert.deepEqual(hitIds(own), [ids.assignedJob], 'no coworker job, no foreign job');
assert.deepEqual(
  world.rpcCalls.map((call) => call.name),
  ['list_job_entries_page'],
);
assert.equal(world.rpcCalls[0]?.args.p_user_id, CALLER_ID);
assert.equal(world.rpcCalls[0]?.args.p_is_manager, false);
// Naming the office sources reads nothing: the role decides, not the client.
const refused = await search({ sources: ['kunden', 'anfragen', 'anlagen', 'dokumente'] });
assert.deepEqual(refused, { success: true, query, groups: [] });
assert.equal(world.rpcCalls.length, 0, 'an employee reads no customer, request, Anlage or document');

console.info('global search boundaries hold');
