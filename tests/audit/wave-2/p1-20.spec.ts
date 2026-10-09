import { resolve } from 'node:path';
import type { Locator, Page, Route } from '@playwright/test';

import { MAINTENANCE_PLAN_ERROR_MESSAGES } from '../../../components/service/maintenance-plan-form-state';
import { expectDefined } from '../../../lib/testing/spec-support/expect-defined';
import { expect, test } from '../support/fixtures';
import { captureResponsiveSection } from '../support/visual-evidence';
import { seedCustomer } from '../../golden/support/db/customers';
import {
  getMaintenanceCoverageStateByReference,
  getMaintenancePlanNumbersByClient,
  getMaintenanceStateByPlanNumber,
  seedInstalledEquipment,
  seedMaintenanceCoverage,
  seedMaintenancePlan,
  seedServiceCase,
} from '../../golden/support/db/service';
import { seedPublishedWorkTemplate } from '../../golden/support/db/work';
import { ownedBerlinDateAtOffset } from '../../golden/support/date-ownership';
import { uploadIntoDocumentsSection } from '../../golden/support/steps/documents';
import {
  MAINTENANCE_PLAN_STALE_TEXT,
  chooseMaintenanceDueAction,
  fillMaintenancePlanForm,
  maintenanceCoverageAction,
  maintenanceCoverageDocumentsDialog,
  maintenanceCoverageDocumentsLoading,
  maintenanceCoverageRow,
  maintenanceDueActionDialog,
  maintenanceDueReason,
  maintenanceDueRow,
  maintenanceDueRowAction,
  maintenanceDueServiceCasePicker,
  maintenanceDueSubmit,
  maintenancePageHeading,
  maintenancePlanActionReason,
  maintenancePlanActionSubmit,
  maintenancePlanOverlapReason,
  maintenancePlanSubmit,
  maintenanceSearchUrl,
  maintenanceTab,
  openMaintenancePlanAction,
  openMaintenancePlanDialog,
} from '../../golden/support/steps/service';
import { SHARED_COPY, selectFromSearchable, testData, textInDom } from '../../golden/support/steps/shared';
import { artifactsDirectory, type TestWorld } from '../../golden/support/world';

/**
 * One customer site with one equipment and a published maintenance template,
 * named for the calling test. With `plan`, an active plan with its due horizon
 * (first due on the first owned P1-20 date); with `coverage`, an operational coverage.
 */
async function seedMaintenanceOwners(
  world: TestWorld,
  testId: string,
  businessDate: string,
  options: { plan?: boolean; coverage?: boolean } = {},
) {
  const names = {
    customer: `P120 Audit Kunde ${world.runId}-${testId}`,
    site: `P120 Audit Heizzentrale ${world.runId}-${testId}`,
    equipment: `P120 Audit Wärmeerzeuger ${world.runId}-${testId}`,
    template: `P120 Audit Wartung ${world.runId}-${testId}`,
    coverageReference: `P120-AUDIT-VERTRAG-${world.runId}-${testId}`,
  };
  const actor = { orgId: world.orgId, actorId: world.users.admin.id };
  const firstDue = ownedBerlinDateAtOffset('p1-20', 105);
  const customer = await seedCustomer({
    ...actor,
    name: names.customer,
    sites: [
      {
        name: names.site,
        street: 'Auditwartungsweg 20',
        postalCode: '10115',
        city: 'Berlin',
        isPrimary: true,
      },
    ],
  });
  const siteId = expectDefined(customer.siteIds.get(names.site), 'the seeded P1-20 audit site');
  const equipment = await seedInstalledEquipment({
    ...actor,
    clientId: customer.clientId,
    siteId,
    name: names.equipment,
    manufacturer: 'WerkFlow Testtechnik',
    model: 'Audit 20',
  });
  const template = await seedPublishedWorkTemplate({
    ...actor,
    name: names.template,
    targetType: 'job',
    items: [
      { content: 'Anlage fachgerecht warten' },
      {
        content: 'Messwerte nachvollziehbar dokumentieren',
        evidenceDescription: 'Versionierter Wartungsbericht',
      },
    ],
  });
  const coverage = options.coverage
    ? await seedMaintenanceCoverage({
        ...actor,
        clientId: customer.clientId,
        siteId,
        reference: names.coverageReference,
        validFrom: firstDue,
        validUntil: ownedBerlinDateAtOffset('p1-20', 109),
        operationalNote: 'Nur bestätigte operative Abdeckung; kein kaufmännischer Status.',
      })
    : null;
  const plan = options.plan
    ? await seedMaintenancePlan({
        ...actor,
        clientId: customer.clientId,
        siteId,
        templateVersionId: template.versionId,
        equipmentIds: [equipment.id],
        effectiveFromDate: firstDue,
        firstDueDate: firstDue,
        intervalMonths: 6,
        businessDate,
        instructions: 'Zugang und Messpunkte vor Ort prüfen.',
        ...(coverage ? { coverageId: coverage.id } : {}),
      })
    : null;
  const firstDueLabel = new Intl.DateTimeFormat('de-DE').format(new Date(`${firstDue}T12:00:00Z`));
  return { names, customer, siteId, equipment, coverage, plan, firstDue, firstDueLabel };
}

