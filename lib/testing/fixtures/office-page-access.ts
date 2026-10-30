// The real office pages over the in-memory database: a field worker who
// opens Anfragen, a request, a customer, the document library or the
// inventory is sent to the dashboard, and an unassigned job to the job list;
// a member of another organization who opens a request or a customer by its
// id sees none of it. A Büro member of the owning organization opens the same
// ids, so each refusal answers the role or the organization, not a missing row.
import assert from 'node:assert/strict';
import { mock } from 'bun:test';
import type { ReactElement } from 'react';
import {
  CALLER_ID,
  ORGANIZATION_A,
  ORGANIZATION_B,
  installActionWorld,
  signInAs,
} from './action-boundary-world';

const requestId = '6a000000-0000-4000-8000-000000000001';
const clientId = '6a000000-0000-4000-8000-000000000002';
const unassignedJobId = '6a000000-0000-4000-8000-000000000003';
const colleagueId = '6a000000-0000-4000-8000-000000000004';
const unassignedJobNumber = 'A-2026-077';
const now = '2026-10-01T08:00:00.000Z';

const emptyInventoryPage = {
  ids: [],
  supportIds: [],
  total: 0,
  locationIds: [],
  locationCounts: {},
  summary: {
    totalItems: 0,
    lowStockItems: 0,
    outOfStockItems: 0,
    plannedQuantity: 0,
    totalOnHand: 0,
    stockedItems: 0,
    plannedItems: 0,
  },
};

const navigation = { ...(await import('next/navigation')) };
const world = installActionWorld({
  client_requests: [
    {
      id: requestId,
      organization_id: ORGANIZATION_A,
      request_number: 'ANF-2026-001',
      client_id: null,
      contact_id: null,
      site_id: null,
      caller_name: 'Erika Muster',
      caller_phone: null,
      caller_email: null,
      caller_address: null,
      summary: 'Heizung fällt aus',
      details: null,
      category: 'stoerung_reparatur',
      urgency: 'hoch',
      source: 'telefon',
      status: 'offen',
      assigned_to: null,
      received_at: now,
      closed_reason: null,
      closed_note: null,
      closed_by: null,
      closed_at: null,
      converted_job_id: null,
      converted_project_id: null,
      converted_by: null,
      converted_at: null,
      created_by: CALLER_ID,
      created_at: now,
      updated_at: now,
    },
  ],
  client_request_events: [],
  service_cases: [],
  clients: [
    { id: clientId, organization_id: ORGANIZATION_A, name: 'Geschützter Kunde', client_type: 'privat' },
  ],
  jobs: [
    {
      id: unassignedJobId,
      organization_id: ORGANIZATION_A,
      job_number: unassignedJobNumber,
      title: 'Bad sanieren',
      project_id: null,
      client_id: null,
      site_id: null,
      contact_id: null,
    },
  ],
  job_assignments: [
    {
      id: '6a000000-0000-4000-8000-000000000005',
      organization_id: ORGANIZATION_A,
      job_id: unassignedJobId,
      user_id: colleagueId,
    },
  ],
});

// The pages import client components, so the router hooks stay; a redirect and a not-found end the render.
mock.module('next/navigation', () => ({
  ...navigation,
  redirect: (path: string): never => {
    throw new Error(`redirect:${path}`);
  },
  notFound: (): never => {
    throw new Error('notFound');
  },
}));

const { default: AnfragenPage } = await import('@/app/(app)/anfragen/page');
const { default: AnfrageDetailPage } = await import('@/app/(app)/anfragen/[requestId]/page');
const { default: KundenDetailPage } = await import('@/app/(app)/kunden/[clientId]/page');
const { default: DokumentePage } = await import('@/app/(app)/dokumente/page');
const { default: InventoryPage } = await import('@/app/(app)/inventar/page');
const { default: JobDetailPage } = await import('@/app/(app)/auftraege/[jobNumber]/page');
const { getJobByNumber } = await import('@/lib/jobs/actions');
const { navItemsFor } = await import('@/components/sidebar/sidebar-nav-items');

