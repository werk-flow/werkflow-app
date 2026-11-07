// The actual entry review over the in-memory database, with the real
// responsibility resolution at action time: a caller outside an entry's
// organization gets one refusal, the same for an unknown id, a pending entry
// and a decided entry, so the answer says nothing about the entry. Inside the
// organization the pending state is reported only to an approver of its
// person, and one decision over several people loads the responsibility state
// once.
import assert from 'node:assert/strict';
import {
  ORGANIZATION_A,
  ORGANIZATION_B,
  installActionWorld,
  signInAs,
  tableRows,
} from './action-boundary-world';

const adminId = '6e000000-0000-4000-8000-000000000001';
const bueroId = '6e000000-0000-4000-8000-000000000002';
const fitterId = '6e000000-0000-4000-8000-000000000003';
const apprenticeId = '6e000000-0000-4000-8000-000000000004';
const people = [
  { userId: adminId, role: 'admin' },
  { userId: bueroId, role: 'buero' },
  { userId: fitterId, role: 'employee' },
  { userId: apprenticeId, role: 'employee' },
] as const;

const unknownEntry = '6e000000-0000-4000-8000-0000000000ff';
const fitterPending = '6e000000-0000-4000-8000-000000000101';
const fitterApproved = '6e000000-0000-4000-8000-000000000102';
const apprenticePending = '6e000000-0000-4000-8000-000000000103';
const apprenticeApproved = '6e000000-0000-4000-8000-000000000104';
const bueroPending = '6e000000-0000-4000-8000-000000000105';
const otherOrganizationPending = '6e000000-0000-4000-8000-000000000201';

const entry = (id: string, userId: string, status: string, organizationId = ORGANIZATION_A) => ({
  id,
  organization_id: organizationId,
  user_id: userId,
  entry_type: 'clock_in',
  status,
  timestamp: '2026-10-13T06:00:00.000Z',
  created_at: '2026-10-13T09:00:00.000Z',
  job_id: null,
  notes: null,
});

const world = installActionWorld({
  organizations: [{ id: ORGANIZATION_A, admin_id: adminId }],
  organization_members: people.map(({ userId, role }, index) => ({
    id: `6e000000-0000-4000-8000-00000000005${index}`,
    organization_id: ORGANIZATION_A,
    user_id: userId,
    role,
  })),
  // The responsibility read embeds each record's access lifecycle and open access blockers.
  employee_records: people.map(({ userId }, index) => ({
    id: `6e000000-0000-4000-8000-00000000001${index}`,
    organization_id: ORGANIZATION_A,
    user_id: userId,
    first_name: 'Erika',
    last_name: 'Beispiel',
    exit_date: null,
    personnel_access_lifecycles: [],
    personnel_onboarding_requirements: [],
  })),
  profiles: people.map(({ userId }) => ({ id: userId, first_name: 'Erika', last_name: 'Beispiel' })),
  time_entries: [
    entry(fitterPending, fitterId, 'pending'),
    entry(fitterApproved, fitterId, 'approved'),
    entry(apprenticePending, apprenticeId, 'pending'),
    entry(apprenticeApproved, apprenticeId, 'approved'),
    entry(bueroPending, bueroId, 'pending'),
    entry(otherOrganizationPending, bueroId, 'pending', ORGANIZATION_B),
  ],
  // Role defaults decide: Admin approves Büro and employees, Büro approves employees.
  organization_responsibility_configurations: [],
  organization_responsibility_assignments: [],
  organization_responsibility_delegations: [],
});

// Each read of the responsibility configurations is one load of the responsibility state.
let responsibilityLoads = 0;
const configurations = tableRows(world, 'organization_responsibility_configurations');
Object.defineProperty(world.tables, 'organization_responsibility_configurations', {
  enumerable: true,
  get: () => {
    responsibilityLoads += 1;
    return configurations;
  },
});
world.rpc = ({ args }) => ({
  data: Array.isArray(args.p_entry_ids) ? args.p_entry_ids.length : 0,
  error: null,
});
const { reviewEntries } = await import('@/lib/time-tracking/review-actions');

const statuses = (): unknown[] => tableRows(world, 'time_entries').map((row) => row.status);
const statusesBefore = statuses();

/** The refusals of every request; none of them reaches the database function or changes an entry. */
async function refusalsOf(requests: readonly string[][]): Promise<unknown[]> {
  world.rpcCalls.length = 0;
  const results = [];
  for (const entryIds of requests) results.push(await reviewEntries(entryIds, 'approved'));
  assert.deepEqual(world.rpcCalls, [], 'a refused review reached the database function');
  assert.deepEqual(statuses(), statusesBefore, 'a refused review changed an entry');
  return results;
}

/** All refusals are one and the same, and it is a refusal. */
function assertOneRefusal(results: readonly unknown[], who: string): void {
  const [first] = results;
  assert.deepEqual(
    results,
    results.map(() => first),
    `${who}: the refusal differs between an unknown, a pending and a decided entry`,
  );
  assert.equal(Reflect.get(Object(first), 'success'), false, `${who}: the review was not refused`);
}

const foreignRequests = [[unknownEntry], [fitterPending], [fitterApproved]];

// An Admin of another organization learns nothing about this organization's
// entries, alone or mixed with an entry of their own organization.
signInAs(world, 'admin', ORGANIZATION_B);
world.callerId = adminId;
assertOneRefusal(await refusalsOf(foreignRequests), 'an Admin of another organization');
assertOneRefusal(
  await refusalsOf(foreignRequests.map((ids) => [otherOrganizationPending, ...ids])),
  'an Admin of another organization with an own entry in the selection',
);

// A signed-in person without any membership learns nothing either.
signInAs(world, null);
assertOneRefusal(await refusalsOf(foreignRequests), 'a person without a membership');

// A field worker who approves nobody learns nothing about a colleague's entry.
signInAs(world, 'employee');
world.callerId = fitterId;
assert.deepEqual(await refusalsOf([[apprenticePending], [apprenticeApproved]]), [
  { success: false, error: 'not_responsible' },
  { success: false, error: 'not_responsible' },
]);

// The approver hears that an entry was already decided, and decides the
// pending entries of three people with one load of the responsibility state.
signInAs(world, 'admin');
world.callerId = adminId;
assert.deepEqual(await refusalsOf([[fitterApproved], [fitterPending, apprenticeApproved]]), [
  { success: false, error: 'entry_not_pending' },
  { success: false, error: 'entry_not_pending' },
]);
responsibilityLoads = 0;
world.rpcCalls.length = 0;
assert.deepEqual(await reviewEntries([fitterPending, apprenticePending, bueroPending], 'approved'), {
  success: true,
  reviewed: 3,
});
assert.equal(
  responsibilityLoads,
  1,
  'the responsibility state loaded once per person, not once per decision',
);
assert.deepEqual(
  world.rpcCalls.map(({ name, args }) => [name, args.p_organization_id, args.p_actor_id]),
  [['review_time_entries', ORGANIZATION_A, adminId]],
);
