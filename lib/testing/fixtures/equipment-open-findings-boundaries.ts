// The office's open Mängel of one Anlage over the in-memory database
// (werk-flow/werkflow-planning#484). Admin and Büro read each open finding
// with its visit, plan, job, next step, owner and target date; an employee and
// another organization's Anlage read nothing, and an employee never reaches
// the database.
import assert from 'node:assert/strict';
import {
  ORGANIZATION_A,
  ORGANIZATION_B,
  installActionWorld,
  listProfileReferencesInWorld,
  signInAs,
} from './action-boundary-world';
import { assertRefused } from './operations-boundary-refusals';

const id = (n: number) => `48400000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const equipmentId = id(10);
const foreignEquipmentId = id(11);
const jobId = id(20);
const ownerId = id(30);

const world = installActionWorld({
  installed_equipment: [
    { id: equipmentId, organization_id: ORGANIZATION_A, equipment_number: 'ANL-2' },
    { id: foreignEquipmentId, organization_id: ORGANIZATION_B, equipment_number: 'ANL-9' },
  ],
  jobs: [{ id: jobId, organization_id: ORGANIZATION_A, job_number: 'AUF-7', title: 'Wartungsbesuch' }],
  organization_members: [{ organization_id: ORGANIZATION_A, user_id: ownerId, role: 'buero' }],
  profiles: [
    {
      id: ownerId,
      first_name: 'Petra',
      last_name: 'Beispiel',
      email: 'petra@example.test',
      avatar_path: null,
    },
  ],
});
const finding = {
  finding_id: id(40),
  maintenance_due_work_id: id(41),
  completed_on: '2026-10-01',
  scope_outcome: 'partial',
  maintenance_plan_id: id(42),
  plan_number: 'WPL-1',
  job_id: jobId,
  defects: ['Brenner zündet verzögert', 'Abgasrohr undicht'],
  next_action: 'return_visit',
  owner_user_id: ownerId,
  target_date: '2026-10-20',
  note: null,
  recorded_at: '2026-10-01T10:00:00.000Z',
};
world.rpc = ({ name, args }) => {
  if (name === 'list_profile_references') return listProfileReferencesInWorld(world, args);
  if (name !== 'list_open_maintenance_visit_findings') return { data: null, error: null };
  const own =
    args.p_organization_id === ORGANIZATION_A &&
    Array.isArray(args.p_equipment_ids) &&
    args.p_equipment_ids.includes(equipmentId);
  return { data: own ? [finding] : [], error: null };
};
const { getEquipmentOpenFindings } = await import('@/lib/installed-equipment/open-findings-reads');

for (const role of ['admin', 'buero'] as const) {
  signInAs(world, role);
  assert.deepEqual(await getEquipmentOpenFindings({ equipmentId }), {
    success: true,
    findings: [
      {
        id: id(40),
        visitDate: '2026-10-01',
        outcome: 'partial',
        planNumber: 'WPL-1',
        job: { label: 'Auftrag AUF-7', href: '/auftraege/AUF-7' },
        defects: ['Brenner zündet verzögert', 'Abgasrohr undicht'],
        nextAction: 'return_visit',
        ownerName: 'Petra Beispiel',
        targetDate: '2026-10-20',
        note: null,
      },
    ],
  });
}

signInAs(world, 'employee');
await assertRefused(
  world,
  [['employee reads open Mängel', () => getEquipmentOpenFindings({ equipmentId })]],
  { success: false, error: 'not_authorized' },
  'none',
);
signInAs(world, 'admin');
await assertRefused(
  world,
  [['open Mängel of a foreign Anlage', () => getEquipmentOpenFindings({ equipmentId: foreignEquipmentId })]],
  { success: false, error: 'not_authorized' },
  'reads',
);
signInAs(world, 'admin', ORGANIZATION_B);
await assertRefused(
  world,
  [["another organization reads the Anlage's open Mängel", () => getEquipmentOpenFindings({ equipmentId })]],
  { success: false, error: 'not_authorized' },
  'reads',
);
