// The real Wochenzahlen page and its reader over the in-memory database: Büro
// and a field worker are sent to the dashboard before any database read and
// find no entry in the navigation, and the reader refuses them on its own;
// Admin reads the numbers of the organization of its own membership, also
// when the cookie names another organization; a failed read throws to the
// (app) error boundary, never an empty week.
import assert from 'node:assert/strict';
import { isValidElement } from 'react';
import { ORGANIZATION_A, ORGANIZATION_B, signInAs } from './action-boundary-world';
import { field, installPageWorld, refusal, renderTree } from './page-render';

const WEEK = {
  weekStart: '2026-11-09',
  lastDay: '2026-11-15',
  overdue: {
    followUps: 1,
    requestCallbacks: 0,
    maintenance: 2,
    staleRequests: 0,
    waitingHandovers: 1,
    blockerReviews: 0,
  },
  handover: { released: 2, medianWorkdays: 1.5, withinTwoWorkdays: 1 },
  workReports: { finished: 3, withReport: 2 },
  timeCapture: { entries: 40, byEmployee: 36 },
};

const world = await installPageWorld({});
let readFails = false;
world.rpc = ({ name }) =>
  name === 'read_weekly_outcome_numbers'
    ? readFails
      ? { data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } }
      : { data: [WEEK], error: null }
    : { data: null, error: null };

const { default: KennzahlenPage } = await import('@/app/(app)/kennzahlen/page');
const { readWeeklyOutcomeNumbers } = await import('@/lib/weekly-numbers/reads');
const { WeeklyNumbersView } = await import('@/components/kennzahlen/weekly-numbers-view');
const { navItemsFor } = await import('@/components/sidebar/sidebar-nav-items');
const page = () => KennzahlenPage();

for (const role of ['buero', 'employee'] as const) {
  signInAs(world, role);
  world.adminClientRequests = 0;
  assert.equal(await refusal(page), 'redirect:/dashboard', `the page opened for ${role}`);
  assert.deepEqual(await readWeeklyOutcomeNumbers(), { success: false, error: 'not_authorized' });
  assert.equal(world.adminClientRequests, 0, `a refused ${role} reached the database`);
  assert.ok(
    !navItemsFor(role).some((item) => item.href === '/kennzahlen'),
    `the ${role} navigation shows Wochenzahlen`,
  );
}

signInAs(world, null);
world.callerId = null;
assert.deepEqual(await readWeeklyOutcomeNumbers(), { success: false, error: 'not_authenticated' });

signInAs(world, 'admin');
world.activeOrganizationCookie = ORGANIZATION_B;
world.rpcCalls.length = 0;
const elements = await renderTree(page);
assert.deepEqual(
  world.rpcCalls.map((call) => [call.name, call.args.p_organization_id, call.args.p_week_count]),
  [['read_weekly_outcome_numbers', ORGANIZATION_A, 12]],
  'the reader read another organization than the admin’s own membership',
);
const view = elements.find((element) => isValidElement(element) && element.type === WeeklyNumbersView);
assert.deepEqual(field(view, 'props', 'weeks'), [WEEK]);
assert.ok(navItemsFor('admin').some((item) => item.href === '/kennzahlen'));

readFails = true;
await assert.rejects(
  renderTree(page),
  /^Error: Failed to load weekly numbers: load_failed$/,
  'a failed read rendered instead of reaching the error boundary',
);
