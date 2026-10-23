// Actual installed-equipment actions over the in-memory database: a field
// worker is refused every register read and write before any database access
// and sees a job's equipment only on an own assigned job; equipment, sites,
// documents and jobs of another organization are unreachable.
import assert from 'node:assert/strict';
import { ORGANIZATION_A, ORGANIZATION_B, installActionWorld, signInAs } from './action-boundary-world';
import type { EquipmentFormInput } from '@/lib/installed-equipment/types';
import { assertRefused, refuseForeignIds } from './operations-boundary-refusals';

const ownClientId = '84000000-0000-4000-8000-000000000001';
const foreignClientId = '84000000-0000-4000-8000-000000000002';
const foreignSiteId = '84000000-0000-4000-8000-000000000003';
const foreignEquipmentId = '84000000-0000-4000-8000-000000000004';
const foreignJobId = '84000000-0000-4000-8000-000000000005';
const ownJobId = '84000000-0000-4000-8000-000000000006';
const foreignDocumentId = '84000000-0000-4000-8000-000000000007';
const foreignEventId = '84000000-0000-4000-8000-000000000008';
const newEquipmentId = '84000000-0000-4000-8000-000000000009';
const idempotencyKey = '84000000-0000-4000-8000-00000000000a';

const world = installActionWorld({
  jobs: [
    { id: ownJobId, organization_id: ORGANIZATION_A },
    { id: foreignJobId, organization_id: ORGANIZATION_B },
  ],
  job_assignments: [],
  installed_equipment: [
    {
      id: foreignEquipmentId,
      organization_id: ORGANIZATION_B,
      client_id: foreignClientId,
      equipment_number: 'ANL-0001',
      voided_at: null,
    },
  ],
  installed_equipment_work_links: [
    {
      id: idempotencyKey,
      organization_id: ORGANIZATION_B,
      job_id: foreignJobId,
      equipment_id: foreignEquipmentId,
    },
  ],
  documents: [{ id: foreignDocumentId, organization_id: ORGANIZATION_B, deleted_at: null }],
});
const {
  getInstalledEquipmentDetailByNumber,
  getInstalledEquipmentForClient,
  getAssignedEquipmentForJob,
  createInstalledEquipment,
  updateInstalledEquipment,
  transitionInstalledEquipment,
  setInstalledEquipmentArchived,
  replaceInstalledEquipment,
  correctInstalledEquipmentTerminalAction,
  setInstalledEquipmentWorkLink,
  linkInstalledEquipmentSource,
} = await import('@/lib/installed-equipment/actions');

const form = {
  clientId: ownClientId,
  siteId: foreignSiteId,
  name: 'Wärmepumpe Wohnhaus',
  category: 'heat_generation',
  subtype: 'heat_pump',
  state: 'unknown',
  identifiers: [],
} satisfies EquipmentFormInput;
const change = { expectedVersion: 1, reason: 'Angaben berichtigt', idempotencyKey };
const effectiveAt = '2026-10-01T08:00:00+02:00';
const writes = [
  [
    'createInstalledEquipment',
    () => createInstalledEquipment({ ...form, equipmentId: newEquipmentId, idempotencyKey }),
  ],
  [
    'updateInstalledEquipment',
    () => updateInstalledEquipment({ ...form, ...change, equipmentId: foreignEquipmentId }),
  ],
  [
    'transitionInstalledEquipment',
    () =>
      transitionInstalledEquipment({
        ...change,
        equipmentId: foreignEquipmentId,
        toState: 'active',
        effectiveAt,
      }),
  ],
  [
    'setInstalledEquipmentArchived',
    () => setInstalledEquipmentArchived({ ...change, equipmentId: foreignEquipmentId, archived: true }),
  ],
  [
    'replaceInstalledEquipment',
    () =>
      replaceInstalledEquipment({
        ...form,
        ...change,
        predecessorId: foreignEquipmentId,
        successorId: newEquipmentId,
        effectiveAt,
      }),
  ],
  [
    'correctInstalledEquipmentTerminalAction',
    () =>
      correctInstalledEquipmentTerminalAction({
        ...change,
        equipmentId: foreignEquipmentId,
        correctsEventId: foreignEventId,
        effectiveAt,
      }),
  ],
  [
    'setInstalledEquipmentWorkLink',
    () =>
      setInstalledEquipmentWorkLink({
        ...change,
        equipmentId: foreignEquipmentId,
        jobId: ownJobId,
        linked: true,
      }),
  ],
  [
    'linkInstalledEquipmentSource',
    () =>
      linkInstalledEquipmentSource({
        ...change,
        equipmentId: foreignEquipmentId,
        targetType: 'job',
        targetId: ownJobId,
      }),
  ],
] as const;
const registerReads = [
  ['getInstalledEquipmentDetailByNumber', () => getInstalledEquipmentDetailByNumber('ANL-0001')],
  ['getInstalledEquipmentForClient', () => getInstalledEquipmentForClient(foreignClientId)],
] as const;

// Field workers are refused the register before the service-role client exists.
signInAs(world, 'employee');
await assertRefused(
  world,
  [...registerReads, ...writes],
  { success: false, error: 'not_authorized' },
  'none',
);

// A field worker reads a job's equipment only on an own assigned job, and a
// foreign job is refused like an unassigned one.
await assertRefused(
  world,
  [
    ['getAssignedEquipmentForJob', () => getAssignedEquipmentForJob(foreignJobId)],
    ['getAssignedEquipmentForJob', () => getAssignedEquipmentForJob(ownJobId)],
  ],
  { success: false, error: 'not_authorized' },
  'reads',
);

// Büro finds no equipment number, customer list or job of another organization.
signInAs(world, 'buero');
await assertRefused(
  world,
  [registerReads[0]],
  { success: false, error: 'installed_equipment_not_found' },
  'reads',
);
assert.deepEqual(await getInstalledEquipmentForClient(foreignClientId), { success: true, equipment: [] });
await assertRefused(
  world,
  [['getAssignedEquipmentForJob', () => getAssignedEquipmentForJob(foreignJobId)]],
  { success: false, error: 'not_authorized' },
  'reads',
);
// A foreign document is no source, refused before the write function.
await assertRefused(
  world,
  [
    [
      'linkInstalledEquipmentSource',
      () =>
        linkInstalledEquipmentSource({
          ...change,
          equipmentId: foreignEquipmentId,
          targetType: 'document',
          targetId: foreignDocumentId,
          documentVersionNumber: 1,
        }),
    ],
  ],
  { success: false, error: 'installed_equipment_source_target_invalid' },
  'reads',
);

// The write functions refuse foreign equipment and sites under their lock
// because the action passes the caller's organization; one call each.
refuseForeignIds(
  world,
  new Map([
    [foreignEquipmentId, 'installed_equipment_not_found'],
    [foreignSiteId, 'installed_equipment_site_invalid'],
  ]),
);
await assertRefused(
  world,
  [writes[0]],
  { success: false, error: 'installed_equipment_site_invalid' },
  'one-call',
);
for (const write of writes.slice(1)) {
  await assertRefused(world, [write], { success: false, error: 'installed_equipment_not_found' }, 'one-call');
  assert.equal(
    world.rpcCalls[0]?.args.p_organization_id,
    ORGANIZATION_A,
    `${write[0]}: not the caller's organization`,
  );
}
