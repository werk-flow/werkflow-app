import { randomUUID } from 'node:crypto';
import { worldName } from '../../../../lib/testing/seed-world-plan';
import { berlinDateAtOffset } from '../../../golden/support/date-ownership';
import { seedRequest } from '../../../golden/support/db/requests';
import { createAdminClient } from '../../../golden/support/db/shared';
import type { TestWorld } from '../../../golden/support/world';
import { stateCaptureId } from '../acceptance-state-plan';
import { surfaceFixture } from '../surface-fixtures';
import type { SurfaceDestination } from '../surface-routes';
import { acceptanceSet, type OpenSet } from '../acceptance-sets';

const OVERDUE_JOBS = [
  { title: 'Heizungstausch Lindenhof', daysAgo: 6 },
  { title: 'Badsanierung Musterfrau', daysAgo: 3 },
] as const;

/**
 * The office's start with work that needs it: two open jobs whose only visit
 * is over and an Anfrage nobody has taken yet.
 */
async function officeWithOpenWork(world: TestWorld): Promise<SurfaceDestination> {
  await surfaceFixture(world, 'acceptance.office-start-open-work', async () => {
    const admin = createAdminClient();
    for (const [index, job] of OVERDUE_JOBS.entries()) {
      const jobId = randomUUID();
      await admin
        .from('jobs')
        .insert({
          id: jobId,
          organization_id: world.orgId,
          created_by: world.users.admin.id,
          job_number: `UEF-${world.runId}-${index + 1}`,
          title: worldName(job.title, world.runId),
        })
        .throwOnError();
      const day = berlinDateAtOffset(-job.daysAgo);
      await admin
        .from('planning_occurrences')
        .insert({
          organization_id: world.orgId,
          job_id: jobId,
          entry_kind: 'job_visit',
          time_kind: 'timed',
          status: 'scheduled',
          start_at: `${day}T07:00:00.000Z`,
          end_at: `${day}T10:00:00.000Z`,
          created_by: world.users.admin.id,
        })
        .throwOnError();
    }
    return seedRequest({
      orgId: world.orgId,
      actorId: world.users.admin.id,
      summary: worldName('Therme zeigt Störung F28', world.runId),
      requestNumber: `ANF-${world.runId}-START`,
      callerName: 'Erika Musterfrau',
    });
  });
  return { route: '/dashboard', heading: 'Dashboard' };
}

/** The office's start before anything is open: the audit world seeds no office work of its own. */
function officeWithNothingOpen(): Promise<SurfaceDestination> {
  return Promise.resolve({ route: '/dashboard', heading: 'Dashboard' });
}

/**
 * werk-flow/werkflow-planning#488 of 2026-11-17: the start of Admin and Büro
 * shows what needs them now, read from Aufgaben, with the überfällige Wartung
 * below; it says when nothing is open, shows its skeleton while it loads, and
 * a failed read shows its retry.
 */
function officeStartCaptures(): OpenSet {
  return {
    id: 'office-start-2026-11-17',
    captures: [
      // Empty runs first: the other captures seed the world's open work.
      {
        id: 'admin-dashboard-leer',
        role: 'admin',
        route: '/dashboard',
        view: { kind: 'page' },
        destination: officeWithNothingOpen,
        widths: [1280, 375],
        schemes: ['light', 'dark'],
      },
      {
        id: 'admin-dashboard',
        role: 'admin',
        route: '/dashboard',
        view: { kind: 'page' },
        destination: officeWithOpenWork,
        widths: [1280],
        schemes: ['light'],
      },
      {
        id: 'buero-dashboard',
        role: 'buero',
        route: '/dashboard',
        view: { kind: 'page' },
        destination: officeWithOpenWork,
        widths: [375],
        schemes: ['dark'],
      },
      {
        id: stateCaptureId('admin-dashboard', 'error'),
        role: 'admin',
        route: '/dashboard',
        view: { kind: 'page' },
        state: 'error',
        widths: [1280, 375],
        schemes: ['light'],
      },
      {
        id: stateCaptureId('admin-dashboard', 'loading'),
        role: 'admin',
        route: '/dashboard',
        view: { kind: 'page' },
        destination: officeWithOpenWork,
        state: 'loading',
        widths: [1280, 375],
        schemes: ['light'],
      },
    ],
    standalone: [],
  };
}

acceptanceSet(officeStartCaptures());
