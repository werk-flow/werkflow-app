// Actual access proposal actions over the in-memory database: a field worker
// proposes only for a job of their organization they are assigned to, and
// only for that job's Einsatzort, before any write; only a manager decides,
// inside their organization; a refused call writes nothing. The database
// functions' own refusals are proven by supabase/tests/site_access_proposals.sql.
import assert from 'node:assert/strict';
import {
  CALLER_ID,
  ORGANIZATION_A,
  ORGANIZATION_B,
  installActionWorld,
  signInAs,
} from './action-boundary-world';
import { assertRefused, refuseForeignIds } from './operations-boundary-refusals';

const assignedJobId = '8f000000-0000-4000-8000-000000000001';
const unassignedJobId = '8f000000-0000-4000-8000-000000000002';
const foreignJobId = '8f000000-0000-4000-8000-000000000003';
const siteId = '8f000000-0000-4000-8000-000000000011';
const otherSiteId = '8f000000-0000-4000-8000-000000000012';
const foreignSiteId = '8f000000-0000-4000-8000-000000000013';
const proposalId = '8f000000-0000-4000-8000-000000000021';
const foreignProposalId = '8f000000-0000-4000-8000-000000000029';
const foreignContactId = '8f000000-0000-4000-8000-000000000039';
const contactId = '8f000000-0000-4000-8000-000000000031';
// Access notes another decision has replaced since the review showed them.
const staleNotes = 'Schlüssel beim alten Hausmeister';

const world = installActionWorld({
  jobs: [
    { id: assignedJobId, organization_id: ORGANIZATION_A, site_id: siteId, title: 'Heizung warten' },
    { id: unassignedJobId, organization_id: ORGANIZATION_A, site_id: siteId, title: 'Bad sanieren' },
    { id: foreignJobId, organization_id: ORGANIZATION_B, site_id: foreignSiteId, title: 'Fremder Auftrag' },
  ],
  job_assignments: [
    {
      id: '8f000000-0000-4000-8000-000000000041',
      organization_id: ORGANIZATION_A,
      job_id: assignedJobId,
      user_id: CALLER_ID,
    },
    // The caller is on the foreign job in the other organization, where they are no member.
    {
      id: '8f000000-0000-4000-8000-000000000042',
      organization_id: ORGANIZATION_B,
      job_id: foreignJobId,
      user_id: CALLER_ID,
    },
  ],
});
const { proposeSiteAccess, acceptSiteAccessProposal, rejectSiteAccessProposal } = await import(
  '@/lib/site-access-proposals/actions'
);

const propose = (jobId: string, site: string) => () =>
  proposeSiteAccess({
    jobId,
    siteId: site,
    contactName: 'Erika Musterfrau',
    contactPhone: '0160 123',
    contactNote: '',
    accessNotes: 'Über den Hof',
  });
const accept =
  (id: string, contact: string | null = null, reviewedAccessNotes = 'Über den Hof') =>
  () =>
    acceptSiteAccessProposal({
      proposalId: id,
      revision: 1,
      reviewedAccessNotes,
      contact: contact === null ? null : { id: contact, reviewedName: 'Herr Alt', reviewedPhone: '030 111' },
    });
const reject = (id: string) => () =>
  rejectSiteAccessProposal({ proposalId: id, revision: 1, reason: 'Stimmt nicht' });

// Signed out, nothing reaches the database.
signInAs(world, null);
world.callerId = null;
await assertRefused(
  world,
  [
    ['proposeSiteAccess', propose(assignedJobId, siteId)],
    ['acceptSiteAccessProposal', accept(proposalId)],
    ['rejectSiteAccessProposal', reject(proposalId)],
  ],
  { success: false, error: 'not_authenticated' },
  'none',
);

// A field worker never decides.
signInAs(world, 'employee');
await assertRefused(
  world,
  [
    ['acceptSiteAccessProposal', accept(proposalId)],
    ['rejectSiteAccessProposal', reject(proposalId)],
  ],
  { success: false, error: 'not_authorized' },
  'none',
);

// A field worker proposes only on a job they are assigned to, of their own
// organization, for that job's Einsatzort; each refusal comes before the write.
await assertRefused(
  world,
  [['proposeSiteAccess', propose(unassignedJobId, siteId)]],
  { success: false, error: 'not_authorized' },
  'reads',
);
await assertRefused(
  world,
  [['proposeSiteAccess', propose(foreignJobId, foreignSiteId)]],
  { success: false, error: 'job_not_found' },
  'reads',
);
await assertRefused(
  world,
  [['proposeSiteAccess', propose(assignedJobId, otherSiteId)]],
  { success: false, error: 'site_not_on_job' },
  'reads',
);

