// The header search over the in-memory database, through the real domain
// readers. The list functions answer from the world's tables by organization,
// role and a plain text match; their own matching rules are SQL-tested
// (supabase/tests/global_search_matches.sql, operational_list_pages.sql).
// Proves: identity, organization and role come from the session; a matching
// record of another organization is never a hit; an employee reaches only
// their assigned jobs and the live Anlagen linked to them, never another
// job's or organization's Anlage, and no customer, request or document; no role
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
import { ID_BATCH_SIZE } from '@/lib/supabase/query-batches';

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
  ownEquipment: '39000000-0000-4000-8000-000000000001',
  coworkerEquipment: '39000000-0000-4000-8000-000000000002',
  foreignEquipment: '39000000-0000-4000-8000-000000000003',
  voidedEquipment: '39000000-0000-4000-8000-000000000004',
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
      planned_date: null,
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

function equipment(id: string, organizationId: string, name: string, voidedAt: string | null = null): Row {
  return {
    id,
    organization_id: organizationId,
    equipment_number: `ANL-2026-000${id.slice(-1)}`,
    name,
    category: 'heat_generation',
    subtype: null,
    state: 'active',
    manufacturer: null,
    model: null,
    location_detail: null,
    voided_at: voidedAt,
  };
}

function workLink(n: number, organizationId: string, jobId: string, equipmentId: string): Row {
  return {
    id: `3a000000-0000-4000-8000-00000000000${n}`,
    organization_id: organizationId,
    job_id: jobId,
    equipment_id: equipmentId,
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
  // Each Anlage matches the query; only the live one of the caller's own job is theirs.
  installed_equipment: [
    equipment(ids.ownEquipment, ORGANIZATION_A, 'Gastherme Lindenhof Keller'),
    equipment(ids.coworkerEquipment, ORGANIZATION_A, 'Gastherme Lindenhof Dach'),
    equipment(ids.foreignEquipment, ORGANIZATION_B, 'Gastherme Lindenhof Keller'),
    equipment(ids.voidedEquipment, ORGANIZATION_A, 'Gastherme Lindenhof Irrtum', createdAt),
  ],
  installed_equipment_work_links: [
    workLink(1, ORGANIZATION_A, ids.assignedJob, ids.ownEquipment),
    workLink(2, ORGANIZATION_A, ids.coworkerJob, ids.coworkerEquipment),
    workLink(3, ORGANIZATION_B, ids.foreignJob, ids.foreignEquipment),
    workLink(4, ORGANIZATION_A, ids.assignedJob, ids.voidedEquipment),
  ],
  ordinary_documents: [],
});
for (const table of NEVER_READ) world.failingTables.add(table);

const failingFunctions = new Set<string>();
/** The matcher's answer to the batch without the caller's first Anlage: as it is, failed or malformed. */
let otherMatchBatch: 'answer' | 'error' | 'malformed' = 'answer';
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

