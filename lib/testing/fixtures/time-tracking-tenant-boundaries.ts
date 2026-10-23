// Actual time-tracking review, clock-state, entry-read and activity actions
// over the in-memory database: an organization id the caller is no member of
// is refused for the review queues, the active-job read and an activity
// transition; a project of another organization reads no time entries; an
// employee reads no change-request queue; and a change request of another
// organization never appears for its entry. A refused call writes nothing.
import assert from 'node:assert/strict';
import { ORGANIZATION_A, ORGANIZATION_B, installActionWorld, signInAs } from './action-boundary-world';
import { databaseSnapshot } from './workforce-boundary-support';

const foreignProjectId = '8c000000-0000-4000-8000-000000000001';
const foreignEntryId = '8c000000-0000-4000-8000-000000000002';
const foreignUserId = '8c000000-0000-4000-8000-000000000003';

const world = installActionWorld({
  projects: [{ id: foreignProjectId, organization_id: ORGANIZATION_B }],
  time_entries: [
    {
      id: foreignEntryId,
      organization_id: ORGANIZATION_B,
      user_id: foreignUserId,
      entry_type: 'clock_in',
      timestamp: '2026-10-20T07:00:00.000Z',
      status: 'pending_delete',
    },
  ],
  entry_change_requests: [
    {
      id: '8c000000-0000-4000-8000-000000000004',
      organization_id: ORGANIZATION_B,
      entry_id: foreignEntryId,
      requested_by: foreignUserId,
      change_type: 'delete',
      status: 'pending',
    },
  ],
});
const { getChangeRequestsForEntries, getPendingChangeRequests, getPendingSessions } = await import(
  '@/lib/time-tracking/review-actions'
);
const { getActiveJobIdsForOrg } = await import('@/lib/time-tracking/clock-state-actions');
const { getTimeEntriesForProjectJobs } = await import('@/lib/time-tracking/entry-read-actions');
const { transitionTimeActivity } = await import('@/lib/time-tracking/segment-actions');

const initialDatabase = databaseSnapshot(world);
const notAMember = { success: false, error: 'not_a_member' };

// An Admin of organization A is no member of organization B.
signInAs(world, 'admin');
assert.deepEqual(await getPendingSessions(ORGANIZATION_B), notAMember);
assert.deepEqual(await getPendingChangeRequests(ORGANIZATION_B), notAMember);
assert.deepEqual(await getActiveJobIdsForOrg(ORGANIZATION_B), notAMember);
assert.deepEqual(await getTimeEntriesForProjectJobs(foreignProjectId), notAMember);
assert.deepEqual(
  await transitionTimeActivity({
    organizationId: ORGANIZATION_B,
    operationId: '8c000000-0000-4000-8000-000000000005',
    action: 'end',
    expectedSessionId: null,
    expectedVersion: null,
    selection: null,
    acknowledgeLong: false,
  }),
  notAMember,
);
assert.equal(world.rpcCalls.length, 0);

// A change request of organization B never appears for its entry.
assert.deepEqual(await getChangeRequestsForEntries([foreignEntryId]), { success: true, requests: [] });

// An employee reads no change-request queue of their own organization.
signInAs(world, 'employee');
assert.deepEqual(await getPendingChangeRequests(ORGANIZATION_A), { success: false, error: 'not_authorized' });
assert.equal(databaseSnapshot(world), initialDatabase, 'no refused call may write');
