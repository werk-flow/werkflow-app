// WerkFlow KI's tools over the in-memory database, driven through the real
// turn route, harness and replay provider. The page readers run for real; the
// list functions they call answer from the world's tables by organization,
// role and a plain text match, as their SQL does (supabase/tests/
// operational_list_pages.sql and global_search_matches.sql prove the SQL).
import { z } from '@/lib/zod';
import { CALLER_ID, ORGANIZATION_A, ORGANIZATION_B, tableRows } from './action-boundary-world';
import { type AiTurnWorld, installAiTurnWorld, postTurn, readTurn, resetAiTables } from './ai-turn-world';

type Row = Record<string, unknown>;

export const COWORKER_ID = '31000000-0000-4000-8000-000000000001';
export const IDS = {
  client: '34000000-0000-4000-8000-000000000001',
  foreignClient: '34000000-0000-4000-8000-000000000002',
  assignedJob: '35000000-0000-4000-8000-000000000001',
  coworkerJob: '35000000-0000-4000-8000-000000000002',
  foreignJob: '35000000-0000-4000-8000-000000000003',
  item: '36000000-0000-4000-8000-000000000001',
  foreignItem: '36000000-0000-4000-8000-000000000002',
  supplier: '37000000-0000-4000-8000-000000000001',
  site: '34100000-0000-4000-8000-000000000001',
  contact: '34200000-0000-4000-8000-000000000001',
  workLead: '35200000-0000-4000-8000-000000000001',
} as const;
/** What only the office's job page shows: `auftrag_lesen` must leave both out. */
export const OFFICE_ONLY = {
  billingRecipient: 'Hausverwaltung Lindenhof GmbH',
  workLead: IDS.workLead,
} as const;
/** A sale price only the item row holds: it must never reach the model (B19). */
export const SALE_PRICE_CENTS = 4711;
const createdAt = '2026-11-02T08:00:00.000Z';

const client = (id: string, organizationId: string, name: string): Row => ({
  id,
  organization_id: organizationId,
  name,
  client_type: 'gewerblich',
  customer_number: 'K-1001',
  email: null,
  phone: '0711 12345',
  address: 'Lindenstraße 1, 70173 Stuttgart',
  notes: null,
  created_at: createdAt,
  updated_at: createdAt,
});

const job = (id: string, organizationId: string, clientId: string, title: string): Row => ({
  id,
  organization_id: organizationId,
  project_id: null,
  client_id: clientId,
  site_id: null,
  contact_id: null,
  job_number: `A-${id.slice(-1)}`,
  source_number: null,
  title,
  description: null,
  status: 'nicht_bearbeitet',
  execution_state: null,
  execution_version: 0,
  priority: 'mittel',
  planned_date: null,
  planned_time: null,
  estimated_duration_minutes: null,
  planned_working_minutes: null,
  actual_completion_date: null,
  location: null,
  created_by: CALLER_ID,
  created_at: createdAt,
  updated_at: createdAt,
});

/** The assigned job as its page reads it: site, contact, a visit, billing parties and a work lead. */
const assignedJob = (title: string): Row => ({
  ...job(IDS.assignedJob, ORGANIZATION_A, IDS.client, title),
  site_id: IDS.site,
  contact_id: IDS.contact,
  description: 'Jährliche Wartung der Gastherme',
  planned_date: '2026-11-03',
  work_billing_parties: [
    {
      version: 1,
      source: 'objekt',
      client_id: IDS.client,
      recipient_client_id: IDS.client,
      recipient_name: OFFICE_ONLY.billingRecipient,
      recipient_address: 'Hofweg 1, 10117 Berlin',
      created_at: createdAt,
      auftraggeber: { name: 'Müller Haustechnik' },
    },
  ],
  work_leads: [
    {
      id: IDS.workLead,
      employee_record_id: '35300000-0000-4000-8000-000000000001',
      started_at: createdAt,
      started_by: COWORKER_ID,
      ended_at: null,
      ended_by: null,
    },
  ],
});

const assignment = (index: number, organizationId: string, jobId: string, userId: string): Row => ({
  id: `35100000-0000-4000-8000-00000000000${index}`,
  organization_id: organizationId,
  job_id: jobId,
  user_id: userId,
  assigned_by: COWORKER_ID,
  assigned_at: createdAt,
});

const item = (id: string, organizationId: string, name: string): Row => ({
  id,
  organization_id: organizationId,
  item_type: 'material',
  name,
  description: null,
  category_id: null,
  unit: 'm',
  internal_sku: 'CU-15',
  manufacturer: 'Viega',
  supplier_id: null,
  supplier_article_number: null,
  purchase_price_cents: SALE_PRICE_CENTS - 1000,
  sale_price_cents: SALE_PRICE_CENTS,
  currency_code: 'EUR',
  tax_rate_basis_points: 1900,
  is_billable: true,
  global_minimum_stock: 0,
  global_target_stock: null,
  track_quantity: true,
  track_individual_assets: false,
  notes: null,
  is_active: true,
  created_at: createdAt,
  updated_at: createdAt,
});

