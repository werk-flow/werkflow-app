// The real Mitarbeiter pages over the in-memory database: a field worker who
// opens the personnel list or a person's detail is sent to the dashboard, also
// in an organization they joined by code while they manage another one; a
// member of another organization who opens a person or a record without login
// by its id is sent back to the own list, and that list shows none of the
// organization's people. A Büro member of the owning organization opens the
// same ids, so each refusal answers the role or the organization, not a
// missing row. Switching the active organization switches the listed people.
import assert from 'node:assert/strict';
import { mock } from 'bun:test';
import { getDefaultTimeTrackingSettings } from '@/lib/time-tracking/settings';
import { CALLER_ID, ORGANIZATION_A, ORGANIZATION_B, signInAs } from './action-boundary-world';
import { field, installPageWorld, refusal, render, renderTree, type Render } from './page-render';

const colleagueId = '6c000000-0000-4000-8000-000000000001';
const colleagueRecordId = '6c000000-0000-4000-8000-000000000002';
const noLoginRecordId = '6c000000-0000-4000-8000-000000000003';
const foreignRecordId = '6c000000-0000-4000-8000-000000000004';
const foreignColleagueId = '6c000000-0000-4000-8000-000000000005';
const now = '2026-10-01T08:00:00.000Z';

const personnelRecord = (id: string, organizationId: string, userId: string | null, lastName: string) => ({
  id,
  organization_id: organizationId,
  user_id: userId,
  first_name: 'Erika',
  last_name: lastName,
  entry_date: '2026-01-01',
  exit_date: null,
  employee_number: null,
  created_at: now,
  updated_at: now,
  organization_invites: [],
  personnel_access_lifecycles: [],
  personnel_onboarding_requirements: [],
});

const world = await installPageWorld({
  employee_records: [
    personnelRecord(colleagueRecordId, ORGANIZATION_A, colleagueId, 'Geschützt'),
    personnelRecord(noLoginRecordId, ORGANIZATION_A, null, 'Ohnezugang'),
    personnelRecord(foreignRecordId, ORGANIZATION_B, foreignColleagueId, 'Fremd'),
  ],
  // The caller's own row follows the signed-in role; `signInAsMember` sets it.
  organization_members: [],
  profiles: [
    { id: colleagueId, first_name: 'Erika', last_name: 'Geschützt', email: 'erika@example.test' },
    { id: foreignColleagueId, first_name: 'Erika', last_name: 'Fremd', email: 'fremd@example.test' },
  ],
});
// The pages read the break rules; a missing settings row means the defaults.
const cached = { ...(await import('@/lib/data/cached')) };
mock.module('@/lib/data/cached', () => ({
  ...cached,
  getCachedOrganizationSettings: async (organizationId: string) =>
    getDefaultTimeTrackingSettings(organizationId),
}));

const { default: MitarbeiterPage } = await import('@/app/(app)/mitarbeiter/page');
const { default: MitarbeiterDetailPage } = await import('@/app/(app)/mitarbeiter/[userId]/page');
const { default: KundenPage } = await import('@/app/(app)/kunden/page');

const detail =
  (userId: string): Render =>
  () =>
    MitarbeiterDetailPage({ params: Promise.resolve({ userId }) });
const list: Render = () => MitarbeiterPage();
const customers: Render = () => KundenPage({ searchParams: Promise.resolve({}) });

type Role = 'admin' | 'buero' | 'employee';
/** Signs in with the caller's membership rows, which the member and responsibility reads resolve. */
function signInAsMember(memberships: ReadonlyArray<{ orgId: string; role: Role }>, active: string): void {
  const [first] = memberships;
  assert.ok(first, 'a member needs a membership');
  signInAs(world, first.role, first.orgId);
  world.memberships = memberships.map((membership) => ({ ...membership }));
  world.activeOrganizationCookie = active;
  world.tables.organization_members = [
    ...memberships.map(({ orgId, role }) => ({
      organization_id: orgId,
      user_id: CALLER_ID,
      role,
      joined_at: now,
    })),
    { organization_id: ORGANIZATION_A, user_id: colleagueId, role: 'employee', joined_at: now },
    { organization_id: ORGANIZATION_B, user_id: foreignColleagueId, role: 'employee', joined_at: now },
  ];
}

// The member read is the database function scoped to the organization it is
// given; the fake answers that organization's rows, so the list shows whose
// members the page asked for.
world.rpc = ({ name, args }) => {
  if (name !== 'get_org_members_for_user') return { data: null, error: null };
  const rows = world.tables.organization_members ?? [];
  // Like the function behind the session, it answers only the signed-in caller, and only for
  // an organization that caller belongs to.
  if (
    args.p_user_id !== CALLER_ID ||
    !rows.some((row) => row.organization_id === args.p_org_id && row.user_id === args.p_user_id)
  )
    return { data: null, error: { message: 'not_authorized' } };
  return {
    data: rows
      .filter((row) => row.organization_id === args.p_org_id)
      .map((row) => ({
        user_id: row.user_id,
        role: row.role,
        joined_at: row.joined_at,
        email: '',
        first_name: '',
        last_name: '',
      })),
    error: null,
  };
};