type Render = () => Promise<ReactElement> | ReactElement;
type ServerComponent = (props: unknown) => Promise<ReactElement>;

function isServerComponent(type: unknown): type is ServerComponent {
  return typeof type === 'function' && type.constructor.name === 'AsyncFunction';
}

/** The value at `path` below `value`, or `undefined` where a step is missing. */
function field(value: unknown, ...path: string[]): unknown {
  return path.reduce<unknown>(
    (current, key) =>
      typeof current === 'object' && current !== null ? Reflect.get(current, key) : undefined,
    value,
  );
}

/** Runs the page and each async server component it returns, as the server renders them. */
async function render(page: Render): Promise<ReactElement> {
  let element = await page();
  while (isServerComponent(element.type)) element = await element.type(element.props);
  return element;
}

/** How the page refused: a redirect, a not-found, or a client-side route redirect. */
async function refusal(page: Render): Promise<string> {
  try {
    const href = field(await render(page), 'props', 'href');
    assert.equal(typeof href, 'string', 'the page rendered');
    return `route-redirect:${String(href)}`;
  } catch (error) {
    if (error instanceof Error && /^(redirect:|notFound$)/.test(error.message)) return error.message;
    throw error;
  }
}

const searchParams = Promise.resolve({});
const pages = {
  '/anfragen': () => AnfragenPage({ searchParams }),
  '/anfragen/[requestId]': () => AnfrageDetailPage({ params: Promise.resolve({ requestId }) }),
  '/kunden/[clientId]': () => KundenDetailPage({ params: Promise.resolve({ clientId }) }),
  '/dokumente': () => DokumentePage({ searchParams }),
  '/inventar': () => InventoryPage({ searchParams }),
} satisfies Record<string, Render>;
const officeNavigation = ['/anfragen', '/kunden', '/dokumente', '/inventar'];

// A field worker reaches no office page and finds none of them in the navigation.
signInAs(world, 'employee');
for (const [route, page] of Object.entries(pages))
  assert.equal(await refusal(page), 'redirect:/dashboard', `employee on ${route}`);
const employeeNavigation = navItemsFor('employee').map((item) => item.href);
for (const href of officeNavigation)
  assert.ok(!employeeNavigation.includes(href), `the employee navigation shows ${href}`);

// A field worker does not open a job of the own organization that is not assigned to them: the job
// reader refuses it itself, not only the page's later assignment check.
assert.deepEqual(await getJobByNumber(unassignedJobNumber), { success: false, error: 'not_authorized' });
assert.equal(
  await refusal(() => JobDetailPage({ params: Promise.resolve({ jobNumber: unassignedJobNumber }) })),
  'redirect:/auftraege',
);

// A member of another organization finds neither the request nor the customer by its id.
signInAs(world, 'admin', ORGANIZATION_B);
assert.equal(await refusal(pages['/anfragen/[requestId]']), 'notFound');
assert.equal(await refusal(pages['/kunden/[clientId]']), 'route-redirect:/kunden');

// Büro of the owning organization opens every page, the request and the customer.
signInAs(world, 'buero');
world.rpc = ({ name }) =>
  name === 'list_inventory_page' ? { data: emptyInventoryPage, error: null } : { data: null, error: null };
for (const [route, page] of Object.entries(pages)) {
  assert.equal(field(await render(page), 'props', 'href'), undefined, `buero on ${route} was redirected`);
}
const request = await render(pages['/anfragen/[requestId]']);
assert.equal(field(request, 'props', 'data', 'request', 'summary'), 'Heizung fällt aus');
const customer = await render(pages['/kunden/[clientId]']);
assert.equal(field(customer, 'props', 'client', 'name'), 'Geschützter Kunde');
const bueroNavigation = navItemsFor('buero').map((item) => item.href);
for (const href of officeNavigation)
  assert.ok(bueroNavigation.includes(href), `the Büro navigation hides ${href}`);
