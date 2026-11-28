// The order actions and reads over the in-memory database: a field worker
// converts nothing and reads no order with prices; another organization's
// offer is refused by the one database function the conversion calls; the
// scope of a job reaches its assigned employee and its project lead only,
// never an employee who is neither or another organization's job, and never
// with a price even when the database answered one.
// supabase/tests/offer_conversion.sql proves the functions' refusals, grants and history.
import assert from 'node:assert/strict';
import { mock } from 'bun:test';
import {
  CALLER_ID,
  ORGANIZATION_A,
  ORGANIZATION_B,
  installActionWorld,
  signInAs,
} from './action-boundary-world';
import { assertRefused, refuseForeignIds } from './operations-boundary-refusals';

const ownOfferId = '95100000-0000-4000-8000-000000000101';
const foreignOfferId = '95100000-0000-4000-8000-000000000109';
const ownJob = '95100000-0000-4000-8000-000000000201';
const foreignJob = '95100000-0000-4000-8000-000000000209';
const project = '95100000-0000-4000-8000-000000000301';
const newJob = '95100000-0000-4000-8000-000000000401';

/** What read_work_lead_scope answers for the caller. */
let leadScope: { projectIds: string[]; jobIds: string[] } = { projectIds: [], jobIds: [] };
// The scope as the database answers it, with a stray amount the projection must not pass on.
const scopeAnswer = [
  {
    offerNumber: 'ANG-2026-014',
    workKind: 'job',
    sections: [
      {
        number: '1',
        title: 'Wärmeerzeuger',
        lines: [
          {
            number: '1.1',
            kind: 'free',
            name: 'Gas-Brennwerttherme',
            description: '',
            quantity: '1.000',
            unitLabel: 'Stk.',
            amountCents: 489000,
          },
        ],
      },
    ],
  },
];

const world = installActionWorld({
  projects: [
    { id: project, organization_id: ORGANIZATION_A, name: 'Neubau Lindenstraße', project_number: 'PRJ-1' },
  ],
  jobs: [
    { id: ownJob, organization_id: ORGANIZATION_A, project_id: null, job_number: 'AUF-1', title: 'Heizung' },
    {
      id: foreignJob,
      organization_id: ORGANIZATION_B,
      project_id: null,
      job_number: 'AUF-9',
      title: 'Fremd',
    },
  ],
  job_assignments: [],
});
mock.module('next/cache', () => ({ updateTag: () => {}, revalidatePath: () => {}, revalidateTag: () => {} }));

const { convertOfferToWork } = await import('@/lib/orders/actions');
const { readWorkOrders, readWorkScope } = await import('@/lib/orders/reads');

const convert = (offerId: string) =>
  convertOfferToWork({
    offerId,
    expectedVersion: 3,
    attemptKey: '96100000-0000-4000-8000-000000000101',
    target: 'job',
    title: 'Heizung Hofweg 1',
  });
const notAuthorized = { success: false, error: 'not_authorized' };

// A field worker converts nothing and reads no priced order; nothing reaches the database.
signInAs(world, 'employee');
await assertRefused(
  world,
  [
    ['convertOfferToWork', () => convert(ownOfferId)],
    ['readWorkOrders', () => readWorkOrders({ targetType: 'job', targetId: ownJob })],
  ],
  notAuthorized,
  'none',
);

// Admin and Büro: another organization's offer is refused by the one call, which carries the
// caller's own organization and person.
const converted = { version: 4, kind: 'job', workId: newJob, unplannedPositions: ['1.3'] };
for (const role of ['admin', 'buero'] as const) {
  signInAs(world, role);
  refuseForeignIds(world, new Map([[foreignOfferId, 'offer_not_found']]), converted);
  await assertRefused(
    world,
    [['convertOfferToWork of a foreign offer', () => convert(foreignOfferId)]],
    { success: false, error: 'offer_not_found' },
    'one-call',
  );
  world.rpcCalls.length = 0;
  assert.deepEqual(await convert(ownOfferId), { success: true, offerId: ownOfferId, ...converted });
  assert.deepEqual(
    world.rpcCalls.map((call) => [
      call.name,
      call.args.p_organization_id,
      call.args.p_actor_id,
      call.args.p_target,
    ]),
    [['convert_offer_to_work', ORGANIZATION_A, CALLER_ID, 'job']],
  );
}