/** The user ids of the members the list page hands to its tabs. */
async function listedMemberIds(): Promise<string[]> {
  const tabs = (await renderTree(list)).find((element) => field(element, 'props', 'members') !== undefined);
  assert.ok(tabs, 'the list rendered no member tab');
  const members = field(tabs, 'props', 'members');
  assert.ok(Array.isArray(members), 'the members are no list');
  return members.map((entry: unknown) => String(field(entry, 'user_id'))).sort();
}

/** The ids of the personnel records the list page hands to its tabs. */
async function listedRecordIds(): Promise<string[]> {
  const tabs = (await renderTree(list)).find(
    (element) => field(element, 'props', 'personnelEntries') !== undefined,
  );
  assert.ok(tabs, 'the list rendered no personnel tab');
  const entries = field(tabs, 'props', 'personnelEntries');
  assert.ok(Array.isArray(entries), 'the personnel entries are no list');
  return entries.map((entry: unknown) => String(field(entry, 'record', 'id'))).sort();
}

// A field worker reaches neither the list nor a person's detail.
signInAsMember([{ orgId: ORGANIZATION_A, role: 'employee' }], ORGANIZATION_A);
assert.equal(await refusal(list), 'redirect:/dashboard', 'employee on /mitarbeiter');
for (const id of [colleagueId, noLoginRecordId])
  assert.equal(await refusal(detail(id)), 'redirect:/dashboard', `employee on /mitarbeiter/${id}`);

// The role belongs to the active organization: a field worker who joined
// organization A by code is refused there while they manage organization B.
signInAsMember(
  [
    { orgId: ORGANIZATION_B, role: 'admin' },
    { orgId: ORGANIZATION_A, role: 'employee' },
  ],
  ORGANIZATION_A,
);
assert.equal(await refusal(list), 'redirect:/dashboard', 'joined employee on /mitarbeiter');
assert.equal(await refusal(customers), 'redirect:/dashboard', 'joined employee on /kunden');
assert.equal(await refusal(detail(colleagueId)), 'redirect:/dashboard', 'joined employee on a detail');
world.activeOrganizationCookie = ORGANIZATION_B;
assert.equal(field(await render(customers), 'props', 'href'), undefined, 'admin of B was sent from /kunden');
assert.deepEqual(await listedRecordIds(), [foreignRecordId]);
assert.deepEqual(await listedMemberIds(), [CALLER_ID, foreignColleagueId].sort());
const foreignMember = (await renderTree(detail(foreignColleagueId))).find(
  (element) => field(element, 'props', 'member') !== undefined,
);
assert.equal(
  field(foreignMember, 'props', 'member', 'userId'),
  foreignColleagueId,
  'admin of B does not open a person of B',
);

// A member of another organization finds no person or record by its id and lists none of them.
signInAsMember([{ orgId: ORGANIZATION_B, role: 'admin' }], ORGANIZATION_B);
for (const id of [colleagueId, colleagueRecordId, noLoginRecordId])
  assert.equal(await refusal(detail(id)), 'route-redirect:/mitarbeiter', `outsider on /mitarbeiter/${id}`);
assert.deepEqual(await listedRecordIds(), [foreignRecordId]);
assert.deepEqual(await listedMemberIds(), [CALLER_ID, foreignColleagueId].sort());

// Büro of the owning organization lists both people and opens both details.
signInAsMember([{ orgId: ORGANIZATION_A, role: 'buero' }], ORGANIZATION_A);
assert.deepEqual(await listedRecordIds(), [colleagueRecordId, noLoginRecordId].sort());
assert.deepEqual(await listedMemberIds(), [CALLER_ID, colleagueId].sort());
const member = (await renderTree(detail(colleagueId))).find(
  (element) => field(element, 'props', 'member') !== undefined,
);
assert.equal(field(member, 'props', 'member', 'userId'), colleagueId, 'buero does not open the colleague');
const record = (await renderTree(detail(noLoginRecordId))).find(
  (element) => field(element, 'props', 'detail') !== undefined,
);
assert.equal(
  field(record, 'props', 'detail', 'record', 'id'),
  noLoginRecordId,
  'buero does not open the record without login',
);

// Switching to an organization the caller also manages lists only that organization's people.
signInAsMember(
  [
    { orgId: ORGANIZATION_A, role: 'buero' },
    { orgId: ORGANIZATION_B, role: 'admin' },
  ],
  ORGANIZATION_B,
);
assert.deepEqual(await listedRecordIds(), [foreignRecordId]);
assert.deepEqual(await listedMemberIds(), [CALLER_ID, foreignColleagueId].sort());
world.activeOrganizationCookie = ORGANIZATION_A;
assert.deepEqual(await listedRecordIds(), [colleagueRecordId, noLoginRecordId].sort());
assert.deepEqual(await listedMemberIds(), [CALLER_ID, colleagueId].sort());
