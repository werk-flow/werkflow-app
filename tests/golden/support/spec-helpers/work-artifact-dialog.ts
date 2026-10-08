import { expect, type Locator, type Page } from '@playwright/test';

import {
  AUTHORIZATION_STATE_LABELS,
  DEFECT_SEVERITY_LABELS,
} from '../../../../components/auftraege/artifacts/work-artifact-content';
import {
  WORK_ARTIFACT_KIND_LABELS,
  WORK_ARTIFACT_STATUS_LABELS,
  WORK_ARTIFACT_UNIT_LABELS,
  type WorkArtifactKind,
  type WorkArtifactMeasurementUnit,
  type WorkArtifactStatus,
} from '../../../../lib/work-artifacts/types';
import { pressKey } from '../steps/interaction';
import { confirmed, escapeRegExp, SHARED_COPY, typeIntoDateTimeField } from '../steps/shared';

/**
 * The Arbeitsnachweis section and dialog (P1-15), shared by the work, service
 * and maintenance specs. Kind, status, unit, severity and authorization names
 * come from the product label maps; the rest of the dialog copy lives here once.
 */
const ARTIFACT_COPY = {
  createHeading: 'Arbeitsnachweis erstellen',
  sectionLink: 'Arbeitsnachweise',
  picker: {
    kind: 'Art des Arbeitsnachweises',
    visibility: 'Sichtbarkeit des Arbeitsnachweises',
    unit: 'Aufmaßeinheit',
    severity: 'Schweregrad',
    authorization: 'Autorisierungsstand',
    instruction: 'Zugehörige Aufgabe oder Checkliste',
    document: 'Dokument auswählen',
    timeEntry: 'Zeiteintrag auswählen',
  },
  customerFacing: 'Für Kundendokumentation',
  action: {
    submitForReview: 'Zur Prüfung einreichen',
    saveDraft: 'Als Entwurf speichern',
    approveInternally: 'Intern freigeben',
    addMeasurementLine: 'Position ergänzen',
    recordRefusal: 'Ablehnung erfassen',
    newVersion: 'Neue Version',
    void: 'Ungültig setzen',
    requestCorrection: 'Korrektur anfordern',
    reject: 'Ablehnen',
    withdrawReview: 'Prüfung zurückziehen',
    recordAcknowledgement: 'Bestätigung erfassen',
    recordReservation: 'Vorbehalt erfassen',
    resetSignature: 'Zurücksetzen',
    saveSignature: 'Unterschrift speichern',
    export: 'Export',
    link: SHARED_COPY.action.link,
  },
  field: {
    title: SHARED_COPY.field.title,
    summary: SHARED_COPY.field.summary,
    performedWork: 'Ausgeführte Arbeiten',
    openWork: 'Offene Arbeiten',
    materialNotes: 'Materialhinweise',
    progress: 'Fortschritt',
    attendees: 'Anwesende Personen',
    weather: 'Wetter',
    siteConditions: 'Bedingungen vor Ort',
    deliveries: 'Lieferungen',
    obstructions: 'Behinderungen',
    decisions: 'Entscheidungen',
    specialEvents: 'Besondere Ereignisse',
    measurementLocation: 'Aufmaßort',
    measurementNotes: 'Aufmaßhinweise',
    lineName: SHARED_COPY.field.name,
    location: 'Ort',
    defectDescription: 'Mangelbeschreibung',
    responsibility: 'Zuständigkeit',
    proposedSolution: 'Vorgeschlagene Lösung',
    changeWork: 'Änderungs-/Regiearbeit',
    reason: SHARED_COPY.field.reason,
    requestedBy: 'Angefordert durch',
    expectedMinutes: 'Erwartete Arbeitsminuten',
    actualMinutes: 'Tatsächliche Arbeitsminuten',
    expectedMaterial: 'Erwartetes Material',
    actualMaterial: 'Tatsächliches Material',
    scheduleImpact: 'Terminauswirkung',
    revisionReason: 'Grund der neuen Version',
    customerStatement: 'Kundenaussage',
    signaturePad: 'Unterschrift zeichnen',
  },
  option: {
    customerDecisionRequired: 'Kundenentscheidung erforderlich',
    signatureRequired: 'Unterschrift erforderlich',
  },
  customerDecisionPanel: 'Kundenentscheidung und Unterschrift',
  linkDisclosure: { document: 'Dokument verknüpfen', timeEntry: 'Zeiteintrag verknüpfen' },
  fulfilEvidence: 'Nachweiserwartung erfüllen',
  message: {
    empty: 'Noch keine Arbeitsnachweise erfasst.',
    requiredFields: 'Bitte fülle die Pflichtangaben',
    changedMeanwhile: 'Der Arbeitsnachweis wurde zwischenzeitlich geändert. Deine Eingaben bleiben erhalten.',
    legalNotice: 'keine besondere Rechtswirksamkeit',
  },
} as const;

