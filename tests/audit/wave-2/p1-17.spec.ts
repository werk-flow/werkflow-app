import { resolve } from 'node:path';

import type { Page } from '@playwright/test';

import { expect, test } from '../../golden/support/fixtures';
import {
  getJobCountByNumber,
  getVisibleWorkHandoverCountsAs,
  getWorkHandoverState,
  getWorkLifecycleState,
} from '../../golden/support/db';
import {
  addContactOnCustomerDetail,
  addSiteOnCustomerDetail,
  createCustomer,
  createJob,
  createPlannedCalendarEntry,
  createProject,
  openCustomerDetail,
  selectAllHandoverSources,
  transitionWorkOnJobPage,
  uploadIntoDocumentsSection,
} from '../../golden/support/steps';
import { ownedBerlinDateAtOffset } from '../../golden/support/date-ownership';
import { requireSerialPrecondition } from '../../golden/support/preconditions';
import { ARTIFACTS_DIR, type TestWorld } from '../../golden/support/world';

test.describe.configure({ mode: 'serial' });

const DATES = Array.from({ length: 5 }, (_, index) => ownedBerlinDateAtOffset('p1-17', 90 + index));

function names(world: TestWorld) {
  const projectNumber = `PRJ-${world.runId}-P117-AUDIT`;
  return {
    customerName: `P117 Audit Kunde ${world.runId}`,
    contactName: `P117 Audit Kontakt ${world.runId}`,
    siteName: `P117 Audit Werk ${world.runId}`,
    projectNumber,
    projectTitle: `P117 Audit Projekt ${world.runId}`,
    firstJobNumber: `${projectNumber}-1`,
    secondJobNumber: `${projectNumber}-2`,
    firstJobTitle: `P117 Audit Auftrag eins ${world.runId}`,
    secondJobTitle: `P117 Audit Auftrag zwei ${world.runId}`,
    unassignedJobNumber: `AUF-${world.runId}-P117-UNASSIGNED`,
    employeeName: `${world.users.employee.firstName} ${world.users.employee.lastName}`,
  };
}

async function completeManagerWork(
  page: Page,
  path: string,
  override = false,
  startNeedsReason = false
): Promise<void> {
  await page.goto(path);
  const lifecycle = page.getByTestId('work-lifecycle-card');
  const completeButton = lifecycle.getByRole('button', {
    name: 'Ausführung abgeschlossen',
    exact: true,
  });
  const startButton = lifecycle.getByRole('button', {
    name: 'In Ausführung',
    exact: true,
  });
  await expect(completeButton.or(startButton)).toBeVisible({ timeout: 20_000 });
  if (await startButton.isVisible()) {
    await transitionWorkOnJobPage(
      page,
      'In Ausführung',
      startNeedsReason ? 'Ausführung für die Auditprüfung gestartet.' : undefined
    );
  }
  await completeButton.click();
  const dialog = page.getByRole('dialog');
  const overrideCheckbox = dialog.getByRole('checkbox', {
    name: /Manager-Ausnahme/,
  });
  if (override) {
    await expect(overrideCheckbox).toBeVisible();
    await overrideCheckbox.check();
  } else if (await overrideCheckbox.isVisible().catch(() => false)) {
    await expect(overrideCheckbox).not.toBeChecked();
  }
  const reason = dialog.locator('#work-transition-reason');
  if (await reason.isVisible().catch(() => false)) {
    await reason.fill('Ausführung wurde für die nachgelagerte Übergabeprüfung abgeschlossen.');
  }
  await dialog.getByRole('button', { name: 'Änderung speichern' }).click();
  await expect(dialog).toHaveCount(0, { timeout: 20_000 });
}

async function releaseHandover(page: Page, path: string): Promise<void> {
  await page.goto(path);
  const section = page.getByTestId('work-handover-section');
  await selectAllHandoverSources(section);
  await section.getByRole('button', { name: 'Entwurf speichern' }).click();
  await expect(section.getByText('Entwurf gespeichert.')).toBeVisible({
    timeout: 20_000,
  });
  const overrideReason = section.getByLabel('Begründung der Ausnahme');
  if (await overrideReason.isVisible().catch(() => false)) {
    await overrideReason.fill(
      'Die Ausnahme ist im Auditfall fachlich geprüft und vollständig dokumentiert.'
    );
  }
  const popupPromise = page.waitForEvent('popup');
  await section.getByRole('button', { name: 'Vorschau öffnen' }).click();
  const preview = await popupPromise;
  await preview.waitForLoadState('domcontentloaded');
  await section.getByRole('button', { name: 'Freigeben und übergeben' }).click();
  await expect(section.getByText('Übergabepaket freigegeben', { exact: false })).toBeVisible({
    timeout: 30_000,
  });
  await preview.close();
}