// A bad id, an unknown target or a new job without a title never reaches the database.
await assertRefused(
  world,
  [
    ['bad offer id', () => convertOfferToWork({ ...convertInput(), offerId: 'not-a-uuid' })],
    ['new job without title', () => convertOfferToWork({ ...convertInput(), title: '  ' })],
  ],
  { success: false, error: 'invalid_input' },
  'none',
);

function convertInput() {
  return {
    offerId: ownOfferId,
    expectedVersion: 3,
    attemptKey: '96100000-0000-4000-8000-000000000102',
    target: 'job' as const,
    title: 'Heizung Hofweg 1',
  };
}

world.rpc = ({ name }) => {
  if (name === 'read_work_lead_scope') return { data: structuredClone(leadScope), error: null };
  if (name === 'get_work_scope') return { data: structuredClone(scopeAnswer), error: null };
  return { data: null, error: { code: 'P0001', message: `unexpected_function_${name}` } };
};
const scopeReads = () => world.rpcCalls.filter((call) => call.name === 'get_work_scope');
const jobTarget = { targetType: 'job', targetId: ownJob } as const;

// An employee who is neither assigned nor its lead, and anyone asking for another organization's
// job, reads no scope; the scope is never read for them.
signInAs(world, 'employee');
for (const [label, target] of [
  ['an unassigned employee', jobTarget],
  ['another organization’s job', { targetType: 'job', targetId: foreignJob }],
  ['a project the employee does not lead', { targetType: 'project', targetId: project }],
] as const) {
  world.rpcCalls.length = 0;
  assert.deepEqual(await readWorkScope(target), notAuthorized, label);
  assert.equal(scopeReads().length, 0, `${label}: the scope was read`);
}
// A failed lead rule is a load failure, never access.
world.rpc = ({ name }) =>
  name === 'read_work_lead_scope'
    ? { data: null, error: { code: '08006', message: 'connection_failure' } }
    : { data: structuredClone(scopeAnswer), error: null };
assert.deepEqual(await readWorkScope(jobTarget), { success: false, error: 'load_failed' });
world.rpc = ({ name }) =>
  name === 'read_work_lead_scope'
    ? { data: structuredClone(leadScope), error: null }
    : { data: structuredClone(scopeAnswer), error: null };

// The assigned employee and the job's lead read the scope, of the caller's organization, without the price.
const expectedScope = {
  success: true,
  scope: [
    {
      offerNumber: 'ANG-2026-014',
      workKind: 'job',
      sections: [
        {
          number: '1',
          title: 'Wärmeerzeuger',
          lines: [
            {
              kind: 'position',
              number: '1.1',
              name: 'Gas-Brennwerttherme',
              description: '',
              quantity: '1.000',
              unitLabel: 'Stk.',
            },
          ],
        },
      ],
    },
  ],
};
world.tables.job_assignments = [
  { id: crypto.randomUUID(), organization_id: ORGANIZATION_A, job_id: ownJob, user_id: CALLER_ID },
];
world.rpcCalls.length = 0;
assert.deepEqual(await readWorkScope(jobTarget), expectedScope);
assert.deepEqual(scopeReads()[0]?.args, {
  p_organization_id: ORGANIZATION_A,
  p_kind: 'job',
  p_work_id: ownJob,
});
world.tables.job_assignments = [];
leadScope = { projectIds: [project], jobIds: [ownJob] };
assert.deepEqual(await readWorkScope(jobTarget), expectedScope);
assert.deepEqual(await readWorkScope({ targetType: 'project', targetId: project }), expectedScope);