/** Fields whose label is unique only as an exact match. */
const EXACT_FIELDS = new Set<WorkArtifactField>(['location', 'reason']);
const EXACT_ACTIONS = new Set<WorkArtifactAction>(['submitForReview', 'saveDraft', 'export', 'link']);

type WorkArtifactPicker = keyof typeof ARTIFACT_COPY.picker;
type WorkArtifactAction = keyof typeof ARTIFACT_COPY.action;
type WorkArtifactField = keyof typeof ARTIFACT_COPY.field;
type WorkArtifactOption = keyof typeof ARTIFACT_COPY.option;
type WorkArtifactMessage = keyof typeof ARTIFACT_COPY.message;
type DefectSeverity = keyof typeof DEFECT_SEVERITY_LABELS;
type AuthorizationState = keyof typeof AUTHORIZATION_STATE_LABELS;

/** The section's empty-state sentence, for toContainText. */
export const WORK_ARTIFACTS_EMPTY = ARTIFACT_COPY.message.empty;

export function workArtifactsSection(page: Page): Locator {
  // PPR can stage duplicate sections in hidden streaming containers outside
  // main. Positive interactions belong to the active semantic page content.
  return page.getByRole('main').getByTestId('work-artifacts-section');
}

/** A navigation link named „Arbeitsnachweise“; the work page offers none. */
export function workArtifactsLink(page: Page): Locator {
  return page.getByRole('link', { name: ARTIFACT_COPY.sectionLink });
}

/** The section's button that opens an empty Arbeitsnachweis dialog. */
export function newWorkArtifactButton(page: Page, options: { exact?: boolean } = {}): Locator {
  return workArtifactsSection(page).getByRole('button', {
    name: SHARED_COPY.action.new,
    ...(options.exact ? { exact: true } : {}),
  });
}

/** The open Arbeitsnachweis dialog. */
export function workArtifactDialog(page: Page): Locator {
  return page.getByRole('dialog');
}

/** The section entry that opens an existing Arbeitsnachweis; its name starts with the title. */
export function workArtifactEntry(page: Page, title: string): Locator {
  return confirmed(
    workArtifactsSection(page).getByRole('button', {
      name: new RegExp(`^${escapeRegExp(title)}`),
    }),
  );
}

/**
 * Opens an existing Arbeitsnachweis by its title. A Realtime refresh can
 * replace the row between locator resolution and the click and silently eat
 * the open (testing.md re-render class), so the click repeats, boundedly, only
 * while no dialog opened at all.
 */
export async function openWorkArtifact(
  page: Page,
  title: string,
  options: { attempts: number; timeout: number; clickTimeout?: number },
): Promise<Locator> {
  const dialog = workArtifactDialog(page);
  const clickOptions = options.clickTimeout !== undefined ? { timeout: options.clickTimeout } : {};
  for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
    await workArtifactEntry(page, title).click(clickOptions);
    const opened = await dialog
      .waitFor({ state: 'visible', timeout: options.timeout })
      .then(() => true)
      .catch(() => false);
    if (opened) return dialog;
  }
  throw new Error(`Artifact dialog for ${title} did not open after ${options.attempts} clicks.`);
}

/**
 * A dialog action. Submitting, saving, exporting and linking match exactly;
 * the others match by name, so that an absence check also catches a longer label.
 */
export function workArtifactAction(scope: Page | Locator, action: WorkArtifactAction): Locator {
  return scope.getByRole('button', {
    name: ARTIFACT_COPY.action[action],
    ...(EXACT_ACTIONS.has(action) ? { exact: true } : {}),
  });
}

/** The button that fulfils the open evidence expectation with this version. */
export function workArtifactFulfilWithVersion(dialog: Locator, version: number): Locator {
  return dialog.getByRole('button', { name: new RegExp(`Mit Version ${version} erfüllen`) });
}

