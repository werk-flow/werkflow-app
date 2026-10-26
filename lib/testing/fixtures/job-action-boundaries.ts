// Actual Auftrag actions over the in-memory database: only managers create,
// edit, reassign and delete, a field worker reads only a job assigned to them
// and only the field facts of its customer, site, contact and team, and a job
// of another organization is unreachable by id and by number.
import assert from 'node:assert/strict';
import {
  CALLER_ID,
  ORGANIZATION_A,
  ORGANIZATION_B,
  installActionWorld,
  signInAs,
  tableRows,
} from './action-boundary-world';

const assignedJobId = '50000000-0000-4000-8000-000000000001';
const unassignedJobId = '50000000-0000-4000-8000-000000000002';
const foreignJobId = '50000000-0000-4000-8000-000000000009';
const colleagueId = '30000000-0000-4000-8000-000000000021';
const clientId = '53000000-0000-4000-8000-000000000001';
const siteId = '53000000-0000-4000-8000-000000000002';
const contactId = '53000000-0000-4000-8000-000000000003';
const now = '2026-10-01T08:00:00.000Z';

const jobRow = (id: string, organizationId: string, jobNumber: string): Record<string, unknown> => ({
  id,
  organization_id: organizationId,
  project_id: null,
  client_id: null,
  site_id: null,
  contact_id: null,
  job_number: jobNumber,
  title: 'Heizungswartung',
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
  created_at: now,
  updated_at: now,
});
const assignment = (id: string, organizationId: string, jobId: string, userId: string) => ({
  id,
  organization_id: organizationId,
  job_id: jobId,
  user_id: userId,
  assigned_by: CALLER_ID,
  assigned_at: now,
});

const world = installActionWorld({
  jobs: [
    {
      ...jobRow(assignedJobId, ORGANIZATION_A, 'A-2026-001'),
      client_id: clientId,
      site_id: siteId,
      contact_id: contactId,
    },
    jobRow(unassignedJobId, ORGANIZATION_A, 'A-2026-002'),
    jobRow(foreignJobId, ORGANIZATION_B, 'A-2026-900'),
  ],
  job_assignments: [
    assignment('51000000-0000-4000-8000-000000000001', ORGANIZATION_A, assignedJobId, CALLER_ID),
    assignment('51000000-0000-4000-8000-000000000002', ORGANIZATION_A, unassignedJobId, colleagueId),
    assignment('51000000-0000-4000-8000-000000000003', ORGANIZATION_A, assignedJobId, colleagueId),
    assignment('51000000-0000-4000-8000-000000000009', ORGANIZATION_B, foreignJobId, CALLER_ID),
  ],
  // Two scheduled visits: the assigned job is planned on the Plantafel.
  planning_occurrences: ['52000000-0000-4000-8000-000000000001', '52000000-0000-4000-8000-000000000002'].map(
    (id) => ({ id, organization_id: ORGANIZATION_A, job_id: assignedJobId, status: 'scheduled' }),
  ),
  profiles: [
    { id: CALLER_ID, first_name: 'Erika', last_name: 'Muster', email: null, avatar_path: null },
    {
      id: colleagueId,
      first_name: 'Max',
      last_name: 'Kollege',
      email: 'max@example.test',
      avatar_path: 'avatars/max.png',
    },
  ],
  // Every office-only field carries a value, so a projection that lets one through fails below.
  clients: [
    {
      id: clientId,
      organization_id: ORGANIZATION_A,
      name: 'Familie Berger',
      client_type: 'privat',
      customer_number: 'K-1001',
      email: 'berger@example.test',
      phone: '+49 30 1234',
      address: 'Rechnungsweg 1, 10115 Berlin',
      notes: 'Zahlt spät',
      created_at: now,
      updated_at: now,
    },
  ],
  client_sites: [
    {
      id: siteId,
      organization_id: ORGANIZATION_A,
      client_id: clientId,
      name: 'Wohnhaus',
      street: 'Gartenweg 2',
      postal_code: '10115',
      city: 'Berlin',
      access_notes: 'Hintereingang nutzen',
      notes: 'Interne Standortnotiz',
      primary_contact_id: contactId,
      is_primary: true,
      is_active: true,
      created_by: CALLER_ID,
      created_at: now,
      updated_at: now,
    },
  ],
  client_contacts: [
    {
      id: contactId,
      organization_id: ORGANIZATION_A,
      client_id: clientId,
      name: 'Anna Berger',
      role: 'Eigentümer/in',
      email: 'anna@example.test',
      phone: '+49 170 5678',
      notes: 'Interne Kontaktnotiz',
      is_primary: true,
      is_active: true,
      created_by: CALLER_ID,
      created_at: now,
      updated_at: now,
    },
  ],
});
const actions = await import('@/lib/jobs/actions');

const databaseSnapshot = (): string => JSON.stringify(world.tables);
const initialDatabase = databaseSnapshot();
const notAuthorized = { success: false, error: 'not_authorized' };
const jobNotFound = { success: false, error: 'job_not_found' };

