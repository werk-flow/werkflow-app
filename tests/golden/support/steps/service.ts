import { expect, type Locator, type Page } from '@playwright/test';
import {
  EQUIPMENT_CATEGORY_LABELS,
  EQUIPMENT_STATE_LABELS,
  type EquipmentCategory,
  type EquipmentState,
} from '../../../../lib/installed-equipment/types';
import {
  MAINTENANCE_RENEWAL_SIGNAL_LABELS,
  type MaintenanceRenewalSignal,
} from '../../../../lib/maintenance/types';
import {
  SERVICE_CASE_CHARGE_CONTEXT_LABELS,
  SERVICE_CASE_RELATION_LABELS,
  SERVICE_CASE_STATUS_LABELS,
  SERVICE_CASE_URGENCY_LABELS,
  type ServiceCaseChargeContext,
  type ServiceCaseRelationType,
  type ServiceCaseStatus,
} from '../../../../lib/service-cases/types';
import {
  SHARED_COPY,
  escapeRegExp,
  pendingRow,
  selectFromSearchable,
  typeIntoDatePickerById,
  visibleText,
} from './shared';
import {
  getInstalledEquipmentByNumber,
  getServiceCaseByNumber,
  type PersistedEquipment,
  type PersistedServiceCase,
} from '../db/service';

/**
 * The service area (P1-18 to P1-20): installed equipment (Anlagen), service
 * cases (Servicefälle) and maintenance (Wartung). State, category, status,
 * urgency, charge-context, relation and renewal names come from the product
 * label maps in lib/; the rest of the copy lives in client components and is
 * held once here.
 */
const SERVICE_COPY = {
  /** The action that links an exact record (work, origin, relation, evidence). */
  link: SHARED_COPY.action.link,
  /** The record picker trigger of the relation and due-action dialogs. */
  searchServiceCase: 'Servicefall suchen',
} as const;

const EQUIPMENT_COPY = {
  create: 'Anlage erfassen',
  search: 'Anlagen durchsuchen',
  categoryFilter: 'Anlagen nach Kategorie filtern',
  technicalSection: 'Technische Angaben und Kennungen',
  lifecycleSection: 'Installation, Inbetriebnahme und Gewährleistung',
  field: {
    location: 'Position am Einsatzort',
    manufacturer: 'Hersteller',
    model: 'Modell',
    serialNumber: 'Seriennummer',
    warrantyProvider: 'Gewährleistungsgeber',
    changeReason: 'Grund der Änderung',
    sourceMeaning: 'Bedeutung des Nachweises',
    stateReason: 'Begründung',
    correctionReason: 'Korrekturgrund',
  },
  workLinkSection: 'Verknüpfte Arbeit',
  workLinkDialog: 'Arbeit verknüpfen',
  changeState: 'Zustand ändern',
  linkSource: 'Herkunftsnachweis verknüpfen',
  replace: 'Ersetzen',
  createSuccessor: 'Nachfolger anlegen',
  correctTerminalAction: 'Abschlussaktion korrigieren',
  recordCorrection: 'Korrektur festhalten',
  duplicateIdentifier: 'Diese Kennung wird bereits verwendet.',
  notRecorded: 'Nicht erfasst',
  noIdentifier: 'Keine Kennung erfasst.',
  voidedSuccessor: 'Dieser Nachfolger wurde durch eine Korrektur als irrtümlich erfasst markiert.',
  customerSection: 'Anlagen & Geräte',
  fieldPackHeading: 'Anlagen am Einsatzort',
} as const;

/** History entries of the equipment detail (equipment-detail-sections.tsx). */
const EQUIPMENT_EVENT_LABELS = {
  registered: 'Anlage erfasst',
  work_linked: 'Arbeitsbezug hinzugefügt',
  source_linked: 'Herkunftsnachweis verknüpft',
  terminal_action_corrected: 'Abschlussaktion korrigiert',
} as const;

/** Relation lines of the equipment sidebar: „<prefix>: <name>“. */
const EQUIPMENT_RELATION_PREFIXES = {
  parent: 'Übergeordnet',
  component: 'Komponente',
  predecessor: 'Vorgänger',
} as const;

const SERVICE_CASE_COPY = {
  create: 'Servicefall erfassen',
  search: 'Servicefälle durchsuchen',
  convert: 'Als Servicefall übernehmen',
  convertDialog: 'Anfrage als Servicefall übernehmen?',
  convertConfirm: 'Übernehmen',
  openSourceRequest: 'Ursprüngliche Anfrage öffnen',
  searchEvidence: 'Arbeitsnachweis suchen',
  evidenceLinked: 'Arbeitsnachweis wurde verknüpft.',
  createFollowUp: 'Nachfassaktion anlegen',
} as const;

const MAINTENANCE_COPY = {
  heading: 'Wartung',
  createCoverage: 'Abdeckung erfassen',
  saveCoverage: 'Abdeckung speichern',
  createPlan: 'Wartungsplan anlegen',
  planEquipment: 'Anlagen im Wartungsumfang',
  dueDialog: 'Fälligkeit bearbeiten',
  dueActionPicker: 'Aktion',
  dueReason: 'Begründung',
  runDueAction: 'Aktion ausführen',
  documentsDialogPrefix: 'Dokumente zu',
  documentsLoading: 'Dokumente werden geladen.',
} as const;

const MAINTENANCE_TABS = {
  plans: /Pläne/,
  coverages: /Abdeckungen/,
} as const;