// A manager who is not on the job's team proposes nothing either.
signInAs(world, 'buero');
await assertRefused(
  world,
  [['proposeSiteAccess', propose(unassignedJobId, siteId)]],
  { success: false, error: 'not_authorized' },
  'reads',
);

// A manager's decision is one database call with the caller's organization;
// a foreign proposal or contact is refused there with the real function's code.
refuseForeignIds(
  world,
  new Map([
    [foreignProposalId, 'proposal_not_found'],
    [foreignContactId, 'contact_not_found'],
    [staleNotes, 'site_changed'],
  ]),
);
await assertRefused(
  world,
  [
    ['acceptSiteAccessProposal', accept(foreignProposalId)],
    ['rejectSiteAccessProposal', reject(foreignProposalId)],
  ],
  { success: false, error: 'proposal_not_found' },
  'one-call',
);
await assertRefused(
  world,
  [['acceptSiteAccessProposal', accept(proposalId, foreignContactId)]],
  { success: false, error: 'contact_not_found' },
  'one-call',
);
assert.equal(world.rpcCalls.at(-1)?.args.p_organization_id, ORGANIZATION_A);
assert.equal(world.rpcCalls.at(-1)?.args.p_actor_id, CALLER_ID);

// An acceptance names what its review showed; an Einsatzort another decision
// changed since then refuses it in the database with nothing written.
await assertRefused(
  world,
  [['acceptSiteAccessProposal', accept(proposalId, contactId, staleNotes)]],
  { success: false, error: 'site_changed' },
  'one-call',
);
assert.deepEqual(
  {
    notes: world.rpcCalls.at(-1)?.args.p_reviewed_access_notes,
    contact: world.rpcCalls.at(-1)?.args.p_contact_id,
    name: world.rpcCalls.at(-1)?.args.p_reviewed_contact_name,
    phone: world.rpcCalls.at(-1)?.args.p_reviewed_contact_phone,
  },
  { notes: staleNotes, contact: contactId, name: 'Herr Alt', phone: '030 111' },
);

// Malformed input never reaches the database.
await assertRefused(
  world,
  [
    ['rejectSiteAccessProposal', () => rejectSiteAccessProposal({ proposalId, revision: 1, reason: ' a ' })],
    [
      'acceptSiteAccessProposal',
      () =>
        acceptSiteAccessProposal({
          proposalId: 'kein-id',
          revision: 1,
          reviewedAccessNotes: '',
          contact: null,
        }),
    ],
  ],
  { success: false, error: 'invalid_input' },
  'none',
);

// Reviewed access notes are the Einsatzort's as they are, longer than any
// proposal may be: the acceptance still reaches the database.
world.rpc = () => ({ data: { id: proposalId }, error: null });
world.rpcCalls.length = 0;
const longNotes = 'Schlüssel beim Hausmeister. '.repeat(200);
assert.ok(longNotes.length > 2000);
assert.deepEqual(await accept(proposalId, null, longNotes)(), { success: true });
assert.equal(world.rpcCalls.length, 1);
assert.equal(world.rpcCalls[0]?.args.p_reviewed_access_notes, longNotes);

// The assigned field worker's proposal is one call naming the caller, the
// organization, the job and its Einsatzort.
signInAs(world, 'employee');
world.rpc = () => ({ data: { id: proposalId }, error: null });
world.rpcCalls.length = 0;
assert.deepEqual(await propose(assignedJobId, siteId)(), { success: true, proposalId });
assert.equal(world.rpcCalls.length, 1);
assert.deepEqual(
  {
    name: world.rpcCalls[0]?.name,
    actor: world.rpcCalls[0]?.args.p_actor_id,
    organization: world.rpcCalls[0]?.args.p_organization_id,
    job: world.rpcCalls[0]?.args.p_job_id,
    site: world.rpcCalls[0]?.args.p_site_id,
  },
  {
    name: 'propose_site_access',
    actor: CALLER_ID,
    organization: ORGANIZATION_A,
    job: assignedJobId,
    site: siteId,
  },
);
