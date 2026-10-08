import { resolve } from 'node:path';

import type { Page } from '@playwright/test';

import { expect, test } from '../support/fixtures';
import { seedCustomer } from '../../golden/support/db/customers';
import {
  getWorkHandoverState,
  getWorkLifecycleState,
  seedJob,
  seedJobAssignment,
  seedProject,
} from '../../golden/support/db/work';
import { createPlannedCalendarEntry } from '../../golden/support/steps/calendar';
import { uploadIntoDocumentsSection } from '../../golden/support/steps/documents';
import {
  completeExecutionAsManager,
  handoverAction,
  handoverField,
  handoverMessage,
  handoverStateLabel,
  HANDOVER_TEXT,
  lifecycleAction,
  lifecycleIntoExecutionAction,
  moveWorkIntoExecution,
  selectAllHandoverSources,
  workHandoverSection,
} from '../../golden/support/steps/work';
import { ownedBerlinDateAtOffset } from '../../golden/support/date-ownership';
import { artifactsDirectory, type TestWorld } from '../../golden/support/world';
import { expectDefined } from '../../../lib/testing/spec-support/expect-defined';
import { freezeLiveUpdates } from '../../golden/support/live';

type SeededProjectScope = {
  projectNumber: string;
  jobNumbers: readonly string[];
};

/**
 * Seeds a customer project with assigned child jobs. The tests below claim
 * the handover flows, not the creation dialogs that P1-01 and P1-12 prove.
 */
async function seedProjectWithChildren(world: TestWorld, tag: string, childCount: number) {
  const customerName = `P117 ${tag} Kunde ${world.runId}`;
  const contactName = `P117 ${tag} Kontakt ${world.runId}`;
  const siteName = `P117 ${tag} Werk ${world.runId}`;
  const customer = await seedCustomer({
    orgId: world.orgId,
    actorId: world.users.admin.id,
    name: customerName,
    contacts: [{ name: contactName, role: 'Projektleitung', phone: '+49 30 5551170', isPrimary: true }],
    sites: [
      {
        name: siteName,
        street: 'Auditstraße 17',
        postalCode: '10115',
        city: 'Berlin',
        notes: 'Interne Standortbewertung.',
        isPrimary: true,
      },
    ],
  });
  const clientId = customer.clientId;
  const siteId = expectDefined(customer.siteIds.get(siteName), 'the seeded site');
  const contactId = expectDefined(customer.contactIds.get(contactName), 'the seeded contact');
  const projectNumber = `PRJ-${world.runId}-P117-${tag}`;
  const projectId = await seedProject({
    orgId: world.orgId,
    actorId: world.users.admin.id,
    projectNumber,
    name: `P117 ${tag} Projekt ${world.runId}`,
    clientId,
    siteId,
    contactId,
  });
  const jobNumbers: string[] = [];
  for (let index = 1; index <= childCount; index += 1) {
    const jobNumber = `${projectNumber}-${index}`;
    const jobId = await seedJob({
      orgId: world.orgId,
      actorId: world.users.admin.id,
      jobNumber,
      title: `P117 ${tag} Auftrag ${index} ${world.runId}`,
      clientId,
      siteId,
      contactId,
      projectId,
    });
    await seedJobAssignment({
      orgId: world.orgId,
      actorId: world.users.admin.id,
      jobId,
      userId: world.users.employee.id,
    });
    jobNumbers.push(jobNumber);
  }
  return { projectNumber, jobNumbers } satisfies SeededProjectScope;
}

async function completeManagerWork(page: Page, path: string, startNeedsReason = false): Promise<void> {
  await page.goto(path);
  const completeButton = lifecycleAction(page, 'in_progress', 'execution_complete');
  // The step into execution names where it comes from: a fresh start, a
  // resumption after an interruption, or reopening finished work.
  const startButton = lifecycleIntoExecutionAction(page);
  await expect(completeButton.or(startButton)).toBeVisible({ timeout: 20_000 });
  if (await startButton.isVisible()) {
    await moveWorkIntoExecution(
      page,
      startNeedsReason ? 'Ausführung für die Auditprüfung gestartet.' : undefined,
    );
  }
  await completeExecutionAsManager(page, {
    reason: 'Ausführung wurde für die nachgelagerte Übergabeprüfung abgeschlossen.',
    managerException: 'unused',
  });
}

async function releaseHandover(page: Page, path: string): Promise<void> {
  await page.goto(path);
  const section = workHandoverSection(page);
  await selectAllHandoverSources(section);
  await handoverAction(section, 'saveDraft').click();
  await expect(handoverMessage(section, 'draftSaved')).toBeVisible({
    timeout: 20_000,
  });
  const overrideReason = handoverField(section, 'exceptionReason');
  if (await overrideReason.isVisible().catch(() => false)) {
    await overrideReason.fill('Die Ausnahme ist im Auditfall fachlich geprüft und vollständig dokumentiert.');
  }
  const popupPromise = page.waitForEvent('popup');
  await handoverAction(section, 'openPreview').click();
  const preview = await popupPromise;
  await preview.waitForLoadState('domcontentloaded');
  await handoverAction(section, 'release').click();
  await expect(handoverMessage(section, 'released')).toBeVisible({
    timeout: 30_000,
  });
  await preview.close();
}