/** The buttons of a due row (maintenance-lists.tsx). */
const MAINTENANCE_DUE_ROW_ACTIONS = {
  createJob: 'Auftrag anlegen',
  schedule: 'Termin planen',
  complete: 'Abschließen',
} as const;

/** Options of the due-action picker that a test chooses explicitly. */
const MAINTENANCE_DUE_ACTION_OPTIONS = {
  link_service_case: 'Reaktiven Servicefall verknüpfen',
} as const;

/** The buttons of a coverage row (maintenance-lists.tsx). */
const MAINTENANCE_COVERAGE_ROW_ACTIONS = {
  followUp: 'Wiedervorlage',
  documents: 'Dokumente',
} as const;

/** Plan card actions and the submit of the dialog each opens (maintenance-plan-cards.tsx). */
const MAINTENANCE_PLAN_ACTIONS = {
  pause: { open: 'Pausieren', submit: 'Wartungsplan pausieren' },
  terminate: { open: 'Beenden', submit: 'Wartungsplan beenden' },
  archive: { open: 'Archivieren', submit: 'Wartungsplan archivieren' },
} as const;

type ServiceCaseUrgency = keyof typeof SERVICE_CASE_URGENCY_LABELS;
type MaintenancePlanAction = keyof typeof MAINTENANCE_PLAN_ACTIONS;

/** The office-only equipment fact that a field work pack never names. */
export const EQUIPMENT_WARRANTY_PROVIDER_LABEL = EQUIPMENT_COPY.field.warrantyProvider;

/** What an equipment fact shows while it is unknown. */
export const EQUIPMENT_NOT_RECORDED = EQUIPMENT_COPY.notRecorded;

/**
 * The part of the plan action dialog's stale-version refusal that the audit
 * checks; the full sentence lives inline in maintenance-plan-action-dialog.tsx.
 */
export const MAINTENANCE_PLAN_STALE_TEXT = 'inzwischen geändert';

// ---------------------------------------------------------------------------
// Shared detail controls

/** The „Bearbeiten“ action of an equipment or service case detail. */
export function serviceEditButton(page: Page): Locator {
  return page.getByRole('button', { name: SHARED_COPY.action.edit });
}

// ---------------------------------------------------------------------------
// Installed equipment (P1-18)

export function equipmentListSearch(page: Page): Locator {
  return page.getByLabel(EQUIPMENT_COPY.search);
}

/** Filters the equipment list by one category through its picker. */
export async function filterEquipmentListByCategory(page: Page, category: EquipmentCategory): Promise<void> {
  await page.getByRole('combobox', { name: EQUIPMENT_COPY.categoryFilter }).click();
  await page.getByRole('option', { name: EQUIPMENT_CATEGORY_LABELS[category] }).click();
}

/** A history entry of the equipment detail. */
export function equipmentEvent(page: Page, event: keyof typeof EQUIPMENT_EVENT_LABELS): Locator {
  return visibleText(page, EQUIPMENT_EVENT_LABELS[event]);
}

/** A relation line of the equipment sidebar, such as „Vorgänger: <name>“. */
export function equipmentRelation(
  page: Page,
  relation: keyof typeof EQUIPMENT_RELATION_PREFIXES,
  equipmentName: string,
): Locator {
  return visibleText(page, `${EQUIPMENT_RELATION_PREFIXES[relation]}: ${equipmentName}`);
}

/** One fact of the equipment detail, by its test id. */
export function equipmentFact(page: Page, fact: 'manufacturer' | 'commissioning'): Locator {
  return page.getByRole('main').getByTestId(`equipment-fact-${fact}`);
}

/** The sidebar notice of an equipment without identifiers. */
export function equipmentNoIdentifierNotice(page: Page): Locator {
  return visibleText(page, EQUIPMENT_COPY.noIdentifier);
}

/** The notice on a successor that a correction marked as recorded in error. */
export function equipmentVoidedSuccessorNotice(page: Page): Locator {
  return visibleText(page, EQUIPMENT_COPY.voidedSuccessor);
}

/** The equipment section title of the customer detail. */
export function customerEquipmentSectionTitle(page: Page): Locator {
  return visibleText(page, EQUIPMENT_COPY.customerSection);
}

/** The equipment heading inside the field work pack. */
export function fieldPackEquipmentHeading(pack: Locator): Locator {
  return pack.getByText(EQUIPMENT_COPY.fieldPackHeading, { exact: true });
}

/** The work picker of the „Arbeit verknüpfen“ dialog. */
export function equipmentWorkTargetPicker(dialog: Locator): Locator {
  return dialog.locator('#equipment-work-target');
}

