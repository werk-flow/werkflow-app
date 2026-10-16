import { expect, type Locator, type Page } from '@playwright/test';
import { addLocalMonthsClamped } from '../../../../lib/date-time/berlin';
import type { DialogOpenerId } from '../../../../lib/testing/selection/dialog-inventory';
import { seedCustomer } from '../../../golden/support/db/customers';
import {
  seedInstalledEquipment,
  seedInstalledEquipmentReplacement,
  seedMaintenanceCoverage,
  seedMaintenancePlan,
  seedServiceCase,
  seedServiceCaseJobLink,
} from '../../../golden/support/db/service';
import { seedJob, seedPublishedWorkTemplate, seedWorkReportDraft } from '../../../golden/support/db/work';
import {
  equipmentArchiveButton,
  equipmentConfirmation,
  equipmentCorrectionButton,
  equipmentCreateButton,
  equipmentSourceButton,
  equipmentStateButton,
  equipmentWorkLinkButton,
  maintenanceCoverageAction,
  maintenanceCoverageCreateButton,
  maintenanceCoverageDocumentsLayer,
  maintenanceCoverageRow,
  maintenanceDueActionDialog,
  maintenanceDueRowAction,
  maintenanceDueRowNaming,
  maintenancePlanActionDialog,
  maintenancePlanCardAction,
  maintenancePlanCreateButton,
  maintenanceSearchUrl,
  maintenanceTab,
  serviceCaseCaptureButton,
  serviceCaseEvidenceButton,
  serviceCaseFollowUpButton,
  serviceCaseRelationButton,
  serviceDialog,
} from '../../../golden/support/steps/service';
import type { TestWorld } from '../../../golden/support/world';
import type { DialogOpener } from '../dialog-opener';
import { surfaceFixture, type SurfaceContext } from '../surface-fixtures';

/** The rows these openers seed beside the layout fixtures; the run id keeps them unique. */
function serviceAuditNames(world: TestWorld) {
  return {
    site: 'Heizzentrale im Keller',
    maintenanceClient: `Layout Wartungskunde ${world.runId}`,
    maintenanceEquipment: `Layout Gasbrennwertkessel ${world.runId}`,
    maintenanceTemplate: `Layout Jahreswartung ${world.runId}`,
    coverageReference: `LAYOUT-WARTUNG-${world.runId}`,
    replacementClient: `Layout Anlagentausch Kunde ${world.runId}`,
    replacedEquipment: `Layout Ersetzter Wärmeerzeuger ${world.runId}`,
    evidenceClient: `Layout Servicenachweis Kunde ${world.runId}`,
    evidenceCase: `Layout Servicefall mit Arbeitsnachweis ${world.runId}`,
  };
}

/** A customer with one work site, the owner every seeded service record needs. */
async function seedServiceCustomer(
  world: TestWorld,
  name: string,
): Promise<{ clientId: string; siteId: string }> {
  const site = serviceAuditNames(world).site;
  const customer = await seedCustomer({
    orgId: world.orgId,
    actorId: world.users.admin.id,
    name,
    sites: [{ name: site, street: 'Wartungsweg 12', postalCode: '10115', city: 'Berlin', isPrimary: true }],
  });
  const siteId = customer.siteIds.get(site);
  if (!siteId) throw new Error(`Seeded customer ${name} has no work site.`);
  return { clientId: customer.clientId, siteId };
}

/**
 * One customer site with an equipment, a coverage and an active plan whose
 * first due date lies a month after the business date. Returns the coverage
 * number.
 */