function matchInstalledEquipment(args: Row) {
  const passed = Array.isArray(args.p_equipment_ids) ? args.p_equipment_ids : [];
  if (!passed.includes(ids.ownEquipment) && otherMatchBatch === 'error')
    return { data: null, error: { message: 'private provider detail' } };
  if (!passed.includes(ids.ownEquipment) && otherMatchBatch === 'malformed')
    return { data: ['keine-id'], error: null };
  const matched = inOrganization('installed_equipment', args.p_organization_id)
    .filter((row) => passed.includes(row.id) && row.voided_at === null && matches(row.name))
    .map((row) => row.id);
  return { data: matched, error: null };
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
  if (name === 'match_installed_equipment') return matchInstalledEquipment(args);
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

// An employee: only their assigned jobs, through the job list's employee scope,
// and the live Anlagen linked to them, through the work pack's reach.
signInAs(world, 'employee');
const own = await search();
assert.equal(own.success, true);
if (!own.success) throw new Error('unreachable');
assert.deepEqual(
  own.groups.map((group) => group.kind),
  ['auftraege', 'anlagen'],
);
assert.deepEqual(
  hitIds(own),
  [ids.assignedJob, ids.ownEquipment],
  'no coworker job or Anlage, no foreign job or Anlage, no voided Anlage',
);
assert.deepEqual(world.rpcCalls.map((call) => call.name).toSorted(), [
  'list_job_entries_page',
  'match_installed_equipment',
]);
const jobListCall = world.rpcCalls.find((call) => call.name === 'list_job_entries_page');
assert.equal(jobListCall?.args.p_user_id, CALLER_ID);
assert.equal(jobListCall?.args.p_is_manager, false);
// The server passes only the Anlagen of the caller's own jobs: the match never sees another.
const matchCall = world.rpcCalls.find((call) => call.name === 'match_installed_equipment');
assert.equal(matchCall?.args.p_organization_id, ORGANIZATION_A);
assert.deepEqual(matchCall?.args.p_equipment_ids, [ids.ownEquipment]);
const equipmentGroup = own.groups.find((group) => group.kind === 'anlagen');
assert.deepEqual(equipmentGroup, {
  kind: 'anlagen',
  source: 'anlagen',
  status: 'loaded',
  hits: [
    {
      id: ids.ownEquipment,
      title: 'Gastherme Lindenhof Keller',
      detail: 'ANL-2026-0001 · Auftrag A-1',
      href: `/auftraege/A-1#anlage-${ids.ownEquipment}`,
    },
  ],
  total: 1,
  // The equipment list is the office's: no „Alle anzeigen“.
  moreHref: null,
});
// A failed read of the Anlagen fails their group alone, never an empty one.
world.failingTables.add('installed_equipment_work_links');
const failedEquipment = await search();
assert.equal(failedEquipment.success, true);
if (!failedEquipment.success) throw new Error('unreachable');
assert.deepEqual(
  failedEquipment.groups.map((group) => [group.kind, group.status]),
  [
    ['auftraege', 'loaded'],
    ['anlagen', 'failed'],
  ],
);
world.failingTables.delete('installed_equipment_work_links');
// Naming the office sources reads nothing: the role decides, not the client.
const refused = await search({ sources: ['kunden', 'anfragen', 'dokumente'] });
assert.deepEqual(refused, { success: true, query, groups: [] });
assert.equal(world.rpcCalls.length, 0, 'an employee reads no customer, request or document');

// The matcher reads the caller's Anlagen in id batches: every batch counts, and one that fails or
// answers malformed fails the Anlagen group, never shortens it.
const batchEquipmentIds = Array.from(
  { length: ID_BATCH_SIZE },
  (_, index) => `3b000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
);
for (const [index, id] of batchEquipmentIds.entries()) {
  tableRows(world, 'installed_equipment').push(equipment(id, ORGANIZATION_A, `Gastherme Lindenhof ${index}`));
  tableRows(world, 'installed_equipment_work_links').push({
    id: `3c000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    organization_id: ORGANIZATION_A,
    job_id: ids.assignedJob,
    equipment_id: id,
  });
}
const batched = await search({ sources: ['anlagen'] });
const batchCalls = world.rpcCalls.filter((call) => call.name === 'match_installed_equipment');
assert.ok(batchCalls.length > 1, 'the matcher gets every Anlage in one call');
for (const call of batchCalls)
  assert.ok(
    Array.isArray(call.args.p_equipment_ids) && call.args.p_equipment_ids.length <= ID_BATCH_SIZE,
    'a matcher call carries more ids than one batch',
  );
assert.equal(batched.success, true);
if (!batched.success) throw new Error('unreachable');
const [batchedGroup] = batched.groups;
assert.ok(batchedGroup?.status === 'loaded', 'the batched Anlagen search failed');
assert.equal(batchedGroup.total, ID_BATCH_SIZE + 1, 'a batch of matches went missing');
for (const answer of ['error', 'malformed'] as const) {
  otherMatchBatch = answer;
  const partial = await search({ sources: ['anlagen'] });
  assert.equal(partial.success, true);
  if (!partial.success) throw new Error('unreachable');
  assert.deepEqual(
    partial.groups.map((group) => [group.kind, group.status]),
    [['anlagen', 'failed']],
    `the ${answer} matcher batch left the Anlagen group loaded`,
  );
}
otherMatchBatch = 'answer';

console.info('global search boundaries hold');