async function expectMaintenanceColumns(header: Locator, row: Locator, columns: boolean): Promise<void> {
  if (columns) await expect(header).toBeVisible();
  else await expect(header).toBeHidden();
  const cells = await row.evaluate((element) =>
    Array.from(element.children).map((cell) => {
      const bounds = cell.getBoundingClientRect();
      return { x: bounds.x, width: bounds.width, top: bounds.top, bottom: bounds.bottom };
    }),
  );
  expect(cells).toHaveLength(4);
  if (columns) {
    const headings = await header.evaluate((element) =>
      Array.from(element.children).map((cell) => {
        const bounds = cell.getBoundingClientRect();
        return { x: bounds.x, width: bounds.width };
      }),
    );
    expect(headings).toHaveLength(4);
    for (const [index, cell] of cells.entries()) {
      const heading = expectDefined(headings[index], `the heading of column ${index + 1}`);
      expect(Math.abs(cell.x - heading.x), `column ${index + 1} start`).toBeLessThanOrEqual(1);
      expect(Math.abs(cell.width - heading.width), `column ${index + 1} width`).toBeLessThanOrEqual(1);
    }
  } else {
    for (let index = 1; index < cells.length; index += 1) {
      const cell = expectDefined(cells[index], `rendered column ${index + 1}`);
      const previousCell = expectDefined(cells[index - 1], `rendered column ${index}`);
      expect(cell.top).toBeGreaterThanOrEqual(previousCell.bottom);
    }
  }
  const containment = await row.evaluate((element) => {
    const action = element.lastElementChild;
    if (!action) throw new Error('The maintenance row has no action cell.');
    const bounds = action.getBoundingClientRect();
    return {
      rowOverflow: element.scrollWidth - element.clientWidth,
      actionOverflow: action.scrollWidth - action.clientWidth,
      controlsContained: Array.from(action.querySelectorAll('button')).every((button) => {
        const control = button.getBoundingClientRect();
        return control.left >= bounds.left - 1 && control.right <= bounds.right + 1;
      }),
    };
  });
  expect(containment.rowOverflow).toBeLessThanOrEqual(1);
  expect(containment.actionOverflow).toBeLessThanOrEqual(1);
  expect(containment.controlsContained).toBe(true);
}

async function verifyMaintenanceResponsiveRow(
  page: Page,
  header: Locator,
  row: Locator,
  width: number,
): Promise<void> {
  await expectMaintenanceColumns(header, row, width === 1280);
  if (width !== 1280) return;
  // Sidebar tablets have too little content width for four useful columns.
  await page.setViewportSize({ width: 768, height: 900 });
  try {
    await expectMaintenanceColumns(header, row, false);
  } finally {
    await page.setViewportSize({ width: 1280, height: 900 });
  }
}

type DocumentFrameGeometry = {
  frameX: number;
  frameWidth: number;
  headerX: number;
  headerY: number;
  headerWidth: number;
  headerHeight: number;
  actionsX: number;
  actionsY: number;
  actionsHeight: number;
  rowHeight: number;
  metadataWraps: boolean;
};