export function workArtifactField(dialog: Locator, field: WorkArtifactField): Locator {
  return dialog.getByLabel(ARTIFACT_COPY.field[field], EXACT_FIELDS.has(field) ? { exact: true } : {});
}

export function workArtifactPicker(dialog: Locator, picker: WorkArtifactPicker): Locator {
  return dialog.getByRole('combobox', { name: ARTIFACT_COPY.picker[picker] });
}

/** A checkbox option of the work report, toggled through its visible label. */
export function workArtifactOption(dialog: Locator, option: WorkArtifactOption): Locator {
  return dialog.getByText(ARTIFACT_COPY.option[option]);
}

/** The disclosure that holds the customer decision and signature actions. */
export function workArtifactCustomerDecisionPanel(dialog: Locator): Locator {
  return dialog.getByText(ARTIFACT_COPY.customerDecisionPanel);
}

/** The disclosure that offers fulfilling a checklist evidence expectation. */
export function workArtifactFulfilEvidenceToggle(dialog: Locator): Locator {
  return dialog.getByText(ARTIFACT_COPY.fulfilEvidence);
}

/**
 * Opens a link disclosure of the dialog and returns it: the toggle's wrapper,
 * which holds the picker and its own „Verknüpfen“ button.
 */
export async function openWorkArtifactLinkDisclosure(
  dialog: Locator,
  link: keyof typeof ARTIFACT_COPY.linkDisclosure,
): Promise<Locator> {
  const name = ARTIFACT_COPY.linkDisclosure[link];
  // FormDisclosure renders no container role; its toggle's parent is the disclosure.
  const disclosure = dialog.getByRole('button', { name }).locator('..');
  await disclosure.getByRole('button', { name }).click();
  return disclosure;
}

/** A sentence the dialog or the section shows, matched as a substring. */
export function workArtifactMessage(scope: Locator, message: WorkArtifactMessage): Locator {
  return scope.getByText(ARTIFACT_COPY.message[message]);
}

/** Types the visit's start and end (HH:MM) on one date into the work report's two date-time fields. */
export async function fillWorkArtifactVisit(
  dialog: Locator,
  visit: { date: string; from: string; to: string },
): Promise<void> {
  await typeIntoDateTimeField(dialog, 'artifact-visit-start', `${visit.date}T${visit.from}`);
  await typeIntoDateTimeField(dialog, 'artifact-visit-end', `${visit.date}T${visit.to}`);
}

/** Any text that names this version, as the saved dialog shows it. */
export function workArtifactVersion(dialog: Locator, version: number): Locator {
  return dialog.getByText(new RegExp(`Version ${version}`));
}

/** Text that names this status together with this version, as „Ungültig · Version 1“. */
export function workArtifactStatusVersion(
  dialog: Locator,
  status: WorkArtifactStatus,
  version: number,
): Locator {
  return dialog.getByText(
    new RegExp(escapeRegExp(`${WORK_ARTIFACT_STATUS_LABELS[status]} · Version ${version}`)),
  );
}

/** The dialog description of a saved Arbeitsnachweis: kind, status and version. */
export function workArtifactDescription(
  dialog: Locator,
  kind: WorkArtifactKind,
  status: WorkArtifactStatus,
  version: number,
): Locator {
  const description = `${WORK_ARTIFACT_KIND_LABELS[kind]} · ${WORK_ARTIFACT_STATUS_LABELS[status]} · Version ${version}`;
  return dialog.getByText(new RegExp(escapeRegExp(description)));
}

/** Text that contains this status label, such as the approval notice. */
export function workArtifactStatusText(dialog: Locator, status: WorkArtifactStatus): Locator {
  return dialog.getByText(WORK_ARTIFACT_STATUS_LABELS[status], { exact: false });
}

/** The status label, for toContainText on a section entry. */
export function workArtifactStatusLabel(status: WorkArtifactStatus): string {
  return WORK_ARTIFACT_STATUS_LABELS[status];
}

/** Opens a picker and chooses one option by its exact name. */
async function selectWorkArtifactOption(page: Page, trigger: Locator, name: string): Promise<void> {
  await trigger.click();
  const option = page.getByRole('option', { name, exact: true });
  await expect(option).toBeVisible({ timeout: 15_000 });
  await option.click();
}