export async function createInstalledEquipment(
  page: Page,
  options: {
    orgId: string;
    customerName: string;
    siteName: string;
    name: string;
    category?: EquipmentCategory;
    parentName?: string;
    state?: Extract<EquipmentState, 'unknown' | 'active' | 'inactive'>;
    manufacturer?: string;
    model?: string;
    serialNumber?: string;
    location?: string;
    installationDate?: string;
    commissioningDate?: string;
    warrantyProvider?: string;
    warrantyEndDate?: string;
  },
): Promise<PersistedEquipment> {
  await page.goto('/service/anlagen');
  await page.getByRole('button', { name: EQUIPMENT_COPY.create }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: EQUIPMENT_COPY.create })).toBeVisible();
  await selectFromSearchable(page, dialog.locator('#equipment-client'), options.customerName);
  await selectFromSearchable(page, dialog.locator('#equipment-site'), options.siteName);
  await dialog.getByLabel(SHARED_COPY.field.name).fill(options.name);
  if (options.category) {
    await dialog.locator('#equipment-category').click();
    await page
      .getByRole('option', { name: EQUIPMENT_CATEGORY_LABELS[options.category], exact: true })
      .click();
  }
  if (options.parentName) {
    await selectFromSearchable(page, dialog.locator('#equipment-parent'), options.parentName);
  }
  if (options.state) {
    await dialog.locator('#equipment-state').click();
    await page.getByRole('option', { name: EQUIPMENT_STATE_LABELS[options.state], exact: true }).click();
  }
  if (options.location) await dialog.getByLabel(EQUIPMENT_COPY.field.location).fill(options.location);
  if (options.manufacturer || options.model || options.serialNumber) {
    await dialog.getByRole('button', { name: EQUIPMENT_COPY.technicalSection }).click();
    if (options.manufacturer) {
      await dialog.getByLabel(EQUIPMENT_COPY.field.manufacturer, { exact: true }).fill(options.manufacturer);
    }
    if (options.model)
      await dialog.getByLabel(EQUIPMENT_COPY.field.model, { exact: true }).fill(options.model);
    if (options.serialNumber) {
      await dialog.getByLabel(EQUIPMENT_COPY.field.serialNumber, { exact: true }).fill(options.serialNumber);
    }
  }
  if (
    options.installationDate ||
    options.commissioningDate ||
    options.warrantyProvider ||
    options.warrantyEndDate
  ) {
    await dialog.getByRole('button', { name: EQUIPMENT_COPY.lifecycleSection }).click();
    if (options.installationDate) {
      await typeIntoDatePickerById(dialog, 'equipment-installation-date', options.installationDate);
    }
    if (options.commissioningDate) {
      await typeIntoDatePickerById(dialog, 'equipment-commissioning-date', options.commissioningDate);
    }
    if (options.warrantyProvider) {
      await dialog.getByLabel(EQUIPMENT_COPY.field.warrantyProvider).fill(options.warrantyProvider);
    }
    if (options.warrantyEndDate) {
      await typeIntoDatePickerById(dialog, 'equipment-warranty-end', options.warrantyEndDate);
    }
  }
  await dialog.getByRole('button', { name: SHARED_COPY.action.save, exact: true }).click();
  await expect(dialog).toHaveCount(0, { timeout: 15_000 });
  await expect(pendingRow(page, options.name)).toHaveCount(0, {
    timeout: 20_000,
  });
  const equipmentLink = page.getByRole('link', {
    name: options.name,
    exact: true,
  });
  await expect(equipmentLink).toBeVisible({ timeout: 20_000 });
  await equipmentLink.click();
  await page.waitForURL(/\/service\/anlagen\/ANL-\d{4}-\d{3}$/i, {
    timeout: 20_000,
  });
  const equipmentNumber = page.url().split('/').at(-1);
  if (!equipmentNumber) throw new Error('Equipment number missing from detail route.');
  return getInstalledEquipmentByNumber(options.orgId, decodeURIComponent(equipmentNumber));
}

function equipmentWorkLinkSection(page: Page): Locator {
  return page.locator('section').filter({
    has: page.getByRole('heading', { name: EQUIPMENT_COPY.workLinkSection }),
  });
}

export async function linkInstalledEquipmentToJob(page: Page, jobNumber: string): Promise<void> {
  const dialog = await openInstalledEquipmentWorkLinkDialog(page);
  await selectFromSearchable(page, equipmentWorkTargetPicker(dialog), jobNumber);
  await dialog.getByRole('button', { name: SERVICE_COPY.link, exact: true }).click();
  await expect(dialog).toHaveCount(0, { timeout: 20_000 });
  await expect(equipmentWorkLinkSection(page).getByRole('link').filter({ hasText: jobNumber })).toBeVisible();
}

export async function openInstalledEquipmentWorkLinkDialog(page: Page): Promise<Locator> {
  await equipmentWorkLinkSection(page).getByRole('button', { name: SERVICE_COPY.link }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: EQUIPMENT_COPY.workLinkDialog })).toBeVisible();
  return dialog;
}

export async function transitionInstalledEquipment(
  page: Page,
  state: EquipmentState,
  reason: string,
): Promise<void> {
  const stateLabel = EQUIPMENT_STATE_LABELS[state];
  await page.getByRole('button', { name: EQUIPMENT_COPY.changeState }).click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('#equipment-target-state').click();
  await page.getByRole('option', { name: stateLabel, exact: true }).click();
  await dialog.getByLabel(EQUIPMENT_COPY.field.stateReason).fill(reason);
  await dialog.getByRole('button', { name: SHARED_COPY.action.saveChange }).click();
  await expect(dialog).toHaveCount(0, { timeout: 20_000 });
  await expect(page.getByText(stateLabel, { exact: true }).first()).toBeVisible();
}

export async function updateInstalledEquipmentModel(
  page: Page,
  model: string,
  reason: string,
  beforeSubmit?: () => void | Promise<void>,
): Promise<void> {
  await serviceEditButton(page).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(EQUIPMENT_COPY.field.model, { exact: true }).fill(model);
  await dialog.getByLabel(EQUIPMENT_COPY.field.changeReason).fill(reason);
  await beforeSubmit?.();
  await dialog.getByRole('button', { name: SHARED_COPY.action.save, exact: true }).click();
  await expect(dialog).toHaveCount(0, { timeout: 20_000 });
  await expect(visibleText(page, model)).toBeVisible({ timeout: 20_000 });
}

