// Actual inventory catalog, stock and material actions over the in-memory
// database: a field worker is refused the catalog and its writes before any
// database access and books material only on an own assigned job; a job,
// project, item or material line of another organization is not found before
// any write, and the stock write functions receive the caller's organization.
import assert from 'node:assert/strict';
import { ORGANIZATION_A, ORGANIZATION_B, installActionWorld, signInAs } from './action-boundary-world';
import { assertRefused, refuseForeignIds } from './operations-boundary-refusals';

const ownJobId = '90000000-0000-4000-8000-000000000001';
const foreignJobId = '90000000-0000-4000-8000-000000000002';
const ownProjectId = '90000000-0000-4000-8000-000000000003';
const foreignProjectId = '90000000-0000-4000-8000-000000000004';
const foreignItemId = '90000000-0000-4000-8000-000000000005';
const foreignLineId = '90000000-0000-4000-8000-000000000006';
const foreignLocationId = '90000000-0000-4000-8000-000000000007';

const world = installActionWorld({
  jobs: [
    { id: ownJobId, organization_id: ORGANIZATION_A, project_id: null },
    { id: foreignJobId, organization_id: ORGANIZATION_B, project_id: foreignProjectId },
  ],
  projects: [
    { id: ownProjectId, organization_id: ORGANIZATION_A },
    { id: foreignProjectId, organization_id: ORGANIZATION_B },
  ],
  job_assignments: [],
  inventory_items: [{ id: foreignItemId, organization_id: ORGANIZATION_B }],
  inventory_locations: [{ id: foreignLocationId, organization_id: ORGANIZATION_B }],
  job_material_lines: [
    {
      id: foreignLineId,
      organization_id: ORGANIZATION_B,
      job_id: foreignJobId,
      project_id: foreignProjectId,
      item_id: foreignItemId,
      taken_quantity: 2,
      returned_quantity: 0,
    },
  ],
});
const { getInventoryOverview, getInventoryLocationOptions, upsertInventoryItem } = await import(
  '@/lib/inventory/catalog-actions'
);
const {
  getInventoryPickerPage,
  getInventoryPickerOptionsForJob,
  createInventoryLocation,
  adjustInventoryStock,
  createJobMaterialLine,
  createProjectMaterialLine,
  getJobMaterialLines,
  getProjectMaterialSummary,
  takeJobMaterial,
  takeProjectMaterial,
  returnJobMaterial,
  importInventoryRows,
} = await import('@/lib/inventory/actions');

const take = { locationId: foreignLocationId, quantity: 1 };
const upsert = [
  'upsertInventoryItem',
  () =>
    upsertInventoryItem({
      id: foreignItemId,
      name: 'Kupferrohr',
      itemType: 'material',
      unit: 'm',
      isBillable: true,
    }),
] as const;
const adjust = [
  'adjustInventoryStock',
  () => adjustInventoryStock({ itemId: foreignItemId, locationId: foreignLocationId, quantityDelta: 5 }),
] as const;
const officeOnly = [
  ['getInventoryOverview', () => getInventoryOverview()],
  ['getInventoryLocationOptions', () => getInventoryLocationOptions()],
  ['getInventoryPickerPage', () => getInventoryPickerPage('Rohr', foreignItemId)],
  [
    'createInventoryLocation',
    () => createInventoryLocation({ name: 'Lager 2', parentLocationId: foreignLocationId }),
  ],
  upsert,
  adjust,
  [
    'createJobMaterialLine',
    () => createJobMaterialLine({ jobId: foreignJobId, itemId: foreignItemId, plannedQuantity: 2 }),
  ],
  [
    'createProjectMaterialLine',
    () =>
      createProjectMaterialLine({ projectId: foreignProjectId, itemId: foreignItemId, plannedQuantity: 2 }),
  ],
  [
    'importInventoryRows',
    () =>
      importInventoryRows({ fileName: 'inventar.csv', columnMapping: {}, rows: [{ name: 'Kupferrohr' }] }),
  ],
] as const;

// Field workers are refused the catalog and its writes before the service-role client exists.
signInAs(world, 'employee');
await assertRefused(world, officeOnly, { success: false, error: 'not_authorized' }, 'none');

// A field worker books and reads material only on an own assigned job:
// another organization's job, project or line is not found, and an own
// unassigned job or a project is refused, before any write.
await assertRefused(
  world,
  [
    ['getInventoryPickerOptionsForJob', () => getInventoryPickerOptionsForJob(foreignJobId)],
    ['getJobMaterialLines', () => getJobMaterialLines(foreignJobId)],
    ['takeJobMaterial', () => takeJobMaterial({ ...take, jobId: foreignJobId, lineId: foreignLineId })],
  ],
  { success: false, error: 'job_not_found' },
  'reads',
);
await assertRefused(
  world,
  [
    ['getProjectMaterialSummary', () => getProjectMaterialSummary(foreignProjectId)],
    [
      'takeProjectMaterial',
      () => takeProjectMaterial({ ...take, projectId: foreignProjectId, lineId: foreignLineId }),
    ],
  ],
  { success: false, error: 'project_not_found' },
  'reads',
);
await assertRefused(
  world,
  [['returnJobMaterial', () => returnJobMaterial({ ...take, lineId: foreignLineId })]],
  { success: false, error: 'line_not_found' },
  'reads',
);
await assertRefused(
  world,
  [
    ['getJobMaterialLines', () => getJobMaterialLines(ownJobId)],
    ['getProjectMaterialSummary', () => getProjectMaterialSummary(ownProjectId)],
  ],
  { success: false, error: 'not_authorized' },
  'reads',
);

// Büro does not find another organization's job, project, item, line or parent location.
signInAs(world, 'buero');
await assertRefused(world, [officeOnly[3]], { success: false, error: 'location_not_found' }, 'reads');
await assertRefused(world, [officeOnly[6]], { success: false, error: 'job_not_found' }, 'reads');
await assertRefused(world, [officeOnly[7]], { success: false, error: 'project_not_found' }, 'reads');
await assertRefused(
  world,
  [
    [
      'createJobMaterialLine',
      () => createJobMaterialLine({ jobId: ownJobId, itemId: foreignItemId, plannedQuantity: 2 }),
    ],
  ],
  { success: false, error: 'item_not_found' },
  'reads',
);
await assertRefused(
  world,
  [
    ['takeJobMaterial', () => takeJobMaterial({ ...take, jobId: ownJobId, lineId: foreignLineId })],
    [
      'takeProjectMaterial',
      () => takeProjectMaterial({ ...take, projectId: ownProjectId, lineId: foreignLineId }),
    ],
    ['returnJobMaterial', () => returnJobMaterial({ ...take, lineId: foreignLineId })],
  ],
  { success: false, error: 'line_not_found' },
  'reads',
);

// The stock write functions refuse another organization's item because the
// action passes the caller's organization; one call each.
refuseForeignIds(world, new Map([[foreignItemId, 'item_not_found']]));
await assertRefused(world, [upsert], { success: false, error: 'item_not_found' }, 'one-call');
assert.equal(world.rpcCalls[0]?.args.p_organization_id, ORGANIZATION_A);
await assertRefused(world, [adjust], { success: false, error: 'movement_failed' }, 'one-call');
assert.equal(world.rpcCalls[0]?.args.p_organization_id, ORGANIZATION_A);
