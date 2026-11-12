import { rpcArgs } from '../../../../lib/supabase/rpc-args';
import { worldName } from '../../../../lib/testing/seed-world-plan';
import { TEST_SUPPORT_USER } from '../../../../lib/testing/support-user';
import { seedProblemReport } from '../../../golden/support/db/problem-reports';
import { createAdminClient } from '../../../golden/support/db/shared';
import type { TestWorld } from '../../../golden/support/world';
import { surfaceFixture } from '../surface-fixtures';
import type { SurfaceDestination } from '../surface-routes';
import { acceptanceSet, type OpenSet } from '../acceptance-sets';

/**
 * Two of the employee's reports, each scrubbed and closed with an answer:
 * one a report thread answered through the hand-out and write-back, one
 * support answered. Both go through the product's own database functions,
 * so the history and the marks are the real ones.
 */
async function seedAnsweredReports(world: TestWorld): Promise<string> {
  return surfaceFixture(world, 'acceptance.report-handout-answers', async () => {
    const admin = createAdminClient();
    const report = async (description: string, createdAt: string) => {
      const reportId = await seedProblemReport({
        orgId: world.orgId,
        reporterId: world.users.employee.id,
        description: worldName(description, world.runId),
        createdAt,
      });
      await admin
        .rpc('record_problem_report_scrub', {
          p_organization_id: world.orgId,
          p_report_id: reportId,
          p_scrubbed_description: description,
          p_scrubbed_context: {},
        })
        .throwOnError();
      return reportId;
    };
    const close = (reportId: string, actorId: string | null, response: string) =>
      admin
        .rpc(
          'triage_problem_report',
          // The Agent writes without an actor.
          rpcArgs('triage_problem_report', {
            p_organization_id: world.orgId,
            p_report_id: reportId,
            p_actor_id: actorId,
            p_changes: { status: 'erledigt', response },
            p_expected: { status: 'eingegangen', response: null },
            p_support_ids: [],
          }),
        )
        .throwOnError();

    const byAgent = await report(
      'Die Liste der Aufträge bleibt nach dem Filtern leer.',
      '2026-11-11T07:30:00.000Z',
    );
    await admin
      .rpc('hand_out_problem_report', {
        p_organization_id: world.orgId,
        p_report_id: byAgent,
        p_support_ids: [],
      })
      .throwOnError();
    await close(byAgent, null, 'Behoben: Der Filter merkt sich jetzt deine Auswahl. Ab morgen live.');
    const bySupport = await report(
      'Beim Foto-Upload dreht sich das Rad sehr lange.',
      '2026-11-10T09:10:00.000Z',
    );
    await close(
      bySupport,
      TEST_SUPPORT_USER.id,
      'Das lag an einer langsamen Verbindung, wir haben es nachgestellt.',
    );
    return byAgent;
  });
}

async function answeredReports(world: TestWorld): Promise<SurfaceDestination> {
  await seedAnsweredReports(world);
  return { route: '/meldungen', heading: 'Meine Meldungen' };
}

/**
 * werk-flow/werkflow-planning#336 of 2026-11-12: „Meine Meldungen“ with an
 * answer a report thread wrote, marked „Automatisch geschrieben“, beside one
 * support wrote, which looks as every answer did before.
 */
function reportHandoutCaptures(): OpenSet {
  const both = { widths: [1280, 375], schemes: ['light', 'dark'] } as const;
  return {
    id: 'report-handout-2026-11-12',
    captures: [
      {
        id: 'employee-meldungen-automatische-antwort',
        role: 'employee',
        route: '/meldungen',
        view: { kind: 'page' },
        destination: answeredReports,
        ...both,
      },
    ],
    standalone: [],
  };
}

acceptanceSet(reportHandoutCaptures());
