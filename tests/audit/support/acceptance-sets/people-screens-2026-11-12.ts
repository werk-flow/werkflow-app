import { worldName } from '../../../../lib/testing/seed-world-plan';
import { seedOrganizationCertification } from '../../../golden/support/db/qualifications';
import { createAdminClient } from '../../../golden/support/db/shared';
import type { TestWorld } from '../../../golden/support/world';
import { surfaceFixture } from '../surface-fixtures';
import type { SurfaceDestination } from '../surface-routes';
import { acceptanceSet, type OpenSet } from '../acceptance-sets';

/** A certification of the employee whose validity has a one-digit day and month: 19.9.2025 to 5.9.2040. */
async function seedEmployeeCertification(world: TestWorld): Promise<void> {
  await surfaceFixture(world, 'acceptance.people-screens-certification', async () => {
    const admin = createAdminClient();
    const { data: record } = await admin
      .from('employee_records')
      .select('id')
      .eq('organization_id', world.orgId)
      .eq('user_id', world.users.employee.id)
      .single()
      .throwOnError();
    const capabilityId = await seedOrganizationCertification(
      world.orgId,
      world.users.admin.id,
      worldName('Kältetechnik Kategorie I', world.runId),
    );
    await admin
      .from('employee_capabilities')
      .insert({
        organization_id: world.orgId,
        employee_record_id: record.id,
        capability_id: capabilityId,
        capability_kind: 'certification',
        valid_from: '2025-09-19',
        valid_until: '2040-09-05',
        created_by: world.users.admin.id,
      })
      .throwOnError();
    return capabilityId;
  });
}

async function employeeDetail(world: TestWorld): Promise<SurfaceDestination> {
  await seedEmployeeCertification(world);
  return {
    route: `/mitarbeiter/${world.users.employee.id}`,
    heading: `${world.users.employee.firstName} ${world.users.employee.lastName}`,
  };
}

async function ownQualifications(world: TestWorld): Promise<SurfaceDestination> {
  await seedEmployeeCertification(world);
  return { route: '/qualifikationen', heading: 'Qualifikationen' };
}

/**
 * werk-flow/werkflow-planning#164 of 2026-11-12: Büro reads „Status nicht
 * sichtbar“ for Admin and peers, raising a Handwerker/in to Büro asks first,
 * validity dates are padded, and the invite button and dialog agree.
 */
function peopleScreenCaptures(): OpenSet {
  const both = { widths: [1280, 375], schemes: ['light', 'dark'] } as const;
  const light = { widths: [1280, 375], schemes: ['light'] } as const;
  return {
    id: 'people-screens-2026-11-12',
    captures: [
      { id: 'buero-mitarbeiter', role: 'buero', route: '/mitarbeiter', view: { kind: 'page' }, ...both },
      {
        id: 'admin-mitarbeiter-dialog-member-role-escalation',
        role: 'admin',
        route: '/mitarbeiter',
        view: { kind: 'dialog', opener: 'people.member-role-escalation' },
        ...light,
      },
      {
        id: 'admin-mitarbeiter-dialog-invite',
        role: 'admin',
        route: '/mitarbeiter',
        view: { kind: 'dialog', opener: 'people.invite' },
        ...light,
      },
      {
        id: 'admin-mitarbeiter-userId',
        role: 'admin',
        route: '/mitarbeiter/[userId]',
        view: { kind: 'page' },
        destination: employeeDetail,
        reveal: 'Teams & Qualifikationen',
        ...both,
      },
      {
        id: 'employee-qualifikationen',
        role: 'employee',
        route: '/qualifikationen',
        view: { kind: 'page' },
        destination: ownQualifications,
        ...both,
      },
    ],
    standalone: [],
  };
}

acceptanceSet(peopleScreenCaptures());