/** The rows the job page reads beside the job: the team's names, the site and the contact. */
const jobDetailTables = (): Record<string, Row[]> => ({
  profiles: [
    {
      id: CALLER_ID,
      first_name: 'Erika',
      last_name: 'Muster',
      email: 'erika@example.test',
      avatar_path: null,
    },
    {
      id: COWORKER_ID,
      first_name: 'Max',
      last_name: 'Kollege',
      email: 'max@example.test',
      avatar_path: null,
    },
  ],
  client_sites: [
    {
      id: IDS.site,
      organization_id: ORGANIZATION_A,
      client_id: IDS.client,
      name: 'Wohnhaus Lindenstraße',
      street: 'Gartenweg 2',
      postal_code: '70173',
      city: 'Stuttgart',
      access_notes: 'Schlüssel beim Hausmeister',
      notes: 'Interne Standortnotiz',
      primary_contact_id: IDS.contact,
      is_primary: true,
      is_active: true,
      created_by: CALLER_ID,
      created_at: createdAt,
      updated_at: createdAt,
    },
  ],
  client_contacts: [
    {
      id: IDS.contact,
      organization_id: ORGANIZATION_A,
      client_id: IDS.client,
      name: 'Anna Müller',
      role: 'Eigentümerin',
      email: 'anna@example.test',
      phone: '0170 5678',
      notes: 'Interne Kontaktnotiz',
      is_primary: true,
      is_active: true,
      created_by: CALLER_ID,
      created_at: createdAt,
      updated_at: createdAt,
    },
  ],
});

/** Seeds both organizations: a job title of A carries `jobTitle`, so an injection case can poison it. */
export function seedToolTables(world: AiTurnWorld, jobTitle = 'Heizung Müller warten'): void {
  Object.assign(world.tables, {
    clients: [
      client(IDS.client, ORGANIZATION_A, 'Müller Haustechnik'),
      client(IDS.foreignClient, ORGANIZATION_B, 'Müller Bau'),
    ],
    jobs: [
      assignedJob(jobTitle),
      job(IDS.coworkerJob, ORGANIZATION_A, IDS.client, 'Heizung Keller tauschen'),
      job(IDS.foreignJob, ORGANIZATION_B, IDS.foreignClient, 'Heizung Fremdfirma'),
    ],
    job_assignments: [
      assignment(1, ORGANIZATION_A, IDS.assignedJob, CALLER_ID),
      assignment(2, ORGANIZATION_A, IDS.coworkerJob, COWORKER_ID),
      assignment(3, ORGANIZATION_B, IDS.foreignJob, CALLER_ID),
      assignment(4, ORGANIZATION_A, IDS.assignedJob, COWORKER_ID),
    ],
    ...jobDetailTables(),
    planning_occurrences: [
      {
        id: '35400000-0000-4000-8000-000000000001',
        organization_id: ORGANIZATION_A,
        job_id: IDS.assignedJob,
        status: 'scheduled',
      },
    ],
    projects: [],
    inventory_items: [
      item(IDS.item, ORGANIZATION_A, 'Kupferrohr 15 mm'),
      item(IDS.foreignItem, ORGANIZATION_B, 'Kupferrohr 18 mm'),
    ],
    inventory_suppliers: [
      { id: IDS.supplier, organization_id: ORGANIZATION_A, name: 'GC Großhandel', is_active: true },
    ],
    inventory_item_suppliers: [
      {
        id: '37100000-0000-4000-8000-000000000001',
        organization_id: ORGANIZATION_A,
        item_id: IDS.item,
        supplier_id: IDS.supplier,
        supplier_article_number: 'GC-15015',
        purchase_unit: 'Stange',
        pack_quantity: 1,
        base_quantity: 5,
        is_preferred: true,
      },
    ],
    inventory_item_prices: [],
  });
}

const matches = (value: unknown, search: string): boolean =>
  !search || (typeof value === 'string' && value.toLowerCase().includes(search.toLowerCase()));

const sectionQuerySchema = z.object({
  enabled: z.boolean(),
  search: z.string(),
  clientIds: z.array(z.string()),
  pageSize: z.number(),
});
const jobQueriesSchema = z.object({ active: sectionQuerySchema, parked: sectionQuerySchema });

/**
 * `list_job_entries_page`: the open jobs of the organization the call names,
 * an employee's only when assigned. Every seeded job is open, so the parked
 * and finished sections hold none.
 */