async function selectWorkArtifactKind(page: Page, dialog: Locator, kind: WorkArtifactKind): Promise<void> {
  await selectWorkArtifactOption(page, workArtifactPicker(dialog, 'kind'), WORK_ARTIFACT_KIND_LABELS[kind]);
}

export async function selectWorkArtifactUnit(
  page: Page,
  dialog: Locator,
  unit: WorkArtifactMeasurementUnit,
): Promise<void> {
  await selectWorkArtifactOption(page, workArtifactPicker(dialog, 'unit'), WORK_ARTIFACT_UNIT_LABELS[unit]);
}

export async function selectWorkArtifactSeverity(
  page: Page,
  dialog: Locator,
  severity: DefectSeverity,
): Promise<void> {
  await selectWorkArtifactOption(
    page,
    workArtifactPicker(dialog, 'severity'),
    DEFECT_SEVERITY_LABELS[severity],
  );
}

export async function selectWorkArtifactAuthorization(
  page: Page,
  dialog: Locator,
  state: AuthorizationState,
): Promise<void> {
  await selectWorkArtifactOption(
    page,
    workArtifactPicker(dialog, 'authorization'),
    AUTHORIZATION_STATE_LABELS[state],
  );
}

export async function makeWorkArtifactCustomerFacing(page: Page, dialog: Locator): Promise<void> {
  await selectWorkArtifactOption(
    page,
    workArtifactPicker(dialog, 'visibility'),
    ARTIFACT_COPY.customerFacing,
  );
}

/**
 * Opens a new Arbeitsnachweis from the section, picks its kind and fills the
 * title and summary. Returns the dialog for the kind-specific fields. With
 * `strict`, the section's „Neu“ button matches exactly and the dialog must
 * show its create heading before the kind is picked.
 */
export async function beginWorkArtifact(
  page: Page,
  input: {
    kind: WorkArtifactKind;
    title: string;
    summary: string;
    customerFacing?: boolean;
    strict?: boolean;
  },
): Promise<Locator> {
  await newWorkArtifactButton(page, input.strict ? { exact: true } : {}).click();
  const dialog = workArtifactDialog(page);
  if (input.strict) {
    await expect(dialog.getByRole('heading', { name: ARTIFACT_COPY.createHeading })).toBeVisible();
  }
  await selectWorkArtifactKind(page, dialog, input.kind);
  if (input.customerFacing) await makeWorkArtifactCustomerFacing(page, dialog);
  await workArtifactField(dialog, 'title').fill(input.title);
  await workArtifactField(dialog, 'summary').fill(input.summary);
  return dialog;
}

/** Submits for review with Enter in the exactly named title field, the form's keyboard path. */
export async function submitWorkArtifactWithEnter(dialog: Locator): Promise<void> {
  await pressKey(dialog, 'Enter', { into: dialog.getByLabel(ARTIFACT_COPY.field.title, { exact: true }) });
}

/** Submits a new Arbeitsnachweis for review, waits for its first version and closes the dialog. */
export async function submitWorkArtifactAndClose(dialog: Locator): Promise<void> {
  await workArtifactAction(dialog, 'submitForReview').click();
  await expect(workArtifactVersion(dialog, 1)).toBeVisible({ timeout: 20_000 });
  await closeWorkArtifactDialog(dialog);
}

/** Opens a submitted Arbeitsnachweis by its title, approves it internally and closes the dialog. */
export async function approveWorkArtifact(page: Page, title: string): Promise<void> {
  const dialog = await openWorkArtifact(page, title, { attempts: 3, timeout: 10_000, clickTimeout: 10_000 });
  await workArtifactAction(dialog, 'approveInternally').click();
  await expect(workArtifactStatusText(dialog, 'approved')).toBeVisible({
    timeout: 20_000,
  });
  await closeWorkArtifactDialog(dialog);
}

export async function closeWorkArtifactDialog(dialog: Locator): Promise<void> {
  // WorkArtifactDialog renders its visible footer action before Radix's icon
  // close, and both controls have the accessible name "Schließen".
  await dialog.getByRole('button', { name: SHARED_COPY.action.close, exact: true }).first().click();
}

export async function readPopupBodyText(page: Page): Promise<string> {
  // The generated handover preview has no semantic content container. Its
  // complete body text is the product output this privacy assertion audits.
  return page.locator('body').innerText();
}