export async function linkInstalledEquipmentSourceToJob(
  page: Page,
  jobNumber: string,
  reason: string,
): Promise<void> {
  await page.getByRole('button', { name: EQUIPMENT_COPY.linkSource }).click();
  const dialog = page.getByRole('dialog');
  await selectFromSearchable(page, dialog.locator('#equipment-source'), jobNumber);
  await dialog.getByLabel(EQUIPMENT_COPY.field.sourceMeaning).fill(reason);
  await dialog.getByRole('button', { name: SERVICE_COPY.link, exact: true }).click();
  await expect(dialog).toHaveCount(0, { timeout: 20_000 });
  await expect(page.getByRole('link').filter({ hasText: jobNumber }).last()).toBeVisible();
}

export async function replaceInstalledEquipment(
  page: Page,
  options: { orgId: string; successorName: string; serialNumber: string; reason: string },
): Promise<PersistedEquipment> {
  const predecessorUrl = page.url();
  await page.getByRole('button', { name: EQUIPMENT_COPY.replace }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(SHARED_COPY.field.name).fill(options.successorName);
  await dialog.getByRole('button', { name: EQUIPMENT_COPY.technicalSection }).click();
  await dialog.getByLabel(EQUIPMENT_COPY.field.serialNumber, { exact: true }).fill(options.serialNumber);
  await dialog.getByLabel(EQUIPMENT_COPY.field.changeReason).fill(options.reason);
  await dialog.getByRole('button', { name: EQUIPMENT_COPY.createSuccessor }).click();
  await page.waitForURL(
    (url) => url.href !== predecessorUrl && /\/service\/anlagen\/ANL-\d{4}-\d{3}$/i.test(url.pathname),
    { timeout: 20_000 },
  );
  await expect(page.getByRole('heading', { name: options.successorName })).toBeVisible();
  return getInstalledEquipmentByNumber(options.orgId, decodeURIComponent(page.url().split('/').at(-1) ?? ''));
}

export async function expectDuplicateInstalledEquipmentRejected(
  page: Page,
  options: {
    customerName: string;
    siteName: string;
    name: string;
    manufacturer: string;
    serialNumber: string;
  },
): Promise<void> {
  await page.goto('/service/anlagen');
  await page.getByRole('button', { name: EQUIPMENT_COPY.create }).first().click();
  const dialog = page.getByRole('dialog');
  await selectFromSearchable(page, dialog.locator('#equipment-client'), options.customerName);
  await selectFromSearchable(page, dialog.locator('#equipment-site'), options.siteName);
  await dialog.getByLabel(SHARED_COPY.field.name).fill(options.name);
  await dialog.getByRole('button', { name: EQUIPMENT_COPY.technicalSection }).click();
  await dialog.getByLabel(EQUIPMENT_COPY.field.manufacturer, { exact: true }).fill(options.manufacturer);
  await dialog.getByLabel(EQUIPMENT_COPY.field.serialNumber, { exact: true }).fill(options.serialNumber);
  await dialog.getByRole('button', { name: SHARED_COPY.action.save, exact: true }).click();
  await expect(dialog).toHaveCount(0, { timeout: 15_000 });
  await expect(page.getByText(EQUIPMENT_COPY.duplicateIdentifier, { exact: true })).toBeVisible({
    timeout: 20_000,
  });
}

export async function correctInstalledEquipmentTerminalAction(page: Page, reason: string): Promise<void> {
  await page.getByRole('button', { name: EQUIPMENT_COPY.correctTerminalAction }).click();
  const dialog = page.getByRole('alertdialog');
  await dialog.getByLabel(EQUIPMENT_COPY.field.correctionReason).fill(reason);
  await dialog.getByRole('button', { name: EQUIPMENT_COPY.recordCorrection }).click();
  await expect(dialog).toHaveCount(0, { timeout: 20_000 });
  await expect(equipmentEvent(page, 'terminal_action_corrected')).toBeVisible();
}

// ---------------------------------------------------------------------------
// Reactive service cases and exact links to existing work owners (P1-19)

async function selectRadixOption(page: Page, trigger: Locator, optionName: string | RegExp): Promise<void> {
  await trigger.click();
  const option = page.getByRole('option', {
    name: optionName,
    exact: typeof optionName === 'string',
  });
  await expect(option).toBeVisible({ timeout: 15_000 });
  await option.click();
}

export function serviceCaseListSearch(page: Page): Locator {
  return page.getByLabel(SERVICE_CASE_COPY.search);
}

/** The job picker of the service case form. */
export function serviceCaseJobPicker(dialog: Locator): Locator {
  return dialog.locator('#service-job');
}

/** The link back to the request a case was taken over from. */
export function serviceCaseSourceRequestLink(page: Page): Locator {
  return visibleText(page, SERVICE_CASE_COPY.openSourceRequest);
}

/** A relation line of the case detail, such as „Fortsetzung von SRV-…“. */
export function serviceCaseRelationText(
  page: Page,
  relation: ServiceCaseRelationType,
  relatedCaseNumber: string,
): Locator {
  return visibleText(page, `${SERVICE_CASE_RELATION_LABELS[relation]} ${relatedCaseNumber}`);
}

export function serviceCaseEvidenceSection(page: Page): Locator {
  return page.getByRole('main').getByTestId('service-case-evidence');
}

/** The success banner after an Arbeitsnachweis was linked to the case. */
export function serviceCaseEvidenceLinkedBanner(page: Page): Locator {
  return page.getByRole('alert').filter({ hasText: SERVICE_CASE_COPY.evidenceLinked });
}

export async function createDirectServiceCase(
  page: Page,
  options: {
    orgId: string;
    customerName: string;
    siteName: string;
    statement: string;
    summary: string;
    urgency?: ServiceCaseUrgency;
    chargeContext?: ServiceCaseChargeContext;
    accessInstructions?: string;
    triageNote?: string;
    equipmentName?: string;
  },
): Promise<PersistedServiceCase> {
  await page.goto('/service/faelle');
  await page.getByRole('button', { name: SERVICE_CASE_COPY.create }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: SERVICE_CASE_COPY.create })).toBeVisible();
  await selectFromSearchable(page, dialog.locator('#service-client'), options.customerName);
  await selectFromSearchable(page, dialog.locator('#service-site'), options.siteName);
  await dialog.locator('#service-statement').fill(options.statement);
  await dialog.locator('#service-summary').fill(options.summary);
  if (options.urgency) {
    await selectRadixOption(
      page,
      dialog.locator('#service-urgency'),
      SERVICE_CASE_URGENCY_LABELS[options.urgency],
    );
  }
  if (options.chargeContext) {
    await selectRadixOption(
      page,
      dialog.locator('#service-charge'),
      SERVICE_CASE_CHARGE_CONTEXT_LABELS[options.chargeContext],
    );
  }
  if (options.accessInstructions) {
    await dialog.locator('#service-access').fill(options.accessInstructions);
  }
  if (options.triageNote) {
    await dialog.locator('#service-triage').fill(options.triageNote);
  }
  if (options.equipmentName) {
    const equipmentCheckbox = dialog
      .getByRole('checkbox', {
        name: new RegExp(escapeRegExp(options.equipmentName)),
      })
      .first();
    await expect(equipmentCheckbox).toBeVisible({ timeout: 15_000 });
    if (!(await equipmentCheckbox.isChecked())) await equipmentCheckbox.click();
    await expect(equipmentCheckbox).toBeChecked();
  }
  await dialog.getByRole('button', { name: SHARED_COPY.action.save, exact: true }).click();
  await expect(dialog).toHaveCount(0, { timeout: 15_000 });
  await expect(pendingRow(page, options.summary)).toHaveCount(0, {
    timeout: 20_000,
  });
  const serviceCaseLink = page.getByRole('link', {
    name: options.summary,
    exact: true,
  });
  await expect(serviceCaseLink).toBeVisible({ timeout: 20_000 });
  await serviceCaseLink.click();
  await page.waitForURL(/\/service\/faelle\/SRV-\d{4}-\d{3}/, {
    timeout: 20_000,
  });
  const serviceCaseNumber = page.url().match(/\/service\/faelle\/(SRV-\d{4}-\d{3})/)?.[1];
  if (!serviceCaseNumber) throw new Error('createDirectServiceCase: service case number missing');
  await expect(visibleText(page, options.statement)).toBeVisible({
    timeout: 15_000,
  });
  return getServiceCaseByNumber(options.orgId, serviceCaseNumber);
}