// Signed-out callers and callers without an organization are denied before the database.
world.callerId = null;
assert.deepEqual(await actions.getJobDetails(assignedJobId), { success: false, error: 'not_authenticated' });
signInAs(world, null);
assert.deepEqual(await actions.deleteJob(assignedJobId), { success: false, error: 'no_active_org' });

// A field worker creates, edits, reassigns and deletes nothing, and is refused before the database.
signInAs(world, 'employee');
assert.deepEqual(await actions.createJob({ title: 'Neuer Auftrag' }), notAuthorized);
assert.deepEqual(await actions.updateJob(assignedJobId, { title: 'Übernommen' }), notAuthorized);
assert.deepEqual(await actions.updateJobAssignments(assignedJobId, [CALLER_ID]), notAuthorized);
assert.deepEqual(await actions.deleteJob(assignedJobId), notAuthorized);
assert.equal(world.adminClientRequests, 0);

// A field worker reads a job only when it is assigned to them, never another organization's.
const assignedDetails = await actions.getJobDetails(assignedJobId);
assert.ok(assignedDetails.success);
assert.equal(assignedDetails.job.id, assignedJobId);
assert.deepEqual(
  assignedDetails.job.assignments.map((entry) => entry.userId),
  [CALLER_ID, colleagueId],
);
// The field read carries only the field facts: no customer record, no office
// notes, no contact email, no teammate email or avatar.
assert.deepEqual(await actions.getJobByNumber('A-2026-001'), { success: true, job: assignedDetails.job });
assert.deepEqual(assignedDetails.job.client, {
  id: clientId,
  organizationId: ORGANIZATION_A,
  name: 'Familie Berger',
  clientType: 'privat',
  customerNumber: null,
  email: null,
  phone: '+49 30 1234',
  address: null,
  notes: null,
  createdAt: now,
  updatedAt: now,
});
assert.deepEqual(assignedDetails.job.site, {
  id: siteId,
  organizationId: ORGANIZATION_A,
  clientId,
  name: 'Wohnhaus',
  street: 'Gartenweg 2',
  postalCode: '10115',
  city: 'Berlin',
  accessNotes: 'Hintereingang nutzen',
  notes: null,
  primaryContactId: null,
  isPrimary: true,
  isActive: true,
  createdBy: null,
  createdAt: now,
  updatedAt: now,
});
assert.deepEqual(assignedDetails.job.contact, {
  id: contactId,
  organizationId: ORGANIZATION_A,
  clientId,
  name: 'Anna Berger',
  role: 'Eigentümer/in',
  email: null,
  phone: '+49 170 5678',
  notes: null,
  isPrimary: true,
  isActive: true,
  createdBy: null,
  createdAt: now,
  updatedAt: now,
});
assert.deepEqual(
  assignedDetails.job.assignments.map(({ email, avatarPath }) => ({ email, avatarPath })),
  [
    { email: null, avatarPath: null },
    { email: null, avatarPath: null },
  ],
);
assert.deepEqual(await actions.getJobDetails(unassignedJobId), notAuthorized);
assert.deepEqual(await actions.getJobByNumber('A-2026-002'), notAuthorized);
assert.deepEqual(await actions.getJobDetails(foreignJobId), jobNotFound);
assert.deepEqual(await actions.getJobByNumber('A-2026-900'), jobNotFound);

// A manager of organization A reads the full customer, site, contact and team of a job.
signInAs(world, 'buero');
const managerDetails = await actions.getJobDetails(assignedJobId);
assert.ok(managerDetails.success);
assert.equal(managerDetails.job.client?.notes, 'Zahlt spät');
assert.equal(managerDetails.job.site?.notes, 'Interne Standortnotiz');
assert.equal(managerDetails.job.contact?.email, 'anna@example.test');
assert.equal(managerDetails.job.assignments[1]?.email, 'max@example.test');

// A manager of organization A reaches no job of organization B by id or by number.
assert.deepEqual(await actions.getJobDetails(foreignJobId), jobNotFound);
assert.deepEqual(await actions.getJobByNumber('A-2026-900'), jobNotFound);
assert.deepEqual(await actions.updateJob(foreignJobId, { title: 'Übernommen' }), jobNotFound);
assert.deepEqual(await actions.updateJobAssignments(foreignJobId, [CALLER_ID]), jobNotFound);
signInAs(world, 'admin');
assert.deepEqual(await actions.deleteJob(foreignJobId), jobNotFound);
assert.equal(databaseSnapshot(), initialDatabase, 'no denied call may write');
assert.deepEqual(world.rpcCalls, []);

// A job with several scheduled visits keeps its schedule: the edit is refused before any write.
assert.deepEqual(await actions.updateJob(assignedJobId, { plannedDate: '2026-11-02' }), {
  success: false,
  error: 'job_has_several_visits',
});
assert.equal(databaseSnapshot(), initialDatabase, 'a refused schedule edit writes nothing');
assert.deepEqual(world.rpcCalls, []);

// The same manager deletes an own job: exactly that row goes, organization B's job stays.
assert.deepEqual(await actions.deleteJob(unassignedJobId), { success: true });
assert.deepEqual(
  tableRows(world, 'jobs').map((job) => job.id),
  [assignedJobId, foreignJobId],
);
