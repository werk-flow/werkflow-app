// The real Leistungen page over the in-memory database: a field worker is sent
// to the dashboard before any database read and finds no „Angebote“ in the
// navigation; Büro opens the page, which reads the list of its own organization.
import assert from 'node:assert/strict';
import { ORGANIZATION_A, signInAs } from './action-boundary-world';
import { installPageWorld, refusal, renderTree } from './page-render';

const world = await installPageWorld({ leistungen: [], leistung_price_versions: [] });
world.rpc = ({ name }) =>
  name === 'list_leistung_page'
    ? { data: { total: 0, hasAny: false, rows: [] }, error: null }
    : { data: null, error: null };

const { default: LeistungenPage } = await import('@/app/(app)/angebote/leistungen/page');
const { navItemsFor } = await import('@/components/sidebar/sidebar-nav-items');
const page = () => LeistungenPage({ searchParams: Promise.resolve({}) });

signInAs(world, 'employee');
world.adminClientRequests = 0;
assert.equal(await refusal(page), 'redirect:/dashboard');
assert.equal(world.adminClientRequests, 0, 'the refused page reached the database');
assert.ok(
  !navItemsFor('employee').some((item) => item.href.startsWith('/angebote')),
  'the employee navigation shows Angebote',
);

signInAs(world, 'buero');
world.rpcCalls.length = 0;
await renderTree(page);
assert.deepEqual(
  world.rpcCalls.map((call) => [call.name, call.args.p_organization_id]),
  [['list_leistung_page', ORGANIZATION_A]],
);
assert.ok(navItemsFor('buero').some((item) => item.href === '/angebote/leistungen'));