export async function convertRequestToServiceCase(page: Page, orgId: string): Promise<PersistedServiceCase> {
  await page.getByRole('button', { name: SERVICE_CASE_COPY.convert }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: SERVICE_CASE_COPY.convertDialog })).toBeVisible();
  await dialog.getByRole('button', { name: SERVICE_CASE_COPY.convertConfirm, exact: true }).click();
  await page.waitForURL(/\/service\/faelle\/SRV-\d{4}-\d{3}/, {
    timeout: 20_000,
  });
  const serviceCaseNumber = page.url().match(/\/service\/faelle\/(SRV-\d{4}-\d{3})/)?.[1];
  if (!serviceCaseNumber) throw new Error('convertRequestToServiceCase: service case number missing');
  return getServiceCaseByNumber(orgId, serviceCaseNumber);
}

export async function updateServiceCaseViaDialog(
  page: Page,
  options: {
    summary?: string;
    status?: ServiceCaseStatus;
    urgency?: ServiceCaseUrgency;
    chargeContext?: ServiceCaseChargeContext;
    jobNumber?: string;
    accessInstructions?: string;
    triageNote?: string;
    resolutionNote?: string;
    equipmentName?: string;
    reason: string;
    beforeSubmit?: () => void | Promise<void>;
  },
): Promise<void> {
  await serviceEditButton(page).click();
  const dialog = page.getByRole('dialog');
  if (options.summary !== undefined) {
    await dialog.locator('#service-summary').fill(options.summary);
  }
  if (options.status) {
    await selectRadixOption(
      page,
      dialog.locator('#service-status'),
      SERVICE_CASE_STATUS_LABELS[options.status],
    );
  }
  if (options.urgency) {
    await selectRadixOption(
      page,
      dialog.locator('#service-urgency'),
      SERVICE_CASE_URGENCY_LABELS[options.urgency],
    );
  }
  if (options.chargeContext) {
    await selectRadixOption(
      page,
      dialog.locator('#service-charge'),
      SERVICE_CASE_CHARGE_CONTEXT_LABELS[options.chargeContext],
    );
  }
  if (options.jobNumber) {
    await selectFromSearchable(page, serviceCaseJobPicker(dialog), options.jobNumber);
  }
  if (options.accessInstructions !== undefined) {
    await dialog.locator('#service-access').fill(options.accessInstructions);
  }
  if (options.triageNote !== undefined) {
    await dialog.locator('#service-triage').fill(options.triageNote);
  }
  if (options.resolutionNote !== undefined) {
    await dialog.locator('#service-resolution').fill(options.resolutionNote);
  }
  if (options.equipmentName) {
    const checkbox = dialog.getByRole('checkbox', {
      name: new RegExp(options.equipmentName),
    });
    if (!(await checkbox.isChecked())) await checkbox.click();
  }
  await dialog.locator('#service-reason').fill(options.reason);
  await options.beforeSubmit?.();
  await dialog.getByRole('button', { name: SHARED_COPY.action.save, exact: true }).click();
  await expect(dialog).toHaveCount(0, { timeout: 20_000 });
}