function prepareMaintenance({ world, businessDate }: SurfaceContext): Promise<string> {
  return surfaceFixture(world, 'service.maintenance', async () => {
    const names = serviceAuditNames(world);
    const actor = { orgId: world.orgId, actorId: world.users.admin.id };
    const { clientId, siteId } = await seedServiceCustomer(world, names.maintenanceClient);
    const equipment = await seedInstalledEquipment({
      ...actor,
      clientId,
      siteId,
      name: names.maintenanceEquipment,
    });
    const template = await seedPublishedWorkTemplate({
      ...actor,
      name: names.maintenanceTemplate,
      targetType: 'job',
      items: [{ content: 'Anlage fachgerecht warten' }],
    });
    const coverage = await seedMaintenanceCoverage({
      ...actor,
      clientId,
      siteId,
      reference: names.coverageReference,
      validFrom: businessDate,
      validUntil: addLocalMonthsClamped(businessDate, 12),
    });
    await seedMaintenancePlan({
      ...actor,
      clientId,
      siteId,
      templateVersionId: template.versionId,
      equipmentIds: [equipment.id],
      effectiveFromDate: businessDate,
      firstDueDate: addLocalMonthsClamped(businessDate, 1),
      intervalMonths: 6,
      businessDate,
    });
    return coverage.coverageNumber;
  });
}

/** Opens the maintenance workspace searched for the seeded customer, on one of its tabs. */
async function openSeededMaintenance(
  context: SurfaceContext,
  tab: 'due' | 'plans' | 'coverages',
): Promise<void> {
  await prepareMaintenance(context);
  await context.page.goto(maintenanceSearchUrl(serviceAuditNames(context.world).maintenanceClient));
  if (tab !== 'due') await maintenanceTab(context.page, tab).click();
}

/**
 * A replaced equipment: its terminal action offers the correction and its
 * state allows archiving. Returns the predecessor's equipment number.
 */
function prepareReplacedEquipment(world: TestWorld): Promise<string> {
  return surfaceFixture(world, 'service.replaced-equipment', async () => {
    const names = serviceAuditNames(world);
    const actor = { orgId: world.orgId, actorId: world.users.admin.id };
    const { clientId, siteId } = await seedServiceCustomer(world, names.replacementClient);
    const predecessor = await seedInstalledEquipment({
      ...actor,
      clientId,
      siteId,
      name: names.replacedEquipment,
    });
    await seedInstalledEquipmentReplacement({
      ...actor,
      predecessorId: predecessor.id,
      inactiveReason: 'Kessel ist außer Betrieb.',
      successorName: `${names.replacedEquipment} Nachfolger`,
      successorSerialNumber: `LAYOUT-${world.runId}-NACHFOLGER`,
      reason: 'Kessel wurde getauscht.',
    });
    return predecessor.equipmentNumber;
  });
}

/**
 * A service case with a job of its site and a work report on that job, the
 * state in which the evidence section offers a link. Returns the case number.
 */
function prepareEvidenceCase(world: TestWorld): Promise<string> {
  return surfaceFixture(world, 'service.evidence-case', async () => {
    const names = serviceAuditNames(world);
    const actor = { orgId: world.orgId, actorId: world.users.admin.id };
    const { clientId, siteId } = await seedServiceCustomer(world, names.evidenceClient);
    const jobId = await seedJob({
      ...actor,
      clientId,
      siteId,
      jobNumber: `AUF-${world.runId}-SERVICE`,
      title: `Layout Störungseinsatz ${world.runId}`,
    });
    await seedWorkReportDraft({
      ...actor,
      jobId,
      title: 'Arbeitsbericht zur Störung',
      performedWork: 'Brenner gereinigt und Zündung geprüft.',
    });
    const serviceCase = await seedServiceCase({
      ...actor,
      clientId,
      siteId,
      summary: names.evidenceCase,
      statement: 'Die Heizung fällt morgens aus.',
    });
    await seedServiceCaseJobLink({ ...actor, serviceCaseId: serviceCase.id, jobId });
    return serviceCase.caseNumber;
  });
}

/** Opens a seeded detail page and waits until the trigger is usable. */
async function onDetail(page: Page, route: string, trigger: Locator): Promise<Locator> {
  await page.goto(route);
  await expect(trigger).toBeEnabled();
  return trigger;
}