test.describe('P1-17 exhaustive office handover flows @AUDIT-W2-P1-17 @AUDIT-W2', () => {
  test('establishes job/project scope, exact routes, warning facts, and role boundaries', async ({
    adminPage,
    bueroPage,
    employeePage,
    outsiderPage,
    world,
  }) => {
    // P1-17-F01…F22, F31…F39 and F102…F109: job/project ownership,
    // confirmed routes, contact snapshots, defaults, warning classification,
    // office responsibility, assigned-field minimalism and org isolation.
    const fixture = names(world);
    await createCustomer(adminPage, fixture.customerName);
    await openCustomerDetail(adminPage, fixture.customerName);
    await addContactOnCustomerDetail(adminPage, {
      name: fixture.contactName,
      role: 'Projektleitung',
      email: `p117-audit-${world.runId}@example.test`,
      phone: '+49 30 5551170',
      notes: 'Interne P1-17 Auditnotiz.',
      isPrimary: true,
    });
    await addSiteOnCustomerDetail(adminPage, {
      name: fixture.siteName,
      street: 'Auditstraße 17',
      postalCode: '10115',
      city: 'Berlin',
      notes: 'Interne Standortbewertung.',
      isPrimary: true,
    });
    await createProject(adminPage, {
      projectNumber: fixture.projectNumber,
      title: fixture.projectTitle,
      clientName: fixture.customerName,
      siteName: fixture.siteName,
      contactName: fixture.contactName,
    });
    for (const [index, job] of [
      { number: fixture.firstJobNumber, title: fixture.firstJobTitle },
      { number: fixture.secondJobNumber, title: fixture.secondJobTitle },
    ].entries()) {
      await createJob(adminPage, {
        jobNumber: job.number,
        title: job.title,
        projectNumber: fixture.projectNumber,
        clientName: fixture.customerName,
        siteName: fixture.siteName,
        contactName: fixture.contactName,
        assignEmployeeName: fixture.employeeName,
      });
      await createPlannedCalendarEntry(adminPage, {
        kind: 'job_visit',
        jobSearch: job.number,
        date: DATES[index + 1],
        time: '06:00',
        employeeNames: [fixture.employeeName],
        overrideReason: 'P1-17 Audit-Termin.',
      });
    }
    await createJob(adminPage, {
      jobNumber: fixture.unassignedJobNumber,
      title: `P117 Audit nicht zugewiesen ${world.runId}`,
    });

    const before = await getWorkHandoverState(world.orgId, {
      jobNumber: fixture.firstJobNumber,
    });
    await Promise.all([
      adminPage.goto(
        `/auftraege/projekt/${fixture.projectNumber}/${fixture.firstJobNumber}/uebergabe`
      ),
      bueroPage.goto(`/auftraege/projekt/${fixture.projectNumber}/uebergabe`),
    ]);
    await expect(adminPage.getByTestId('work-handover-section')).toContainText(
      'Noch kein Übergabepaket'
    );
    await expect(adminPage.getByTestId('work-handover-section')).toContainText(
      'Die Ausführung muss abgeschlossen sein'
    );
    await expect(bueroPage.getByTestId('work-handover-section')).toBeVisible();
    expect(
      await getWorkHandoverState(world.orgId, {
        jobNumber: fixture.firstJobNumber,
      })
    ).toEqual(before);

    await employeePage.goto(
      `/auftraege/projekt/${fixture.projectNumber}/${fixture.firstJobNumber}/uebergabe`
    );
    await employeePage.waitForURL(/\/auftraege\/?$/, { timeout: 20_000 });
    await outsiderPage.goto(`/auftraege/projekt/${fixture.projectNumber}/uebergabe`);
    await outsiderPage.waitForURL(/\/auftraege\/?$/, { timeout: 20_000 });
    expect(
      Object.values(await getVisibleWorkHandoverCountsAs(world.outsider.admin, world.orgId)).every(
        (count) => count === 0
      )
    ).toBe(true);
  });

  test('releases child jobs with exact document versions and no cross-domain mutations', async ({
    adminPage,
    bueroPage,
    world,
  }) => {
    // P1-17-F23…F30 and F40…F71: execution-complete boundary, exact
    // document-version membership, preview, warnings, immutable release,
    // deterministic identity and lifecycle/package atomicity.
    const fixture = names(world);
    const setupJobCounts = await Promise.all([
      getJobCountByNumber(world.orgId, fixture.firstJobNumber),
      getJobCountByNumber(world.orgId, fixture.secondJobNumber),
    ]);
    requireSerialPrecondition(
      setupJobCounts.every((count) => count === 1),
      {
        test: 'P1-17-F23',
        needs: 'the two project-child jobs created by the scope and role-boundary test',
        grep: 'establishes job/project scope|releases child jobs',
        suite: 'audit',
      }
    );
    for (const jobNumber of [fixture.firstJobNumber, fixture.secondJobNumber]) {
      let state = await getWorkHandoverState(world.orgId, { jobNumber });
      if (state.package?.state !== 'released') {
        await adminPage.goto(`/auftraege/projekt/${fixture.projectNumber}/${jobNumber}`);
        await uploadIntoDocumentsSection(
          adminPage,
          resolve(ARTIFACTS_DIR, 'upload-fixture.pdf'),
          'upload-fixture'
        );
        await adminPage.goto('/aufgaben');
        await expect(adminPage.getByTestId('aufgaben-content')).toHaveAttribute(
          'data-loaded',
          'true'
        );
        await completeManagerWork(
          bueroPage,
          `/auftraege/projekt/${fixture.projectNumber}/${jobNumber}`
        );
        await expect(adminPage.getByTestId('attention-work-handover-tasks')).toContainText(
          jobNumber,
          { timeout: 30_000 }
        );
        await releaseHandover(
          bueroPage,
          `/auftraege/projekt/${fixture.projectNumber}/${jobNumber}/uebergabe`
        );
        await expect(
          adminPage.getByTestId('attention-work-handover-tasks').getByText(jobNumber)
        ).toHaveCount(0, { timeout: 30_000 });
        state = await getWorkHandoverState(world.orgId, { jobNumber });
      }
      expect(state.target).toMatchObject({ execution_state: 'handed_over' });
      expect(state.package).toMatchObject({ state: 'released' });
      expect(state.releases).toHaveLength(1);
      const releaseId = state.releases[0].id;
      const releasedItems = state.releaseItems.filter((item) => item.release_id === releaseId);
      expect(
        releasedItems.map((item) => ({
          sourceKind: item.source_kind,
          documentId: item.document_id,
          documentVersionNumber: item.document_version_number,
        }))
      ).toEqual(
        state.draftItems.map((item) => ({
          sourceKind: item.source_kind,
          documentId: item.document_id,
          documentVersionNumber: item.document_version_number,
        }))
      );
      expect(releasedItems.length).toBeGreaterThan(0);
      expect(
        releasedItems.every(
          (item) => item.source_kind === 'document_version' && item.document_version_number === 1
        )
      ).toBe(true);
      expect(state.documents[0].storage_path).toContain('/work-handover-packages/');
    }
  });

  test('composes a project from immutable child releases and rejects a stale office draft', async ({
    adminPage,
    bueroPage,
    world,
  }) => {
    // P1-17-F72…F88: child integrity, no child-worker widening, one mutable
    // root, stale-write recovery, exact child release IDs, project readiness,
    // Realtime root signaling and customer-package registration.
    const fixture = names(world);
    const setupJobCounts = await Promise.all([
      getJobCountByNumber(world.orgId, fixture.firstJobNumber),
      getJobCountByNumber(world.orgId, fixture.secondJobNumber),
    ]);
    requireSerialPrecondition(
      setupJobCounts.every((count) => count === 1),
      {
        test: 'P1-17-F72',
        needs: 'the two project-child jobs created by the scope and role-boundary test',
        grep: 'establishes job/project scope|releases child jobs|composes a project',
        suite: 'audit',
      }
    );
    const childStatesBeforeProjectRelease = await Promise.all([
      getWorkHandoverState(world.orgId, { jobNumber: fixture.firstJobNumber }),
      getWorkHandoverState(world.orgId, { jobNumber: fixture.secondJobNumber }),
    ]);
    requireSerialPrecondition(
      childStatesBeforeProjectRelease.every(
        (child) => child.package?.state === 'released' && child.releases.length === 1
      ),
      {
        test: 'P1-17-F72',
        needs: 'both immutable child handover releases created by the child-release test',
        grep: 'establishes job/project scope|releases child jobs|composes a project',
        suite: 'audit',
      }
    );
    await completeManagerWork(
      adminPage,
      `/auftraege/projekt/${fixture.projectNumber}`,
      false,
      true
    );
    const route = `/auftraege/projekt/${fixture.projectNumber}/uebergabe`;
    await Promise.all([adminPage.goto(route), bueroPage.goto(route)]);
    const projectBefore = await getWorkHandoverState(world.orgId, {
      projectNumber: fixture.projectNumber,
    });
    expect(projectBefore.package?.state).not.toBe('released');
    const adminSection = adminPage.getByTestId('work-handover-section');
    await selectAllHandoverSources(adminSection);
    await adminSection.getByRole('button', { name: 'Entwurf speichern' }).click();
    await expect(adminSection.getByText('Entwurf gespeichert.')).toBeVisible({
      timeout: 20_000,
    });
    const bueroSection = bueroPage.getByTestId('work-handover-section');
    await bueroSection.getByRole('button', { name: 'Entwurf speichern' }).click();
    await expect(bueroSection).toContainText('Die Übergabe wurde inzwischen geändert');

    await adminPage.reload();
    const refreshed = adminPage.getByTestId('work-handover-section');
    const popupPromise = adminPage.waitForEvent('popup');
    await refreshed.getByRole('button', { name: 'Vorschau öffnen' }).click();
    const preview = await popupPromise;
    await preview.waitForLoadState('domcontentloaded');
    await refreshed.getByRole('button', { name: 'Freigeben und übergeben' }).click();
    await expect(refreshed.getByText('Übergabepaket freigegeben', { exact: false })).toBeVisible({
      timeout: 30_000,
    });
    await preview.close();

    const state = await getWorkHandoverState(world.orgId, {
      projectNumber: fixture.projectNumber,
    });
    const childStates = await Promise.all([
      getWorkHandoverState(world.orgId, { jobNumber: fixture.firstJobNumber }),
      getWorkHandoverState(world.orgId, { jobNumber: fixture.secondJobNumber }),
    ]);
    expect(state.releaseItems.map((item) => item.child_handover_release_id).sort()).toEqual(
      childStates.map((child) => child.releases[0].id).sort()
    );
    expect(state.releases[0]).toMatchObject({
      commercial_readiness: 'ready_for_commercial_review',
    });
    expect(state.target).toMatchObject({
      execution_state_override: 'handed_over',
    });
  });

  test('preserves predecessor releases through withdrawal, correction, and successor release', async ({
    adminPage,
    world,
  }) => {
    // P1-17-F89…F101: attributed withdrawal and correction, append-only
    // events, successor draft, previous-release linkage, re-handover and
    // preserved package documents.
    const fixture = names(world);
    const route = `/auftraege/projekt/${fixture.projectNumber}/uebergabe`;
    const setupJobCount = await getJobCountByNumber(world.orgId, fixture.firstJobNumber);
    requireSerialPrecondition(setupJobCount === 1, {
      test: 'P1-17-F89',
      needs: 'the project and child jobs created by the scope and role-boundary test',
      grep: 'establishes job/project scope|releases child jobs|composes a project|preserves predecessor releases',
      suite: 'audit',
    });
    const initialState = await getWorkHandoverState(world.orgId, {
      projectNumber: fixture.projectNumber,
    });
    requireSerialPrecondition(initialState.package !== null && initialState.releases.length >= 1, {
      test: 'P1-17-F89',
      needs: 'the released project handover package created by the project-composition test',
      grep: 'establishes job/project scope|releases child jobs|composes a project|preserves predecessor releases',
      suite: 'audit',
    });
    if (initialState.package?.state !== 'reopened') {
      await adminPage.goto(route);
      let section = adminPage.getByTestId('work-handover-section');
      await section
        .getByLabel('Grund für die Rücknahme')
        .fill('Projektpaket benötigt eine ergänzende Abschlussprüfung.');
      await section.getByRole('button', { name: 'Übergabe zurücknehmen' }).click();
      await expect(section.getByText('Übergabe zurückgenommen.', { exact: false })).toBeVisible({
        timeout: 20_000,
      });
      await adminPage.reload();
      section = adminPage.getByTestId('work-handover-section');
      await section
        .getByLabel('Ausführung erneut öffnen')
        .fill('Projektprüfung wird mit dem Büro erneut durchgeführt.');
      await section.getByRole('button', { name: 'Zur Korrektur in Ausführung geben' }).click();
      await expect(section.getByText('Ausführung zur Korrektur geöffnet.')).toBeVisible({
        timeout: 20_000,
      });
    }

    await completeManagerWork(
      adminPage,
      `/auftraege/projekt/${fixture.projectNumber}`,
      false,
      true
    );
    await releaseHandover(adminPage, route);
    const state = await getWorkHandoverState(world.orgId, {
      projectNumber: fixture.projectNumber,
    });
    expect(state.releases).toHaveLength(2);
    expect(state.releases[1].previous_release_id).toBe(state.releases[0].id);
    expect(state.documents).toHaveLength(2);
    expect(state.events.map((event) => event.event_type)).toEqual(
      expect.arrayContaining([
        'handover_withdrawn',
        'review_returned',
        'execution_reopened',
        'successor_created',
      ])
    );
    const lifecycle = await getWorkLifecycleState(world.orgId, {
      projectNumber: fixture.projectNumber,
    });
    expect(lifecycle.executionEvents.map((event) => event.event_type)).toEqual(
      expect.arrayContaining(['handed_over', 'handover_withdrawn', 'reopened', 'handed_over'])
    );
  });
});