/** Relates the open case to another case through the relations section. */
export async function relateServiceCase(
  page: Page,
  options: { relatedCaseNumber: string; relation: ServiceCaseRelationType; reason: string },
): Promise<void> {
  const relations = page.getByRole('main').getByTestId('service-case-relations');
  await relations.getByRole('button', { name: SERVICE_COPY.link }).click();
  const dialog = page.getByRole('dialog');
  await selectFromSearchable(
    page,
    dialog.getByText(SERVICE_COPY.searchServiceCase, { exact: true }),
    options.relatedCaseNumber,
  );
  await dialog.locator('#relation-type').click();
  await page
    .getByRole('option', { name: SERVICE_CASE_RELATION_LABELS[options.relation], exact: true })
    .click();
  await dialog.locator('#relation-reason').fill(options.reason);
  await dialog.getByRole('button', { name: SERVICE_COPY.link }).click();
}

/** Links a submitted Arbeitsnachweis, found by its title, to the open case. */
export async function linkServiceCaseEvidence(page: Page, evidenceTitle: string): Promise<void> {
  await serviceCaseEvidenceSection(page).getByRole('button', { name: SERVICE_COPY.link }).click();
  const dialog = page.getByRole('dialog');
  await selectFromSearchable(
    page,
    dialog.getByText(SERVICE_CASE_COPY.searchEvidence, { exact: true }),
    evidenceTitle,
  );
  await dialog.getByRole('button', { name: SERVICE_COPY.link }).click();
}

/** Creates a follow-up on the open case and waits for its dialog to close. */
export async function createServiceCaseFollowUp(page: Page, note: string): Promise<void> {
  await page
    .getByRole('main')
    .getByTestId('service-case-follow-up')
    .getByRole('button', { name: SERVICE_CASE_COPY.createFollowUp })
    .click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('#service-follow-up-note').fill(note);
  await dialog.getByRole('button', { name: SHARED_COPY.action.save }).click();
  await expect(dialog).toHaveCount(0, { timeout: 20_000 });
}

// ---------------------------------------------------------------------------
// Maintenance coverage, plans and due work (P1-20)

/** The workspace heading of /service/wartung. */
export function maintenancePageHeading(page: Page): Locator {
  return page.getByRole('heading', { name: MAINTENANCE_COPY.heading, exact: true });
}

export function maintenanceTab(page: Page, tab: keyof typeof MAINTENANCE_TABS): Locator {
  return page.getByRole('tab', { name: MAINTENANCE_TABS[tab] });
}

/** The coverage renewal signal as a list row shows it. */
export function maintenanceRenewalSignal(page: Page, signal: MaintenanceRenewalSignal): Locator {
  return visibleText(page, MAINTENANCE_RENEWAL_SIGNAL_LABELS[signal]);
}

/** The coverage row that names this reference. */
export function maintenanceCoverageRow(page: Page, reference: string): Locator {
  return page.getByRole('main').getByTestId('maintenance-coverage-row').filter({ hasText: reference });
}

export function maintenanceCoverageAction(
  row: Locator,
  action: keyof typeof MAINTENANCE_COVERAGE_ROW_ACTIONS,
): Locator {
  return row.getByRole('button', { name: MAINTENANCE_COVERAGE_ROW_ACTIONS[action] });
}

/** The documents dialog of one coverage, named by its coverage number. */
export function maintenanceCoverageDocumentsDialog(page: Page, coverageNumber: string): Locator {
  return page.getByRole('dialog').filter({
    has: page.getByRole('heading', { name: `${MAINTENANCE_COPY.documentsDialogPrefix} ${coverageNumber}` }),
  });
}

/** The busy skeleton of the coverage documents frame while its read runs. */
export function maintenanceCoverageDocumentsLoading(dialog: Locator): Locator {
  return dialog
    .locator('[role="status"][aria-busy="true"]')
    .filter({ hasText: MAINTENANCE_COPY.documentsLoading });
}

/** Records the coverage follow-up from its row and waits for the dialog to close. */
export async function recordCoverageFollowUp(page: Page, reference: string): Promise<void> {
  await maintenanceCoverageAction(maintenanceCoverageRow(page, reference), 'followUp').click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: SHARED_COPY.action.save }).click();
  await expect(dialog).toHaveCount(0, { timeout: 20_000 });
}

/** The due row of one plan on one due date (as the list formats it). */
export function maintenanceDueRow(page: Page, planNumber: string, dueDateLabel: string): Locator {
  return page
    .getByRole('main')
    .getByTestId('maintenance-due-row')
    .filter({ hasText: planNumber })
    .filter({ hasText: dueDateLabel });
}

export function maintenanceDueRowAction(
  row: Locator,
  action: keyof typeof MAINTENANCE_DUE_ROW_ACTIONS,
): Locator {
  return row.getByRole('button', { name: MAINTENANCE_DUE_ROW_ACTIONS[action] });
}