// The standalone job journey (execution, evidence, release, withdrawal and
// re-release) lives in tests/golden/p1-17.spec.ts; the organization boundary
// is in supabase/tests/work_execution_boundaries.sql.
test.describe('P1-17 exhaustive office handover flows @AUDIT-W2-P1-17 @AUDIT-W2', () => {
  test('establishes job/project scope, exact routes, warning facts, and role boundaries', async ({
    adminPage,
    bueroPage,
    employeePage,
    outsiderPage,
    world,
  }) => {
    // P1-17-F01…F22, F31…F39 and F102…F109: job/project ownership,
    // confirmed routes, side-effect-free empty state, office responsibility,
    // assigned-field minimalism and outsider route denial.
    const scope = await seedProjectWithChildren(world, 'SCOPE', 1);
    const childJobNumber = expectDefined(scope.jobNumbers[0], 'the child job number');
    const childRoute = `/auftraege/projekt/${scope.projectNumber}/${childJobNumber}/uebergabe`;
    const projectRoute = `/auftraege/projekt/${scope.projectNumber}/uebergabe`;

    const before = await getWorkHandoverState(world.orgId, { jobNumber: childJobNumber });
    await Promise.all([adminPage.goto(childRoute), bueroPage.goto(projectRoute)]);
    await expect(workHandoverSection(adminPage)).toContainText(handoverStateLabel('missing'));
    await expect(workHandoverSection(adminPage)).toContainText(HANDOVER_TEXT.executionMustBeComplete);
    await expect(workHandoverSection(bueroPage)).toBeVisible();
    expect(await getWorkHandoverState(world.orgId, { jobNumber: childJobNumber })).toEqual(before);

    await employeePage.goto(childRoute);
    await employeePage.waitForURL(/\/auftraege\/?$/, { timeout: 20_000 });
    await outsiderPage.goto(projectRoute);
    await outsiderPage.waitForURL(/\/auftraege\/?$/, { timeout: 20_000 });
  });

  test('composes a project package from immutable child releases and keeps it through a successor', async ({
    adminPage,
    bueroPage,
    world,
  }) => {
    const scope = await seedProjectWithChildren(world, 'PAKET', 2);
    const projectRoute = `/auftraege/projekt/${scope.projectNumber}/uebergabe`;
    const employeeName = `${world.users.employee.firstName} ${world.users.employee.lastName}`;
    const visitDates = [ownedBerlinDateAtOffset('p1-17', 91), ownedBerlinDateAtOffset('p1-17', 92)];
    for (const [index, jobNumber] of scope.jobNumbers.entries()) {
      await createPlannedCalendarEntry(adminPage, {
        kind: 'job_visit',
        jobSearch: jobNumber,
        date: expectDefined(visitDates[index], 'a child visit date'),
        time: '06:00',
        employeeNames: [employeeName],
        overrideReason: 'P1-17 Audit-Termin.',
      });
    }

    const childReleaseIds =
      await test.step('The office releases each child job with its exact document version', async () => {
        // P1-17-F23…F30 and F40…F71: execution-complete boundary, exact
        // document-version membership, preview, warnings, immutable release,
        // attention resolution and lifecycle/package atomicity.
        const releaseIds: string[] = [];
        for (const jobNumber of scope.jobNumbers) {
          const jobPath = `/auftraege/projekt/${scope.projectNumber}/${jobNumber}`;
          await adminPage.goto(jobPath);
          await uploadIntoDocumentsSection(
            adminPage,
            resolve(artifactsDirectory(), 'upload-fixture.pdf'),
            'upload-fixture',
          );
          await adminPage.goto('/aufgaben');
          await expect(adminPage.getByRole('main').getByTestId('aufgaben-content')).toHaveAttribute(
            'data-loaded',
            'true',
          );
          await completeManagerWork(bueroPage, jobPath);
          await expect(
            adminPage.getByRole('main').getByTestId('attention-work-handover-tasks'),
          ).toContainText(jobNumber, { timeout: 30_000 });
          await releaseHandover(bueroPage, `${jobPath}/uebergabe`);
          await expect(
            adminPage.getByTestId('attention-work-handover-tasks').getByText(jobNumber),
          ).toHaveCount(0, {
            timeout: 30_000,
          });
          const state = await getWorkHandoverState(world.orgId, { jobNumber });
          expect(state.target).toMatchObject({ execution_state: 'handed_over' });
          expect(state.package).toMatchObject({ state: 'released' });
          const release = expectDefined(state.releases[0], 'the child release');
          expect(state.releases).toHaveLength(1);
          const releasedItems = state.releaseItems.filter((item) => item.release_id === release.id);
          expect(releasedItems.length).toBeGreaterThan(0);
          expect(
            releasedItems.every(
              (item) => item.source_kind === 'document_version' && item.document_version_number === 1,
            ),
          ).toBe(true);
          expect(state.documents[0]?.storage_path).toContain('/work-handover-packages/');
          releaseIds.push(release.id);
        }
        return releaseIds;
      });

    await test.step('The project composes the child releases and rejects a stale office draft', async () => {
      // P1-17-F72…F88: child integrity, one mutable root, stale-write recovery,
      // exact child release IDs, project readiness and lifecycle registration.
      await completeManagerWork(adminPage, `/auftraege/projekt/${scope.projectNumber}`, true);
      // The office session keeps the state it opened with, as a tab that lost
      // its connection does. Live, it would receive the saved draft within a
      // fraction of a second and no longer hold a stale one.
      const releaseBuero = await freezeLiveUpdates(bueroPage);
      await Promise.all([adminPage.goto(projectRoute), bueroPage.goto(projectRoute)]);
      const adminSection = workHandoverSection(adminPage);
      const bueroSection = workHandoverSection(bueroPage);
      await expect(handoverAction(bueroSection, 'saveDraft')).toBeVisible();
      await selectAllHandoverSources(adminSection);
      await handoverAction(adminSection, 'saveDraft').click();
      await expect(handoverMessage(adminSection, 'draftSaved')).toBeVisible({
        timeout: 20_000,
      });
      await handoverAction(bueroSection, 'saveDraft').click();
      await expect(bueroSection).toContainText(HANDOVER_TEXT.staleDraft);
      await releaseBuero();

      await adminPage.reload();
      const refreshed = workHandoverSection(adminPage);
      const popupPromise = adminPage.waitForEvent('popup');
      await handoverAction(refreshed, 'openPreview').click();
      const preview = await popupPromise;
      await preview.waitForLoadState('domcontentloaded');
      await handoverAction(refreshed, 'release').click();
      await expect(handoverMessage(refreshed, 'released')).toBeVisible({
        timeout: 30_000,
      });
      await preview.close();

      const state = await getWorkHandoverState(world.orgId, { projectNumber: scope.projectNumber });
      expect(state.releaseItems.map((item) => item.child_handover_release_id).sort()).toEqual(
        [...childReleaseIds].sort(),
      );
      expect(state.releases[0]).toMatchObject({
        commercial_readiness: 'ready_for_commercial_review',
      });
      expect(state.target).toMatchObject({
        execution_state_override: 'handed_over',
      });
    });

    await test.step('Withdrawal and correction lead to a successor that keeps its predecessor', async () => {
      // P1-17-F89…F101: attributed withdrawal and correction, append-only
      // events, successor draft, previous-release linkage, re-handover and
      // preserved package documents.
      await adminPage.goto(projectRoute);
      let section = workHandoverSection(adminPage);
      await handoverField(section, 'withdrawReason').fill(
        'Projektpaket benötigt eine ergänzende Abschlussprüfung.',
      );
      await handoverAction(section, 'withdraw').click();
      await expect(handoverMessage(section, 'withdrawn')).toBeVisible({
        timeout: 20_000,
      });
      await adminPage.reload();
      section = workHandoverSection(adminPage);
      await handoverField(section, 'reopenReason').fill(
        'Projektprüfung wird mit dem Büro erneut durchgeführt.',
      );
      await handoverAction(section, 'reopenForCorrection').click();
      await expect(handoverMessage(section, 'reopened')).toBeVisible({
        timeout: 20_000,
      });

      await completeManagerWork(adminPage, `/auftraege/projekt/${scope.projectNumber}`, true);
      await releaseHandover(adminPage, projectRoute);
      const state = await getWorkHandoverState(world.orgId, { projectNumber: scope.projectNumber });
      expect(state.releases).toHaveLength(2);
      expect(state.releases[1]?.previous_release_id).toBe(state.releases[0]?.id);
      expect(state.documents).toHaveLength(2);
      expect(state.events.map((event) => event.event_type)).toEqual(
        expect.arrayContaining([
          'handover_withdrawn',
          'review_returned',
          'execution_reopened',
          'successor_created',
        ]),
      );
      const lifecycle = await getWorkLifecycleState(world.orgId, { projectNumber: scope.projectNumber });
      expect(lifecycle.executionEvents.map((event) => event.event_type)).toEqual(
        expect.arrayContaining(['handed_over', 'handover_withdrawn', 'reopened']),
      );
    });
  });
});
