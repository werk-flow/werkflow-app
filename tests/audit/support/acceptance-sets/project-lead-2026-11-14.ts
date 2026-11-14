import type { TestWorld } from '../../../golden/support/world';
import { createAdminClient } from '../../../golden/support/db/shared';
import { seedJob, seedProject } from '../../../golden/support/db/work';
import type { SurfaceDestination } from '../surface-routes';
import { surfaceFixture } from '../surface-fixtures';
import { acceptanceSet, type OpenSet } from '../acceptance-sets';

/** Names the world's employee the lead of a seeded project, as the office's naming leaves it. */
async function seedLedProject(world: TestWorld, key: 'jobs' | 'empty'): Promise<string> {
  return surfaceFixture(world, `project-lead.${key}`, async () => {
    const admin = createAdminClient();
    const projectNumber = `PL-${key}-${world.runId}`;
    const projectId = await seedProject({
      orgId: world.orgId,
      actorId: world.users.admin.id,
      projectNumber,
      name: key === 'jobs' ? 'Neubau Lindenstraße 12' : 'Sanierung Ahornweg 3',
    });
    if (key === 'jobs') {
      const heating = await seedJob({
        orgId: world.orgId,
        actorId: world.users.admin.id,
        jobNumber: `PL-AUF-1-${world.runId}`,
        title: 'Heizkörper im Erdgeschoss tauschen',
        projectId,
        plannedDate: '2026-11-20',
      });
      await seedJob({
        orgId: world.orgId,
        actorId: world.users.admin.id,
        jobNumber: `PL-AUF-2-${world.runId}`,
        title: 'Bad im Obergeschoss: Vorwandinstallation',
        projectId,
      });
      await admin
        .from('job_instruction_items')
        .insert([
          {
            organization_id: world.orgId,
            job_id: heating,
            content: 'Alte Heizkörper entleeren und entsorgen',
            requirement_state: 'required',
            sort_order: 1,
            created_by: world.users.admin.id,
          },
          {
            organization_id: world.orgId,
            job_id: heating,
            content: 'Thermostatköpfe der Kundin übergeben',
            requirement_state: 'optional',
            sort_order: 2,
            created_by: world.users.admin.id,
          },
        ])
        .throwOnError();
    }
    const { data: record } = await admin
      .from('employee_records')
      .select('id')
      .eq('organization_id', world.orgId)
      .eq('user_id', world.users.employee.id)
      .single()
      .throwOnError();
    await admin
      .from('work_leads')
      .insert({
        organization_id: world.orgId,
        project_id: projectId,
        employee_record_id: record.id,
        started_by: world.users.admin.id,
      })
      .throwOnError();
    return projectNumber;
  });
}

async function ledProject(world: TestWorld): Promise<SurfaceDestination> {
  return { route: `/auftraege/projekt/${encodeURIComponent(await seedLedProject(world, 'jobs'))}` };
}

async function ledProjectWithoutJobs(world: TestWorld): Promise<SurfaceDestination> {
  return { route: `/auftraege/projekt/${encodeURIComponent(await seedLedProject(world, 'empty'))}` };
}

/**
 * werk-flow/werkflow-planning#381 part 2 of 2026-11-14: the „Projektleitung“
 * on a project and a standalone job for Admin and Büro, without and with a
 * lead, its dialog, and the lead's view of the project as an employee on none
 * of its jobs, with jobs and without. The section's failure is rendered on the
 * server (`RegionLoadError`), which no capture can produce.
 */
function projectLeadCaptures(): OpenSet {
  const all = { widths: [1280, 375], schemes: ['light', 'dark'] } as const;
  return {
    id: 'project-lead-2026-11-14',
    captures: [
      {
        id: 'admin-projekt-ohne-leitung',
        role: 'admin',
        route: '/auftraege/projekt/[projectNumber]',
        view: { kind: 'page' },
        reveal: 'Projektleitung benennen',
        ...all,
      },
      {
        id: 'buero-projekt-leitung-benennen',
        role: 'buero',
        route: '/auftraege/projekt/[projectNumber]',
        view: { kind: 'dialog', opener: 'work.name-work-lead' },
        ...all,
      },
      {
        id: 'buero-projekt-mit-leitung',
        role: 'buero',
        route: '/auftraege/projekt/[projectNumber]',
        view: { kind: 'page' },
        destination: ledProject,
        reveal: 'Ändern oder beenden',
        ...all,
      },
      {
        id: 'admin-auftrag-ohne-leitung',
        role: 'admin',
        route: '/auftraege/[jobNumber]',
        view: { kind: 'page' },
        reveal: 'Projektleitung benennen',
        ...all,
      },
      {
        id: 'employee-projektleitung',
        role: 'employee',
        route: '/auftraege/projekt/[projectNumber]',
        view: { kind: 'page' },
        destination: ledProject,
        reveal: 'Deine Projektleitung',
        ...all,
      },
      {
        id: 'employee-projektleitung-leer',
        role: 'employee',
        route: '/auftraege/projekt/[projectNumber]',
        view: { kind: 'page' },
        destination: ledProjectWithoutJobs,
        reveal: 'Deine Projektleitung',
        ...all,
      },
    ],
    standalone: [],
  };
}

acceptanceSet(projectLeadCaptures());