/** The „Fälligkeit bearbeiten“ dialog that every due row action opens. */
export function maintenanceDueActionDialog(page: Page): Locator {
  return page.getByRole('dialog').filter({
    has: page.getByRole('heading', { name: MAINTENANCE_COPY.dueDialog }),
  });
}

/** Switches the open due-action dialog to another action. */
export async function chooseMaintenanceDueAction(
  page: Page,
  dialog: Locator,
  action: keyof typeof MAINTENANCE_DUE_ACTION_OPTIONS,
): Promise<void> {
  await dialog.getByRole('combobox', { name: MAINTENANCE_COPY.dueActionPicker }).click();
  await page.getByRole('option', { name: MAINTENANCE_DUE_ACTION_OPTIONS[action] }).click();
}

/** The service case picker trigger of the due-action dialog. */
export function maintenanceDueServiceCasePicker(dialog: Locator): Locator {
  return dialog.getByText(SERVICE_COPY.searchServiceCase, { exact: true });
}

export function maintenanceDueReason(dialog: Locator): Locator {
  return dialog.getByLabel(MAINTENANCE_COPY.dueReason);
}

export function maintenanceDueSubmit(dialog: Locator): Locator {
  return dialog.getByRole('button', { name: MAINTENANCE_COPY.runDueAction });
}

/** The evidence checkbox of the completion; its name is „<title> · Revision <n>“. */
export function maintenanceDueEvidence(dialog: Locator, evidenceTitle: string): Locator {
  return dialog.getByRole('checkbox', { name: evidenceTitle });
}

export async function createMaintenanceCoverageViaDialog(
  page: Page,
  options: {
    clientName: string;
    siteName: string;
    reference: string;
    validFrom: string;
    validUntil: string;
    noticeDate: string;
    renewalDate: string;
    reviewDueDate: string;
    operationalNote?: string;
  },
): Promise<void> {
  await page.goto('/service/wartung');
  await page.getByRole('button', { name: MAINTENANCE_COPY.createCoverage }).click();
  const dialog = page.getByRole('dialog');
  await selectFromSearchable(page, dialog.locator('#coverage-client'), options.clientName);
  await selectFromSearchable(page, dialog.locator('#coverage-site'), options.siteName);
  await dialog.locator('#coverage-reference').fill(options.reference);
  await typeIntoDatePickerById(dialog, 'coverage-valid-from', options.validFrom);
  await typeIntoDatePickerById(dialog, 'coverage-valid-until', options.validUntil);
  await typeIntoDatePickerById(dialog, 'coverage-notice', options.noticeDate);
  await typeIntoDatePickerById(dialog, 'coverage-renewal', options.renewalDate);
  await typeIntoDatePickerById(dialog, 'coverage-review', options.reviewDueDate);
  if (options.operationalNote) {
    await dialog.locator('#coverage-note').fill(options.operationalNote);
  }
  await dialog.getByRole('button', { name: MAINTENANCE_COPY.saveCoverage }).click();
  await expect(dialog).toHaveCount(0, { timeout: 20_000 });
  await maintenanceTab(page, 'coverages').click();
  await expect(visibleText(page, options.reference)).toBeVisible({
    timeout: 20_000,
  });
}

type MaintenancePlanFormInput = {
  clientName: string;
  siteName: string;
  coverageReference?: string;
  templateName: string;
  equipmentName: string;
  effectiveFrom: string;
  firstDue: string;
  intervalMonths?: string;
  instructions?: string;
  overlapReason?: string;
};

/** Opens the empty „Wartungsplan anlegen“ dialog from the workspace. */
export async function openMaintenancePlanDialog(page: Page): Promise<Locator> {
  await page.goto('/service/wartung');
  await page.getByRole('button', { name: MAINTENANCE_COPY.createPlan }).click();
  return page.getByRole('dialog');
}

/** Fills the plan form; the equipment is chosen in the „Anlagen im Wartungsumfang“ group. */
export async function fillMaintenancePlanForm(
  page: Page,
  dialog: Locator,
  options: MaintenancePlanFormInput,
): Promise<void> {
  await selectFromSearchable(page, dialog.locator('#maintenance-client'), options.clientName);
  await selectFromSearchable(page, dialog.locator('#maintenance-site'), options.siteName);
  if (options.coverageReference) {
    await selectFromSearchable(page, dialog.locator('#maintenance-coverage'), options.coverageReference);
  }
  await selectFromSearchable(page, dialog.locator('#maintenance-template'), options.templateName);
  await typeIntoDatePickerById(dialog, 'maintenance-effective', options.effectiveFrom);
  await typeIntoDatePickerById(dialog, 'maintenance-first-due', options.firstDue);
  if (options.intervalMonths) {
    await dialog.locator('#maintenance-interval').fill(options.intervalMonths);
  }
  await dialog
    .getByRole('group', { name: MAINTENANCE_COPY.planEquipment })
    .getByRole('checkbox', { name: options.equipmentName })
    .click();
  if (options.instructions) {
    await dialog.locator('#maintenance-instructions').fill(options.instructions);
  }
  if (options.overlapReason) {
    await maintenancePlanOverlapReason(dialog).fill(options.overlapReason);
  }
}

export function maintenancePlanOverlapReason(dialog: Locator): Locator {
  return dialog.locator('#maintenance-overlap');
}

export function maintenancePlanSubmit(dialog: Locator): Locator {
  return dialog.getByRole('button', { name: MAINTENANCE_COPY.createPlan });
}