async function measureDocumentFrame(dialog: Locator): Promise<DocumentFrameGeometry> {
  await expect
    .poll(() =>
      dialog.evaluate(
        (element) =>
          element
            .getAnimations()
            .filter((animation) => animation.playState === 'running' || animation.pending).length,
      ),
    )
    .toBe(0);
  return dialog.locator('[data-slot="contextual-documents-frame"]').evaluate((frame) => {
    const header = frame.querySelector('[data-slot="contextual-documents-header"]');
    const actions = frame.querySelector('[data-slot="contextual-documents-actions"]');
    const row = frame.querySelector('[data-slot="list-row"]');
    if (!header || !actions || !row)
      throw new Error(
        'Document frame, toolbar and representative row must exist in both loading and loaded states.',
      );
    const bounds = frame.getBoundingClientRect();
    const headerBounds = header.getBoundingClientRect();
    const actionBounds = actions.getBoundingClientRect();
    const metadata = row.firstElementChild?.lastElementChild;
    return {
      frameX: bounds.x,
      frameWidth: bounds.width,
      headerX: headerBounds.x - bounds.x,
      headerY: headerBounds.y - bounds.y,
      headerWidth: headerBounds.width,
      headerHeight: headerBounds.height,
      actionsX: actionBounds.x - bounds.x,
      actionsY: actionBounds.y - bounds.y,
      actionsHeight: actionBounds.height,
      rowHeight: row.getBoundingClientRect().height,
      metadataWraps: Boolean(
        metadata &&
          metadata.getBoundingClientRect().height >
            Number.parseFloat(getComputedStyle(metadata).lineHeight) + 1,
      ),
    };
  });
}