export const SERVICE_OPENERS = {
  'service.equipment-form': {
    trigger: async ({ page }) => equipmentCreateButton(page),
    layer: (page) => serviceDialog(page, 'equipmentCreate'),
  },
  'service.equipment-state': {
    trigger: async ({ page }) => equipmentStateButton(page),
    layer: (page) => serviceDialog(page, 'equipmentState'),
  },
  'service.equipment-work-link': {
    trigger: async ({ page }) => equipmentWorkLinkButton(page),
    layer: (page) => serviceDialog(page, 'equipmentWorkLink'),
  },
  'service.equipment-source': {
    trigger: async ({ page }) => equipmentSourceButton(page),
    layer: (page) => serviceDialog(page, 'equipmentSource'),
  },
  'service.equipment-correction': {
    trigger: async ({ page, world }) =>
      onDetail(
        page,
        `/service/anlagen/${await prepareReplacedEquipment(world)}`,
        equipmentCorrectionButton(page),
      ),
    layer: (page) => equipmentConfirmation(page, 'correction'),
  },
  'service.equipment-archive': {
    trigger: async ({ page, world }) =>
      onDetail(
        page,
        `/service/anlagen/${await prepareReplacedEquipment(world)}`,
        equipmentArchiveButton(page),
      ),
    layer: (page) => equipmentConfirmation(page, 'archive'),
  },
  'service.case-form': {
    trigger: async ({ page }) => serviceCaseCaptureButton(page),
    layer: (page) => serviceDialog(page, 'caseCreate'),
  },
  'service.case-relation': {
    trigger: async ({ page }) => serviceCaseRelationButton(page),
    layer: (page) => serviceDialog(page, 'caseRelation'),
  },
  'service.case-follow-up': {
    trigger: async ({ page }) => {
      const button = serviceCaseFollowUpButton(page);
      await expect(button).toBeEnabled();
      return button;
    },
    layer: (page) => serviceDialog(page, 'followUp'),
  },
  'service.case-evidence': {
    trigger: async ({ page, world }) =>
      onDetail(page, `/service/faelle/${await prepareEvidenceCase(world)}`, serviceCaseEvidenceButton(page)),
    layer: (page) => serviceDialog(page, 'caseEvidence'),
  },
  'service.coverage': {
    trigger: async ({ page }) => maintenanceCoverageCreateButton(page),
    layer: (page) => serviceDialog(page, 'coverageCreate'),
  },
  'service.plan': {
    trigger: async ({ page }) => maintenancePlanCreateButton(page),
    layer: (page) => serviceDialog(page, 'planCreate'),
  },
  'service.due-action': {
    trigger: async (context) => {
      await openSeededMaintenance(context, 'due');
      const row = maintenanceDueRowNaming(context.page, serviceAuditNames(context.world).maintenanceClient);
      return maintenanceDueRowAction(row, 'createJob');
    },
    layer: maintenanceDueActionDialog,
  },
  'service.plan-action': {
    trigger: async (context) => {
      await openSeededMaintenance(context, 'plans');
      return maintenancePlanCardAction(
        context.page,
        serviceAuditNames(context.world).maintenanceClient,
        'pause',
      );
    },
    layer: (page) => maintenancePlanActionDialog(page, 'pause'),
  },
  'service.coverage-follow-up': {
    trigger: async (context) => {
      await openSeededMaintenance(context, 'coverages');
      const row = maintenanceCoverageRow(context.page, serviceAuditNames(context.world).coverageReference);
      return maintenanceCoverageAction(row, 'followUp');
    },
    layer: (page) => serviceDialog(page, 'followUp'),
  },
  'service.coverage-documents': {
    trigger: async (context) => {
      await openSeededMaintenance(context, 'coverages');
      const row = maintenanceCoverageRow(context.page, serviceAuditNames(context.world).coverageReference);
      return maintenanceCoverageAction(row, 'documents');
    },
    // The title names the coverage number; the search leaves one coverage on screen.
    layer: maintenanceCoverageDocumentsLayer,
  },
} satisfies Partial<Record<DialogOpenerId, DialogOpener>>;