export async function createMaintenancePlanViaDialog(
  page: Page,
  options: MaintenancePlanFormInput,
): Promise<void> {
  const dialog = await openMaintenancePlanDialog(page);
  await fillMaintenancePlanForm(page, dialog, options);
  await maintenancePlanSubmit(dialog).click();
  await expect(dialog).toHaveCount(0, { timeout: 20_000 });
  await maintenanceTab(page, 'plans').click();
  await expect(
    page
      .getByRole('main')
      .getByTestId('maintenance-plan-card')
      .filter({ hasText: options.clientName })
      .filter({ hasText: options.equipmentName }),
  ).toBeVisible({ timeout: 20_000 });
}

/** The workspace searched for one record, so the record is on the first page of its list. */
export function maintenanceSearchUrl(search: string): string {
  return `/service/wartung?q=${encodeURIComponent(search)}`;
}

/** Opens a status action of one plan card and returns its dialog. */
export async function openMaintenancePlanAction(
  page: Page,
  planNumber: string,
  action: MaintenancePlanAction,
): Promise<Locator> {
  await page.goto(maintenanceSearchUrl(planNumber));
  await maintenanceTab(page, 'plans').click();
  const card = page
    .getByRole('main')
    .getByTestId('maintenance-plan-card')
    .filter({ has: page.getByRole('heading', { name: planNumber }) });
  await card.getByRole('button', { name: MAINTENANCE_PLAN_ACTIONS[action].open, exact: true }).click();
  return page.getByRole('dialog');
}

export function maintenancePlanActionReason(dialog: Locator): Locator {
  return dialog.locator('#maintenance-action-reason');
}

export function maintenancePlanActionSubmit(dialog: Locator, action: MaintenancePlanAction): Locator {
  return dialog.getByRole('button', { name: MAINTENANCE_PLAN_ACTIONS[action].submit });
}

// ---------------------------------------------------------------------------
// The service area's shared header and its create dialogs, as the phone layout
// audit measures them.

/** The service area's header: title, subpage navigation and the equipment subpage heading. */
export const SERVICE_AREA_HEADER = {
  title: 'Service',
  navigation: 'Servicebereiche',
  subpageHeading: 'Anlagen & Geräte',
} as const;

/** A create dialog of the service area, its first input and its submit. */
type ServiceDialogForm = {
  open: string;
  title: string;
  input: string;
  save: string;
  /** Collapsed sections the audit opens so the dialog body must scroll. */
  collapsedSections: readonly string[];
};

const SERVICE_DIALOG_FORMS: Record<string, readonly ServiceDialogForm[]> = {
  '/service/faelle': [
    {
      open: SERVICE_CASE_COPY.create,
      title: SERVICE_CASE_COPY.create,
      input: '#service-summary',
      save: SHARED_COPY.action.save,
      collapsedSections: [],
    },
  ],
  '/service/anlagen': [
    {
      open: EQUIPMENT_COPY.create,
      title: EQUIPMENT_COPY.create,
      input: '#equipment-name',
      save: SHARED_COPY.action.save,
      collapsedSections: [EQUIPMENT_COPY.technicalSection, EQUIPMENT_COPY.lifecycleSection],
    },
  ],
  '/service/wartung': [
    {
      open: MAINTENANCE_COPY.createCoverage,
      title: 'Operative Abdeckung erfassen',
      input: '#coverage-reference',
      save: MAINTENANCE_COPY.saveCoverage,
      collapsedSections: [],
    },
    {
      open: MAINTENANCE_COPY.createPlan,
      title: MAINTENANCE_COPY.createPlan,
      input: '#maintenance-interval',
      save: MAINTENANCE_COPY.createPlan,
      collapsedSections: [],
    },
  ],
};

const SERVICE_FORM_COPY = {
  customer: 'Kunde',
  customerRequired: 'Bitte wähle einen Kunden.',
} as const;

/** The service create dialogs a route offers; none outside the service lists. */
export function serviceDialogForms(route: string): readonly ServiceDialogForm[] {
  return SERVICE_DIALOG_FORMS[route] ?? [];
}

/** The „Servicefall erfassen“ trigger of the service case list. */
export function serviceCaseCaptureButton(scope: Page | Locator): Locator {
  return scope.getByRole('button', { name: SERVICE_CASE_COPY.create, exact: true });
}

export function serviceFormTrigger(page: Page, form: ServiceDialogForm): Locator {
  return page.getByRole('button', { name: form.open, exact: true });
}

export function serviceFormDialog(page: Page, form: ServiceDialogForm): Locator {
  return page.getByRole('dialog', { name: form.title, exact: true });
}

export function serviceFormHeading(dialog: Locator, form: ServiceDialogForm): Locator {
  return dialog.getByRole('heading', { name: form.title, exact: true });
}

export function serviceFormSave(dialog: Locator, form: ServiceDialogForm): Locator {
  return dialog.getByRole('button', { name: form.save, exact: true });
}

/** The required-customer error a service dialog shows after an empty submit. */
export function serviceFormCustomerRequired(dialog: Locator): Locator {
  return dialog.getByText(SERVICE_FORM_COPY.customerRequired, { exact: true });
}

export function serviceFormCustomerPicker(dialog: Locator): Locator {
  return dialog.getByRole('combobox', { name: SERVICE_FORM_COPY.customer, exact: true });
}

/** Opens the dialog's collapsed sections, in order. */
export async function expandServiceFormSections(dialog: Locator, form: ServiceDialogForm): Promise<void> {
  for (const section of form.collapsedSections)
    await dialog.getByRole('button', { name: section, exact: true }).click();
}
