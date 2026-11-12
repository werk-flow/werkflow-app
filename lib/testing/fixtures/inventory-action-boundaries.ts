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
const ownItemId = '90000000-0000-4000-8000-000000000008';
const ownJobLineId = '90000000-0000-4000-8000-000000000009';
const ownProjectLineId = '90000000-0000-4000-8000-00000000000a';
const ownUsedLineId = '90000000-0000-4000-8000-00000000000b';

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
  inventory_items: [
    { id: foreignItemId, organization_id: ORGANIZATION_B },
    { id: ownItemId, organization_id: ORGANIZATION_A },
  ],
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
    // Own lines with taken material: one on an unassigned job, one on the project itself.
    {
      id: ownJobLineId,
      organization_id: ORGANIZATION_A,
      job_id: ownJobId,
      project_id: null,
      item_id: ownItemId,
      taken_quantity: 2,
      used_quantity: 0,
      returned_quantity: 0,
      status: 'taken',
    },
    {
      id: ownUsedLineId,
      organization_id: ORGANIZATION_A,
      job_id: ownJobId,
      project_id: null,
      item_id: ownItemId,
      taken_quantity: 2,
      used_quantity: 1,
      returned_quantity: 0,
      status: 'taken',
    },
    {
      id: ownProjectLineId,
      organization_id: ORGANIZATION_A,
      job_id: null,
      project_id: ownProjectId,
      item_id: ownItemId,
      taken_quantity: 2,
      used_quantity: 0,
      returned_quantity: 0,
      status: 'taken',
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
  deleteJobMaterialLine,
  getJobMaterialLines,
  getProjectMaterialSummary,
  takeJobMaterial,
  takeProjectMaterial,
  returnJobMaterial,
  importInventoryRows,
} = await import('@/lib/inventory/actions');
const { recordJobMaterialUse } = await import('@/lib/inventory/material-use-actions');
const { readJobMaterialConsumption } = await import('@/lib/inventory/material-line-reads');
const use = { quantity: 1, note: null };

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
  [
    ['returnJobMaterial', () => returnJobMaterial({ ...take, lineId: foreignLineId })],
    ['recordJobMaterialUse', () => recordJobMaterialUse({ ...use, lineId: foreignLineId })],
  ],
  { success: false, error: 'line_not_found' },
  'reads',
);
// Use on an own line: the job needs the worker's assignment, a project's own line stays with the office.
await assertRefused(
  world,
  [
    ['recordJobMaterialUse', () => recordJobMaterialUse({ ...use, lineId: ownJobLineId })],
    ['recordJobMaterialUse', () => recordJobMaterialUse({ ...use, lineId: ownProjectLineId })],
  ],
  { success: false, error: 'not_authorized' },
  'reads',
);
// The consumption facts carry purchase costs: a field worker is refused before any database access.
await assertRefused(
  world,
  [
    ['readJobMaterialConsumption', () => readJobMaterialConsumption({ jobId: ownJobId })],
    ['readJobMaterialConsumption', () => readJobMaterialConsumption({ projectId: ownProjectId })],
  ],
  { success: false, error: 'not_authorized' },
  'none',
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
    ['recordJobMaterialUse', () => recordJobMaterialUse({ ...use, lineId: foreignLineId })],
  ],
  { success: false, error: 'line_not_found' },
  'reads',
);
await assertRefused(
  world,
  [['readJobMaterialConsumption', () => readJobMaterialConsumption({ jobId: foreignJobId })]],
  { success: false, error: 'job_not_found' },
  'reads',
);
await assertRefused(
  world,
  [['readJobMaterialConsumption', () => readJobMaterialConsumption({ projectId: foreignProjectId })]],
  { success: false, error: 'project_not_found' },
  'reads',
);

// A line with recorded use stays on its job: removing it is refused before any write.
await assertRefused(
  world,
  [['deleteJobMaterialLine', () => deleteJobMaterialLine(ownUsedLineId)]],
  { success: false, error: 'material_use_recorded' },
  'reads',
);

// The stock write functions refuse another organization's item because the
// action passes the caller's organization; one call each.
refuseForeignIds(world, new Map([[foreignItemId, 'item_not_found']]));
await assertRefused(world, [upsert], { success: false, error: 'item_not_found' }, 'one-call');
assert.equal(world.rpcCalls[0]?.args.p_organization_id, ORGANIZATION_A);
await assertRefused(world, [adjust], { success: false, error: 'movement_failed' }, 'one-call');
assert.equal(world.rpcCalls[0]?.args.p_organization_id, ORGANIZATION_A);