test.describe('P1-20 exhaustive maintenance audit @AUDIT-W2-P1-20 @AUDIT-W2', () => {
  test('requires an explicit reason for a second plan on the same equipment', async ({
    adminPage,
    world,
    businessDate,
  }) => {
    const { names, customer, firstDue } = await seedMaintenanceOwners(world, 'overlap', businessDate, {
      plan: true,
    });
    const dialog = await openMaintenancePlanDialog(adminPage);
    await fillMaintenancePlanForm(adminPage, dialog, {
      clientName: names.customer,
      siteName: names.site,
      templateName: names.template,
      effectiveFrom: firstDue,
      firstDue: ownedBerlinDateAtOffset('p1-20', 106),
      equipmentName: names.equipment,
    });
    await maintenancePlanSubmit(dialog).click();
    await expect(dialog.getByRole('alert')).toContainText(
      expectDefined(
        MAINTENANCE_PLAN_ERROR_MESSAGES.maintenance_overlap_reason_required,
        'the overlap-reason message',
      ),
    );

    await maintenancePlanOverlapReason(dialog).fill(
      'Zweite Fachwartung deckt einen getrennten Anlagenumfang ab.',
    );
    await maintenancePlanSubmit(dialog).click();
    await expect(dialog).toHaveCount(0, { timeout: 20_000 });
    const planNumbers = await getMaintenancePlanNumbersByClient(world.orgId, customer.clientId);
    expect(planNumbers).toHaveLength(2);
    const second = expectDefined(
      await getMaintenanceStateByPlanNumber(
        world.orgId,
        expectDefined(planNumbers[1], 'the second plan number'),
      ),
      'the justified overlapping plan',
    );
    expect(second.revisions[0]?.overlap_reason).toContain('getrennten');
  });

  test('links a reactive service case to due work without creating a job', async ({
    adminPage,
    world,
    businessDate,
  }) => {
    const { customer, siteId, equipment, plan, firstDueLabel } = await seedMaintenanceOwners(
      world,
      'service-link',
      businessDate,
      { plan: true },
    );
    const planNumber = expectDefined(plan, 'the seeded plan').planNumber;
    const serviceSummary = `P120 Audit reaktiver Befund ${world.runId}`;
    await seedServiceCase({
      orgId: world.orgId,
      actorId: world.users.admin.id,
      clientId: customer.clientId,
      siteId,
      summary: serviceSummary,
      statement: 'Gesonderter reaktiver Befund während der Wartung.',
      equipmentIds: [equipment.id],
    });
    await adminPage.goto(maintenanceSearchUrl(planNumber));
    const dueRow = maintenanceDueRow(adminPage, planNumber, firstDueLabel);
    await maintenanceDueRowAction(dueRow, 'createJob').click();
    const dialog = maintenanceDueActionDialog(adminPage);
    await chooseMaintenanceDueAction(adminPage, dialog, 'link_service_case');
    await selectFromSearchable(adminPage, maintenanceDueServiceCasePicker(dialog), serviceSummary);
    await maintenanceDueReason(dialog).fill('Reaktiver Befund gehört exakt zu dieser Wartungsfälligkeit.');
    await maintenanceDueSubmit(dialog).click();
    await expect(dialog).toHaveCount(0, { timeout: 20_000 });

    const state = expectDefined(await getMaintenanceStateByPlanNumber(world.orgId, planNumber), 'plan state');
    expect(state.serviceCaseLinks).toHaveLength(1);
    expect(state.dueWork.every((due) => due.job_id === null)).toBe(true);
  });

  test('keeps due and coverage rows readable from phone to desktop', async ({
    adminPage,
    world,
    businessDate,
  }, testInfo) => {
    const { names, plan, firstDueLabel } = await seedMaintenanceOwners(world, 'responsive', businessDate, {
      plan: true,
      coverage: true,
    });
    const planNumber = expectDefined(plan, 'the seeded plan').planNumber;
    const state = expectDefined(await getMaintenanceStateByPlanNumber(world.orgId, planNumber), 'plan state');

    await adminPage.goto(maintenanceSearchUrl(planNumber));
    const populatedDueRow = maintenanceDueRow(adminPage, planNumber, firstDueLabel);
    await expect(populatedDueRow).toBeVisible();
    const duePanel = adminPage
      .getByRole('main')
      .getByRole('tabpanel')
      .filter({
        has: adminPage
          .getByTestId('maintenance-due-row')
          .filter({ hasText: planNumber })
          .filter({ hasText: firstDueLabel }),
      });
    const dueHeader = duePanel.getByTestId('maintenance-due-header');
    const planRows = duePanel.getByTestId('maintenance-due-row').filter({ hasText: planNumber });
    const openPlanDue = state.dueWork.filter((due) => ['open', 'visit_created'].includes(due.status));
    await expect(planRows).toHaveCount(openPlanDue.length);
    const lastDue = expectDefined(
      [...openPlanDue].sort((left, right) => left.due_date.localeCompare(right.due_date)).at(-1),
      'the last open due item of the seeded plan',
    );
    const lastOwnedDueRow = duePanel
      .locator(`[data-testid="maintenance-due-row"][data-due-date="${lastDue.due_date}"]`)
      .filter({ hasText: planNumber });
    await captureResponsiveSection(
      adminPage,
      testInfo,
      duePanel,
      'p120-maintenance-due-populated',
      async (width) => {
        await verifyMaintenanceResponsiveRow(adminPage, dueHeader, populatedDueRow, width);
        await expectMaintenanceColumns(dueHeader, lastOwnedDueRow, width === 1280);
        await lastOwnedDueRow.scrollIntoViewIfNeeded();
        await expect(lastOwnedDueRow).toBeInViewport({ ratio: 1 });
        if (width === 375) return populatedDueRow;
        await populatedDueRow.scrollIntoViewIfNeeded();
      },
    );

    await adminPage.goto(maintenanceSearchUrl(names.coverageReference));
    await maintenanceTab(adminPage, 'coverages').click();
    const coverageRow = maintenanceCoverageRow(adminPage, names.coverageReference);
    await expect(coverageRow).toBeVisible();
    const coveragePanel = adminPage
      .getByRole('main')
      .getByRole('tabpanel')
      .filter({
        has: adminPage.getByTestId('maintenance-coverage-row').filter({ hasText: names.coverageReference }),
      });
    await captureResponsiveSection(
      adminPage,
      testInfo,
      coveragePanel,
      'p120-maintenance-coverage-populated',
      async (width) => {
        await verifyMaintenanceResponsiveRow(
          adminPage,
          coveragePanel.getByTestId('maintenance-coverage-header'),
          coverageRow,
          width,
        );
        if (width === 375) return coverageRow;
      },
    );
  });

  test('attaches a coverage document and keeps its frame stable while loading', async ({
    adminPage,
    world,
    businessDate,
  }, testInfo) => {
    const { names, coverage } = await seedMaintenanceOwners(world, 'documents', businessDate, {
      coverage: true,
    });
    const seededCoverage = expectDefined(coverage, 'the seeded coverage');
    await adminPage.goto(maintenanceSearchUrl(names.coverageReference));
    await maintenanceTab(adminPage, 'coverages').click();
    const coverageRow = maintenanceCoverageRow(adminPage, names.coverageReference);
    const documentsDialog = maintenanceCoverageDocumentsDialog(adminPage, seededCoverage.coverageNumber);
    await maintenanceCoverageAction(coverageRow, 'documents').click();
    await uploadIntoDocumentsSection(
      adminPage,
      resolve(artifactsDirectory(), 'upload-fixture.pdf'),
      'upload-fixture',
      { enclosingDialog: documentsDialog },
    );
    await documentsDialog.getByRole('button', { name: SHARED_COPY.action.close }).click();
    const linked = expectDefined(
      await getMaintenanceCoverageStateByReference(world.orgId, names.coverageReference),
      'the coverage state',
    );
    expect(linked.documentLinks).toHaveLength(1);

    let releaseRead: () => void = () => undefined;
    const readReleased = new Promise<void>((resolveRead) => {
      releaseRead = resolveRead;
    });
    let interceptedRead = false;
    const heldReads: Promise<void>[] = [];
    const readUrl = '**/api/background-read?*';
    const holdCoverageRead = async (route: Route): Promise<void> => {
      const request = route.request();
      if (new URL(request.url()).searchParams.get('kind') !== 'maintenance-coverage-documents') {
        await route.continue();
        return;
      }
      // The dialog reads this coverage's documents over the background-read
      // route when it opens. Keep its real response.
      interceptedRead = true;
      const continued = readReleased.then(() => route.continue());
      heldReads.push(continued);
      await continued;
    };
    await adminPage.route(readUrl, holdCoverageRead);
    const loadingGeometry = new Map<number, DocumentFrameGeometry>();
    try {
      await maintenanceCoverageAction(coverageRow, 'documents').click();
      await expect.poll(() => interceptedRead, { message: 'The coverage document read was held' }).toBe(true);
      // The held read keeps exactly this dialog's frame in its loading state.
      const loadingStatus = maintenanceCoverageDocumentsLoading(documentsDialog);
      await expect(loadingStatus).toBeVisible();
      await captureResponsiveSection(
        adminPage,
        testInfo,
        documentsDialog,
        'p120-maintenance-documents-loading',
        async (width) => {
          await expect(loadingStatus).toBeVisible();
          loadingGeometry.set(width, await measureDocumentFrame(documentsDialog));
        },
      );
    } finally {
      releaseRead();
      try {
        await Promise.all(heldReads);
      } finally {
        await adminPage.unroute(readUrl, holdCoverageRead);
      }
    }
    const loadedDocument = documentsDialog
      .getByTestId('contextual-documents-section')
      .getByText(testData`upload-fixture`)
      .filter({ visible: true });
    await expect(loadedDocument).toBeVisible();
    await captureResponsiveSection(
      adminPage,
      testInfo,
      documentsDialog,
      'p120-maintenance-documents-loaded',
      async (width) => {
        await expect(loadedDocument).toBeVisible();
        const loading = expectDefined(
          loadingGeometry.get(width),
          `the document loading geometry at ${width}px`,
        );
        const loaded = await measureDocumentFrame(documentsDialog);
        for (const property of [
          'frameX',
          'frameWidth',
          'headerX',
          'headerY',
          'headerWidth',
          'headerHeight',
          'actionsY',
          'actionsHeight',
        ] as const) {
          expect(
            Math.abs(loaded[property] - loading[property]),
            `${width}px document ${property}`,
          ).toBeLessThanOrEqual(1);
        }
        // Placeholder label widths are approximate; toolbar height and its
        // position within the shared frame still have to match.
        expect(
          Math.abs(loaded.actionsX - loading.actionsX),
          `${width}px document actionsX`,
        ).toBeLessThanOrEqual(8);
        // Long real metadata may wrap on phones. Compare exact row height
        // only when its text fits the skeleton's single metadata line.
        if (!loaded.metadataWraps)
          expect(
            Math.abs(loaded.rowHeight - loading.rowHeight),
            `${width}px document row height`,
          ).toBeLessThanOrEqual(1);
      },
    );
    await documentsDialog.getByRole('button', { name: SHARED_COPY.action.close }).click();
  });

  test('rejects a stale pause from a second manager', async ({
    adminPage,
    bueroPage,
    world,
    businessDate,
  }) => {
    const { plan } = await seedMaintenanceOwners(world, 'stale', businessDate, { plan: true });
    const planNumber = expectDefined(plan, 'the seeded plan').planNumber;
    const staleDialog = await openMaintenancePlanAction(bueroPage, planNumber, 'pause');
    const currentDialog = await openMaintenancePlanAction(adminPage, planNumber, 'pause');
    await maintenancePlanActionReason(currentDialog).fill('Plan während der getrennten Fachprüfung pausiert');
    await maintenancePlanActionSubmit(currentDialog, 'pause').click();
    await expect(currentDialog).toHaveCount(0, { timeout: 20_000 });
    await maintenancePlanActionReason(staleDialog).fill('Dieser veraltete Stand darf nicht gewinnen');
    await maintenancePlanActionSubmit(staleDialog, 'pause').click();
    await expect(staleDialog.getByRole('alert')).toContainText(MAINTENANCE_PLAN_STALE_TEXT);
    await staleDialog.getByRole('button', { name: SHARED_COPY.action.cancel }).click();

    const state = expectDefined(await getMaintenanceStateByPlanNumber(world.orgId, planNumber), 'plan state');
    expect(state.plan.status).toBe('suspended');
    expect(state.planEvents.filter((event) => event.event_type === 'status_changed')).toHaveLength(1);
  });

  test('terminates and then archives a plan with reasons', async ({ adminPage, world, businessDate }) => {
    const { plan } = await seedMaintenanceOwners(world, 'archive', businessDate, { plan: true });
    const planNumber = expectDefined(plan, 'the seeded plan').planNumber;
    let dialog = await openMaintenancePlanAction(adminPage, planNumber, 'terminate');
    await maintenancePlanActionReason(dialog).fill('Auditplan nachvollziehbar beendet');
    await maintenancePlanActionSubmit(dialog, 'terminate').click();
    await expect(dialog).toHaveCount(0, { timeout: 20_000 });
    dialog = await openMaintenancePlanAction(adminPage, planNumber, 'archive');
    await maintenancePlanActionReason(dialog).fill('Beendeten Auditplan aus der laufenden Ansicht entfernt');
    await maintenancePlanActionSubmit(dialog, 'archive').click();
    await expect(dialog).toHaveCount(0, { timeout: 20_000 });

    const state = expectDefined(await getMaintenanceStateByPlanNumber(world.orgId, planNumber), 'plan state');
    expect(state.plan.status).toBe('terminated');
    expect(state.plan.archived_at).not.toBeNull();
  });

  test('keeps maintenance from employees and other organizations', async ({
    employeePage,
    outsiderPage,
    world,
    businessDate,
  }) => {
    const { names } = await seedMaintenanceOwners(world, 'denial', businessDate, { coverage: true });
    await employeePage.goto('/service/wartung');
    await expect(employeePage).not.toHaveURL(/\/service\/wartung/);
    await outsiderPage.goto('/service/wartung');
    await expect(maintenancePageHeading(outsiderPage)).toBeVisible();
    await expect(textInDom(outsiderPage, names.coverageReference)).toHaveCount(0);
  });
});