function jobEntriesPage(world: AiTurnWorld, args: Row) {
  const queries = jobQueriesSchema.parse(args.p_queries);
  const visible = tableRows(world, 'jobs').filter(
    (row) =>
      row.organization_id === args.p_organization_id &&
      (args.p_is_manager === true ||
        tableRows(world, 'job_assignments').some(
          (link) => link.job_id === row.id && link.user_id === args.p_user_id,
        )),
  );
  const section = (query: z.infer<typeof sectionQuerySchema>, rows: Row[]) => {
    const found = rows.filter(
      (row) =>
        query.enabled &&
        (matches(row.title, query.search) || matches(row.job_number, query.search)) &&
        (query.clientIds.length === 0 || query.clientIds.includes(String(row.client_id))),
    );
    const entries = found.slice(0, query.pageSize).map((row) => ({
      id: row.id,
      type: 'standalone-job',
      jobCount: 0,
      completedJobCount: 0,
      inProgressJobCount: 0,
      parkedJobCount: 0,
      assignedUserIds: [],
    }));
    const total = found.length;
    return {
      entries,
      total,
      sectionTotal: total,
      statusCounts: { alle: total, not_started: total, in_progress: 0, interrupted: 0 },
    };
  };
  const empty = section(queries.parked, []);
  return { active: section(queries.active, visible), parked: empty, archived: empty };
}

function customerPage(world: AiTurnWorld, args: Row) {
  const search = String(args.p_search);
  const found = tableRows(world, 'clients').filter(
    (row) => row.organization_id === args.p_organization_id && matches(row.name, search),
  );
  const clients = found.slice(0, Number(args.p_page_size)).map((row) => ({
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
  return { total: found.length, clients };
}

function inventoryPage(world: AiTurnWorld, args: Row) {
  const { search } = z.object({ search: z.string() }).parse(args.p_query);
  const ids = tableRows(world, 'inventory_items')
    .filter((row) => row.organization_id === args.p_organization_id && matches(row.name, search))
    .map((row) => row.id);
  const summaryKeys = ['totalItems', 'shortfallItems', 'lowStockItems', 'outOfStockItems', 'plannedQuantity'];
  const restKeys = ['totalOnHand', 'stockedItems', 'plannedItems'];
  return {
    ids,
    supportIds: ids,
    total: ids.length,
    locationIds: [],
    locationCounts: {},
    summary: Object.fromEntries([...summaryKeys, ...restKeys].map((key) => [key, 0])),
  };
}

/** The page readers' list functions; null for a function the AI fixture world answers. */
function readerAnswer(world: AiTurnWorld, name: string, args: Row): { data: unknown; error: null } | null {
  if (name === 'list_job_entries_page') return { data: jobEntriesPage(world, args), error: null };
  if (name === 'list_customer_page') return { data: customerPage(world, args), error: null };
  if (name === 'list_inventory_page') return { data: inventoryPage(world, args), error: null };
  if (name === 'read_inventory_item_prices_on_day') return { data: [], error: null };
  return null;
}

export async function installAiToolWorld(): Promise<AiTurnWorld> {
  const world = await installAiTurnWorld();
  const answerAi = world.rpc;
  world.rpc = (call) => readerAnswer(world, call.name, call.args) ?? answerAi(call);
  seedToolTables(world);
  return world;
}

type Request = AiTurnWorld['streamRequests'][number];

/** The names of the tools a model request offered. */
export const offeredTools = (request: Request | undefined): string[] =>
  (request?.tools ?? []).map((tool) => tool.name).toSorted();

/** Each tool result a model request carried, as the model reads it. */
export function toolResults(request: Request | undefined): Array<{ tool: string; output: unknown }> {
  return (request?.prompt ?? []).flatMap((message) =>
    message.role === 'tool'
      ? message.content.flatMap((part) =>
          part.type === 'tool-result' ? [{ tool: part.toolName, output: part.output }] : [],
        )
      : [],
  );
}

/**
 * Posts one turn in which the model calls `name` with `input`, as the signed-in
 * caller. Returns the route's status and the one tool result the model read.
 */
export async function callTool(
  world: AiTurnWorld,
  name: string,
  input: Row,
): Promise<{ status: number; output: unknown }> {
  // A fresh turn ledger and thread for the caller the case signed in.
  const { callerId, memberships, activeOrganizationCookie } = world;
  resetAiTables(world);
  Object.assign(world, { callerId, memberships, activeOrganizationCookie });
  const response = await postTurn(`[replay:werkzeug] ${JSON.stringify({ name, input })}`);
  if (response.status !== 200) return { status: response.status, output: null };
  await readTurn(world, response);
  const [result, ...rest] = toolResults(world.streamRequests[1]);
  if (!result || rest.length > 0) throw new Error(`${name}: the model must read exactly one tool result`);
  return { status: response.status, output: result.output };
}
