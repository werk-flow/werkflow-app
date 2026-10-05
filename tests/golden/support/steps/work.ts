import { expect, type Locator, type Page } from '@playwright/test';
import { workLifecycleErrorMessage } from '../../../../components/auftraege/lifecycle/work-lifecycle-messages';
import {
  WORK_HANDOVER_STATE_LABELS,
  type WorkHandoverPackageState,
} from '../../../../lib/work-handover/types';
import {
  getWorkNextAction,
  WORK_BLOCKER_REASON_LABELS,
  WORK_DECLARED_KIND_LABELS,
  WORK_DEPENDENCY_EFFECT_LABELS,
  WORK_EXECUTION_LABELS,
  workTransitionActionLabel,
  type WorkBlocker,
  type WorkBlockerReason,
  type WorkDeclaredDependencyKind,
  type WorkDependencyEffect,
  type WorkExecutionState,
} from '../../../../lib/work-lifecycle/types';
import { pressKey } from './interaction';
import {
  assignDespiteQualificationWarning,
  customerPicker,
  customerPickerSearch,
  detailsRegion,
  employeeAssignmentPicker,
  employeeAssignmentSearch,
  escapeRegExp,
  metadataField,
  pendingRow,
  selectFromSearchable,
  SHARED_COPY,
  toggleInSearchableMulti,
  typeIntoDatePicker,
  typeIntoDatePickerById,
  visibleMatchingText,
  visibleText,
} from './shared';

/**
 * Copy of the work lifecycle card, its dialogs, the handover section and the
 * field work pack that no pure product module owns. State names, transition
 * buttons, blocker reasons, dependency vocabulary and refusal sentences come
 * from their product owners instead.
 */
const LIFECYCLE_COPY = {
  savingStatus: 'Arbeitsstand wird gespeichert',
  savedBanner: 'Arbeitsstand wurde aktualisiert.',
  header: 'Arbeitsstand',
  readiness: 'Einsatzbereitschaft',
  nextStepPrefix: 'Nächster Schritt: ',
  remoteUpdateHint: 'Während der Eingabe hat sich der Arbeitsstand geändert.',
  noMaterialDemand: 'Kein Materialbedarf geplant.',
  resolvedBlockers: 'Gelöste Blocker',
  linkedWork: 'Verknüpfte Arbeit',
  declaredDependency: 'Deklarierte Voraussetzung',
  managerException: 'Manager-Ausnahme verwenden',
} as const;

/** The card's buttons other than the state transitions. */
const LIFECYCLE_CARD_ACTIONS = {
  park: 'Parken',
  continuePlanning: 'Weiterplanen',
  addBlocker: 'Blocker hinzufügen',
  resolveBlocker: 'Lösen',
  reopenBlocker: 'Wieder öffnen',
  addDependency: 'Voraussetzung hinzufügen',
  deriveAutomatically: 'Automatisch ableiten',
  gatesAndHistory: 'Abschlussprüfungen und Verlauf',
} as const;

/** The submit button of the reason dialog that each card action opens. */
const REASON_DIALOG_SUBMIT = {
  resolveBlocker: 'Lösen',
  reopenBlocker: 'Wieder öffnen',
  continuePlanning: 'Weiterführen',
  deriveAutomatically: 'Automatisch ableiten',
} as const;

const LIFECYCLE_BADGES = {
  planned: 'Geplant',
  unplanned: 'Nicht geplant',
  parked: 'Geparkt',
  derived: 'Automatisch abgeleitet',
} as const;

const READINESS_STATES = {
  ok: 'Erfüllt',
  warning: 'Prüfen',
  unknown: 'Nicht bewertet',
} as const;

const DEPENDENCY_ROW_ACTIONS = {
  fulfil: 'Erfüllt',
  reopen: 'Wieder öffnen',
  remove: 'Voraussetzung entfernen',
} as const;

const DEPENDENCY_STATES = { satisfied: 'erfüllt', open: 'offen' } as const;

const INSTRUCTION_ACTIONS = {
  done: 'Punkt als erledigt markieren',
  open: 'Punkt als offen markieren',
} as const;

/** The card's buttons other than the state transitions, by purpose. */
type LifecycleCardAction = keyof typeof LIFECYCLE_CARD_ACTIONS;
type LifecycleReasonAction = keyof typeof REASON_DIALOG_SUBMIT;
type LifecycleBadge = keyof typeof LIFECYCLE_BADGES;
export type ReadinessState = keyof typeof READINESS_STATES;
/** The refusal codes whose sentence a spec asserts. */
type LifecycleRefusal = Parameters<typeof workLifecycleErrorMessage>[0];

/** States from which a button moves the work into execution. */
const INTO_EXECUTION_ORIGINS = ['not_started', 'interrupted', 'execution_complete'] as const;

export function workHandoverSection(page: Page): Locator {
  return page.getByRole('main').getByTestId('work-handover-section');
}

export function workLifecycleCard(page: Page): Locator {
  return page.getByRole('main').getByTestId('work-lifecycle-card');
}

// ---------------------------------------------------------------------------
// Work lifecycle: the one owner of the transition buttons, the state badge
// and the transition dialog (P1-14).

/** The button that moves the work from one state to the next, named by the product's own label. */
export function lifecycleAction(page: Page, from: WorkExecutionState, to: WorkExecutionState): Locator {
  return workLifecycleCard(page).getByRole('button', {
    name: workTransitionActionLabel(from, to),
    exact: true,
  });
}

/** The button that moves the work into execution, whichever state it comes from. */
export function lifecycleIntoExecutionAction(page: Page): Locator {
  const names = INTO_EXECUTION_ORIGINS.map((from) =>
    escapeRegExp(workTransitionActionLabel(from, 'in_progress')),
  );
  return workLifecycleCard(page).getByRole('button', { name: new RegExp(`^(?:${names.join('|')})$`) });
}

/** The card header: state badge, planning badges and the next step. */
function lifecycleHeader(page: Page): Locator {
  return workLifecycleCard(page).getByRole('region', { name: LIFECYCLE_COPY.header, exact: true });
}

/** The execution state as the card header names it. */
export function lifecycleState(page: Page, state: WorkExecutionState): Locator {
  return lifecycleHeader(page).getByText(WORK_EXECUTION_LABELS[state], { exact: true });
}

export function lifecycleBadge(page: Page, badge: LifecycleBadge): Locator {
  return lifecycleHeader(page).getByText(LIFECYCLE_BADGES[badge], { exact: true });
}

/**
 * The next step the header names for this state, or for an open blocker or
 * parking, which the product puts first.
 */
export function lifecycleNextStep(
  page: Page,
  state: WorkExecutionState,
  openBlocker?: WorkBlocker['kind'],
): Locator {
  const blockers = openBlocker ? [{ kind: openBlocker, state: 'open' } as WorkBlocker] : [];
  const nextAction = getWorkNextAction({ executionState: state, blockers, dependencies: [] });
  return lifecycleHeader(page).getByText(`${LIFECYCLE_COPY.nextStepPrefix}${nextAction}`, { exact: true });
}

/** The card's other buttons (park, blockers, dependencies, project derivation). */
export function lifecycleCardAction(page: Page, action: LifecycleCardAction): Locator {
  return workLifecycleCard(page).getByRole('button', { name: LIFECYCLE_CARD_ACTIONS[action], exact: true });
}

/**
 * The button's name, for absence checks that must not narrow it to an exact
 * match or to the card inside main.
 */
export function lifecycleCardActionName(action: LifecycleCardAction): string {
  return LIFECYCLE_CARD_ACTIONS[action];
}

/** The readiness section's title text inside the card. */
export function lifecycleReadinessTitle(page: Page): Locator {
  return workLifecycleCard(page).getByText(LIFECYCLE_COPY.readiness);
}

/** A state filter of the Aufträge list with its count, as „Unterbrochen 1“. */
export function workListStateFilter(page: Page, state: WorkExecutionState, count: number): Locator {
  return page.getByRole('button', {
    name: new RegExp(`^${escapeRegExp(WORK_EXECUTION_LABELS[state])}\\s+${count}$`),
  });
}

/** The hint that the state changed while a card dialog was open. */
export function lifecycleRemoteUpdateHint(page: Page): Locator {
  return visibleText(page, LIFECYCLE_COPY.remoteUpdateHint);
}

/** The banner that confirms a saved state change. */
export function lifecycleSavedBanner(page: Page): Locator {
  return page.getByRole('alert').filter({ hasText: LIFECYCLE_COPY.savedBanner });
}

/** A banner that names this lifecycle refusal. */
export function lifecycleRefusalBanner(page: Page, refusal: LifecycleRefusal): Locator {
  return page.getByRole('alert').filter({ hasText: workLifecycleErrorMessage(refusal) });
}

/** The refusal sentence inside a lifecycle dialog that stays open. */
export function lifecycleDialogRefusal(dialog: Locator, refusal: LifecycleRefusal): Locator {
  return dialog.getByText(workLifecycleErrorMessage(refusal));
}

/** Every dialog the lifecycle card opens: transitions, blockers, dependencies and reasons. */
export function workLifecycleDialog(page: Page): Locator {
  return page.getByRole('dialog');
}

/** The transition dialog's save button. */
export function workTransitionSave(dialog: Locator): Locator {
  return dialog.getByRole('button', { name: SHARED_COPY.action.saveChange });
}

/** The dialog's cancel button. */
export function workLifecycleDialogCancel(dialog: Locator): Locator {
  return dialog.getByRole('button', { name: SHARED_COPY.action.cancel });
}

/**
 * The status dialog closes with the click and the card shows the chosen state
 * at once. The write is over when the header spinner ends, and it was accepted
 * when the chosen state is no longer offered: a refusal restores the previous
 * state and its button.
 */
export async function expectWorkTransitionSaved(page: Page, label: string): Promise<void> {
  const lifecycle = workLifecycleCard(page);
  await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 20_000 });
  await expect(lifecycle.getByRole('status', { name: LIFECYCLE_COPY.savingStatus })).toHaveCount(0, {
    timeout: 20_000,
  });
  await expect(lifecycle.getByRole('button', { name: label, exact: true })).toHaveCount(0, {
    timeout: 20_000,
  });
}

/**
 * Changes the work state through the card: clicks the step's button, gives the
 * reason when one is passed and saves. With `outcome: 'saved'` (the default)
 * it waits until the change is saved; with `'submitted'` it returns after the
 * click, for a refusal the caller asserts.
 */
export async function transitionWork(
  page: Page,
  from: WorkExecutionState,
  to: WorkExecutionState,
  options: { reason?: string; outcome?: 'saved' | 'submitted' } = {},
): Promise<void> {
  await lifecycleAction(page, from, to).click();
  const dialog = workLifecycleDialog(page);
  if (options.reason) await dialog.locator('#work-transition-reason').fill(options.reason);
  await workTransitionSave(dialog).click();
  if (options.outcome !== 'submitted')
    await expectWorkTransitionSaved(page, workTransitionActionLabel(from, to));
}

/**
 * Moves the work into execution through whichever into-execution button the
 * card offers (start, resume after an interruption, reopen finished work).
 */
export async function moveWorkIntoExecution(page: Page, reason?: string): Promise<void> {
  const button = lifecycleIntoExecutionAction(page);
  const label = (await button.textContent())?.trim();
  const from = INTO_EXECUTION_ORIGINS.find(
    (origin) => workTransitionActionLabel(origin, 'in_progress') === label,
  );
  if (!from) throw new Error(`No into-execution step is named "${label ?? ''}".`);
  await transitionWork(page, from, 'in_progress', reason ? { reason } : {});
}

/**
 * Completes the execution as a manager. `managerException: 'use'` ticks the
 * exception when the dialog offers it and always gives the reason; `'unused'`
 * asserts that the exception stays unticked and gives the reason only when the
 * dialog asks for one. Waits until the completion is saved, not only until the
 * dialog closed: the card keeps saving after the dialog closes.
 */
export async function completeExecutionAsManager(
  page: Page,
  options: { reason: string; managerException: 'use' | 'unused' },
): Promise<void> {
  await lifecycleAction(page, 'in_progress', 'execution_complete').click();
  const dialog = workLifecycleDialog(page);
  const exception = dialog.getByRole('checkbox', { name: LIFECYCLE_COPY.managerException });
  const reason = dialog.locator('#work-transition-reason');
  if (options.managerException === 'use') {
    if (await exception.isVisible().catch(() => false)) await exception.check();
    await reason.fill(options.reason);
  } else {
    if (await exception.isVisible().catch(() => false)) await expect(exception).not.toBeChecked();
    if (await reason.isVisible().catch(() => false)) await reason.fill(options.reason);
  }
  await workTransitionSave(dialog).click();
  await expectWorkTransitionSaved(page, workTransitionActionLabel('in_progress', 'execution_complete'));
}

/** The readiness section of the card. */
export function lifecycleReadiness(page: Page): Locator {
  return workLifecycleCard(page).getByRole('region', { name: LIFECYCLE_COPY.readiness, exact: true });
}

/** Readiness state badges with this state inside the scope. */
export function readinessStateBadges(scope: Locator, state: ReadinessState): Locator {
  return scope.getByText(READINESS_STATES[state], { exact: true });
}

export function lifecycleNoMaterialDemand(page: Page): Locator {
  return workLifecycleCard(page).getByText(LIFECYCLE_COPY.noMaterialDemand, { exact: true });
}

/** Opens the disclosure that lists the resolved blockers. */
export async function openResolvedBlockers(page: Page): Promise<void> {
  await workLifecycleCard(page).getByText(LIFECYCLE_COPY.resolvedBlockers, { exact: true }).click();
}

/**
 * Opens a blocker dialog from the card, picks the reason and gives the details,
 * then saves. Returns the dialog so that the caller waits for it to close.
 */
export async function addWorkBlocker(
  page: Page,
  input: { reason: WorkBlockerReason; details: string },
): Promise<Locator> {
  await lifecycleCardAction(page, 'addBlocker').click();
  const dialog = workLifecycleDialog(page);
  await selectFromSearchable(
    page,
    dialog.locator('#work-blocker-reason'),
    WORK_BLOCKER_REASON_LABELS[input.reason],
  );
  await dialog.locator('#work-blocker-details').fill(input.details);
  await dialog.getByRole('button', { name: SHARED_COPY.action.save, exact: true }).click();
  return dialog;
}

/**
 * Parks the work from the card with reason, details, responsible person and
 * review date, then saves. Returns the dialog so that the caller waits for it
 * to close.
 */
export async function parkWork(
  page: Page,
  input: { reason: WorkBlockerReason; details: string; responsibleName: string; reviewDate: string },
): Promise<Locator> {
  await lifecycleCardAction(page, 'park').click();
  const dialog = workLifecycleDialog(page);
  await selectFromSearchable(
    page,
    dialog.locator('#work-blocker-reason'),
    WORK_BLOCKER_REASON_LABELS[input.reason],
  );
  await dialog.locator('#work-blocker-details').fill(input.details);
  await selectFromSearchable(page, dialog.locator('#work-blocker-owner'), input.responsibleName);
  await typeIntoDatePickerById(dialog, 'work-blocker-review', input.reviewDate);
  await dialog.getByRole('button', { name: SHARED_COPY.action.save, exact: true }).click();
  return dialog;
}

/**
 * Runs a card action that asks for a reason (resolve or reopen a blocker,
 * continue planning parked work, derive a project automatically) and submits
 * it. Returns the dialog so that the caller waits for it to close.
 */
export async function confirmLifecycleReason(
  page: Page,
  action: LifecycleReasonAction,
  reason: string,
): Promise<Locator> {
  await lifecycleCardAction(page, action).click();
  const dialog = workLifecycleDialog(page);
  await dialog.locator('#work-reason').fill(reason);
  await dialog.getByRole('button', { name: REASON_DIALOG_SUBMIT[action], exact: true }).click();
  return dialog;
}

/**
 * Opens the dependency dialog, picks the work it depends on and submits.
 * Returns the dialog: a refusal keeps it open with its sentence.
 */
export async function addWorkDependency(page: Page, target: string): Promise<Locator> {
  await lifecycleCardAction(page, 'addDependency').click();
  const dialog = workLifecycleDialog(page);
  await selectFromSearchable(page, dialog.locator('#dependency-target'), target);
  await dialog.getByRole('button', { name: SHARED_COPY.action.add, exact: true }).click();
  return dialog;
}

/**
 * Adds a declared prerequisite with its kind and description; without an
 * effect the dialog keeps its default. Returns the dialog.
 */
export async function addDeclaredWorkDependency(
  page: Page,
  input: { kind: WorkDeclaredDependencyKind; description: string; effect?: WorkDependencyEffect },
): Promise<Locator> {
  await lifecycleCardAction(page, 'addDependency').click();
  const dialog = workLifecycleDialog(page);
  await dialog.locator('#dependency-type').click();
  await page.getByRole('option', { name: LIFECYCLE_COPY.declaredDependency }).click();
  await selectFromSearchable(
    page,
    dialog.locator('#dependency-target'),
    WORK_DECLARED_KIND_LABELS[input.kind],
  );
  await dialog.locator('#dependency-description').fill(input.description);
  if (input.effect) {
    await dialog.locator('#dependency-effect').click();
    await page.getByRole('option', { name: WORK_DEPENDENCY_EFFECT_LABELS[input.effect] }).click();
  }
  await dialog.getByRole('button', { name: SHARED_COPY.action.add, exact: true }).click();
  return dialog;
}

/** A dependency row of the card, by its description; linked work has the generic name. */
export function workDependencyRow(page: Page, description?: string): Locator {
  return workLifecycleCard(page)
    .getByTestId('work-dependency-row')
    .filter({ hasText: description ?? LIFECYCLE_COPY.linkedWork });
}

/** The satisfaction text of a dependency row. */
export function workDependencyState(row: Locator, state: keyof typeof DEPENDENCY_STATES): Locator {
  return row.getByText(new RegExp(DEPENDENCY_STATES[state]));
}

/**
 * Runs a row action that asks for a reason (mark fulfilled, reopen, remove)
 * and submits it. Returns the dialog so that the caller waits for it to close.
 */
export async function changeWorkDependency(
  page: Page,
  row: Locator,
  action: keyof typeof DEPENDENCY_ROW_ACTIONS,
  reason: string,
): Promise<Locator> {
  const button = row.getByRole('button', { name: DEPENDENCY_ROW_ACTIONS[action] });
  if (action === 'fulfil') await button.click({ timeout: 15_000 });
  else await button.click();
  const dialog = workLifecycleDialog(page);
  await dialog.locator('#work-reason').fill(reason);
  const submit = action === 'remove' ? SHARED_COPY.action.remove : SHARED_COPY.action.save;
  await dialog.getByRole('button', { name: submit }).click();
  return dialog;
}

/** The satisfaction word of a dependency row, for toContainText. */
export function workDependencyStateLabel(state: keyof typeof DEPENDENCY_STATES): string {
  return DEPENDENCY_STATES[state];
}

const DEPENDENCY_APPROVAL_COPY = { open: 'Freigabe verknüpfen', submit: SHARED_COPY.action.link } as const;

/**
 * Links an internal Arbeitsnachweis approval to a declared approval
 * prerequisite and submits. Returns the dialog so that the caller waits for it
 * to close.
 */
export async function linkWorkDependencyApproval(
  page: Page,
  row: Locator,
  input: { artifactTitle: string; reason: string },
): Promise<Locator> {
  await row.getByRole('button', { name: DEPENDENCY_APPROVAL_COPY.open }).click();
  const dialog = workLifecycleDialog(page);
  await selectFromSearchable(page, dialog.locator('#dependency-artifact-approval'), input.artifactTitle);
  await dialog.locator('#dependency-artifact-reason').fill(input.reason);
  await dialog.getByRole('button', { name: DEPENDENCY_APPROVAL_COPY.submit, exact: true }).click();
  return dialog;
}

/** The gate line of the opened „Abschlussprüfungen und Verlauf“ that counts open formal approvals. */
export function lifecyclePendingFormalApprovals(page: Page): Locator {
  return workLifecycleCard(page).getByText(/formale Freigaben offen/);
}

/** Later-slice modules that the work page of this phase never names. */
export const WORK_PAGE_LATER_SLICE_TERMS = ['Arbeitspack', 'Geräteakte', 'Rechnung erstellen'] as const;

// ---------------------------------------------------------------------------
// Job detail (BASE-WORK): header menu, edit dialog, planned date, Details
// fields and the manager's checklist editor.

const JOB_DETAIL_COPY = {
  menu: { edit: SHARED_COPY.action.edit, delete: 'Auftrag löschen' },
  editDialog: 'Auftrag bearbeiten',
  plannedDate: {
    edit: 'Geplantes Datum bearbeiten',
    clear: 'Leeren',
    confirmRemoval: 'Datum entfernen',
    date: SHARED_COPY.field.date,
  },
  field: { completionDate: 'Abschlussdatum' },
} as const;

/** An item of the detail header's actions menu. */
export function jobDetailMenuItem(page: Page, item: keyof typeof JOB_DETAIL_COPY.menu): Locator {
  return page.getByRole('menuitem', { name: JOB_DETAIL_COPY.menu[item] });
}

/** The job edit dialog, named by its heading. */
export function jobEditDialog(page: Page): Locator {
  return page.getByRole('dialog').filter({
    has: jobEditDialogTitle(page),
  });
}

/** The edit dialog's title; clicking it closes an open picker popover inside the dialog. */
export function jobEditDialogTitle(scope: Page | Locator): Locator {
  return scope.getByRole('heading', { name: JOB_DETAIL_COPY.editDialog });
}

/** Opens the job's edit dialog through the detail header's actions menu. */
export async function openJobEditDialog(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: SHARED_COPY.action.openActions, exact: true }).click();
  await page.getByRole('menuitem', { name: SHARED_COPY.action.edit, exact: true }).click();
  return jobEditDialog(page);
}

/** One field row of the job's „Details“ card, named by its label. */
export function jobDetailField(page: Page, field: keyof typeof JOB_DETAIL_COPY.field): Locator {
  return metadataField(detailsRegion(page.getByRole('main')), JOB_DETAIL_COPY.field[field]);
}

/** Removes the planned date through the Details editor and confirms the removal. */
export async function clearPlannedDateOnJobPage(page: Page): Promise<void> {
  await page.getByRole('button', { name: JOB_DETAIL_COPY.plannedDate.edit }).click();
  await page.getByRole('button', { name: JOB_DETAIL_COPY.plannedDate.clear }).click();
  await page.getByRole('button', { name: SHARED_COPY.action.save, exact: true }).click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: JOB_DETAIL_COPY.plannedDate.confirmRemoval })
    .click();
}

/** Types a planned date (ddmmyyyy digits) into the Details editor and saves. */
export async function setPlannedDateOnJobPage(page: Page, dateDigits: string): Promise<void> {
  await page.getByRole('button', { name: JOB_DETAIL_COPY.plannedDate.edit }).click();
  await typeIntoDatePicker(page.getByRole('main'), JOB_DETAIL_COPY.plannedDate.date, dateDigits);
  await page.getByRole('button', { name: SHARED_COPY.action.save, exact: true }).click();
}

const INSTRUCTION_EDITOR_COPY = {
  newItem: 'Neuen Arbeitsanweisungs-Punkt eingeben',
  editItem: 'Arbeitsanweisungs-Punkt bearbeiten',
  moveUp: 'Punkt nach oben verschieben',
  details: 'Eintragsdetails bearbeiten',
  createdBy: 'Erstellt von',
  statusChangedBy: { done: 'Zuletzt erledigt von', open: 'Zuletzt offen von' },
  detailsField: { evidenceDescription: 'Nachweisbeschreibung', evidenceCategory: 'Nachweiskategorie' },
  evidenceFulfilled: /^Nachweis erfüllt:/,
} as const;

/** Evidence categories as the template editor and the item details dialog name them. */
const EVIDENCE_CATEGORY_LABELS = { report: 'Bericht', other: 'Sonstiges' } as const;

/** Adds a checklist point through the manager's draft row: types it and presses Enter. */
export async function addJobInstruction(page: Page, content: string): Promise<void> {
  const field = page.getByRole('textbox', { name: INSTRUCTION_EDITOR_COPY.newItem });
  await field.fill(content);
  await pressKey(page, 'Enter', { into: field });
}

/** Every editable text field of the manager's persisted checklist points, in list order. */
export function jobInstructionEditorFields(page: Page): Locator {
  return page.getByRole('textbox', { name: INSTRUCTION_EDITOR_COPY.editItem });
}

/**
 * The manager's checklist row whose text field holds exactly this content, and
 * that field. Addressed by position, as the list renders it: an optimistic row
 * changes its id when the server confirms it.
 */
export async function jobInstructionEditorRow(
  page: Page,
  content: string,
): Promise<{ row: Locator; field: Locator }> {
  const rows = page
    .getByRole('main')
    .getByTestId('job-instruction-item')
    .filter({ has: jobInstructionEditorFields(page) });
  await expect(rows).not.toHaveCount(0, { timeout: 15_000 });
  const count = await rows.count();
  for (let index = 0; index < count; index += 1) {
    const row = rows.nth(index);
    const field = row.getByRole('textbox', { name: INSTRUCTION_EDITOR_COPY.editItem });
    if ((await field.inputValue()) === content) return { row, field };
  }
  throw new Error(`No checklist point holds the text "${content}".`);
}

export function jobInstructionMoveUp(row: Locator): Locator {
  return row.getByRole('button', { name: INSTRUCTION_EDITOR_COPY.moveUp });
}

/** The details buttons of every manager row, in list order. */
export function jobInstructionDetailsButtons(page: Page): Locator {
  return page.getByRole('button', { name: INSTRUCTION_EDITOR_COPY.details });
}

/**
 * The last row's details button. Manager rows render their text in a
 * textarea, so a row cannot be found by its text; callers assert the row count
 * first.
 */
export function lastJobInstructionDetailsButton(page: Page): Locator {
  return jobInstructionDetailsButtons(page).last();
}

export function jobInstructionDetailsDialog(page: Page): Locator {
  return page.getByRole('dialog').filter({
    has: page.getByRole('heading', { name: INSTRUCTION_EDITOR_COPY.details }),
  });
}

export function jobInstructionDetailsField(
  dialog: Locator,
  field: keyof typeof INSTRUCTION_EDITOR_COPY.detailsField,
): Locator {
  return dialog.getByLabel(INSTRUCTION_EDITOR_COPY.detailsField[field]);
}

/** An evidence category option of an open category select. */
export function evidenceCategoryOption(page: Page, category: keyof typeof EVIDENCE_CATEGORY_LABELS): Locator {
  return page.getByRole('option', { name: EVIDENCE_CATEGORY_LABELS[category], exact: true });
}

/** The creation line of a checklist point by this person's first name. */
export function instructionCreatedBy(page: Page, firstName: string): Locator {
  return visibleText(page, `${INSTRUCTION_EDITOR_COPY.createdBy} ${firstName}`);
}

/** The last status change line of a checklist point by this person's first name. */
export function instructionStatusChangedBy(
  page: Page,
  markedAs: keyof typeof INSTRUCTION_EDITOR_COPY.statusChangedBy,
  firstName: string,
): Locator {
  return visibleText(page, `${INSTRUCTION_EDITOR_COPY.statusChangedBy[markedAs]} ${firstName}`);
}

/** The fulfilled evidence line of a checklist row. */
export function instructionEvidenceFulfilled(item: Locator): Locator {
  return item.getByText(INSTRUCTION_EDITOR_COPY.evidenceFulfilled);
}

// ---------------------------------------------------------------------------
// The Aufträge list (BASE-WORK-F08): its active section, filters, columns and
// the per-user column settings.

const WORK_LIST_COPY = {
  section: 'Aktuelle Aufträge und Projekte',
  search: 'Suche nach Titel, Nummer, Kunde, Ort…',
  allTypes: 'Alle',
  filter: 'Filter',
  customerFilter: 'Alle Kunden',
  employeeFilter: 'Alle Mitarbeiter',
  onlyProjects: 'Nur Projekte',
  resetFilters: 'Alle zurücksetzen',
  expandProject: 'Projekt aufklappen',
  group: { parking: /Parkplatz/, archive: /Archiv/ },
  column: { customer: 'Kunde' },
  columnSettings: { save: 'Ansicht speichern', saved: 'Deine Aufträge-Spalten wurden gespeichert.' },
} as const;

/** The sortable column headings of the list, in display order. */
export const WORK_LIST_SORT_COLUMNS = [
  'Nr',
  'Titel / Beschreibung',
  'Kunde',
  'Status',
  'Priorität',
  'Datum',
] as const;

/** The list's „Aktuelle Aufträge und Projekte“ section. */
export function workListSection(page: Page): Locator {
  return page.getByRole('region', { name: WORK_LIST_COPY.section, exact: true });
}

/** The list's search; desktop and mobile render the same search, so this is the visible copy. */
export function visibleJobSearch(page: Page): Locator {
  return page.getByPlaceholder(WORK_LIST_COPY.search).filter({ visible: true }).first();
}

/** The type filter of the desktop filter panel: its final unlabeled „Alle“ select. */
export function jobTypeFilter(filterPanel: Locator): Locator {
  return filterPanel.getByRole('combobox').filter({ hasText: WORK_LIST_COPY.allTypes }).last();
}

/** A sort button of the list's column headers; responsive headers duplicate it, so this is the visible one. */
export function visibleSortButton(
  section: Locator,
  column: (typeof WORK_LIST_SORT_COLUMNS)[number],
): Locator {
  return section.getByRole('button', { name: column, exact: true }).filter({ visible: true }).first();
}

/** The section's button that opens the desktop filter panel. */
export function workListFilterToggle(section: Locator): Locator {
  return section.getByRole('button', { name: WORK_LIST_COPY.filter });
}

/** The open desktop filter panel of the section. */
export function workListFilterPanel(section: Locator): Locator {
  return section.getByRole('region', { name: WORK_LIST_COPY.filter, exact: true });
}

/** A filter select of the panel while it shows its „all“ placeholder. */
export function workListFilter(panel: Locator, filter: 'customer' | 'employee'): Locator {
  return panel.getByRole('combobox').filter({
    hasText: filter === 'customer' ? WORK_LIST_COPY.customerFilter : WORK_LIST_COPY.employeeFilter,
  });
}

/** The type filter's option that shows projects only. */
export function workListOnlyProjectsOption(page: Page): Locator {
  return page.getByRole('option', { name: WORK_LIST_COPY.onlyProjects, exact: true });
}

export function workListResetFilters(section: Locator): Locator {
  return section.getByRole('button', { name: WORK_LIST_COPY.resetFilters });
}

/** The expand button of a project row. */
export function expandProjectButton(row: Locator): Locator {
  return row.getByRole('button', { name: WORK_LIST_COPY.expandProject });
}

/** The first visible text of the parking or archive group. */
export function workListGroupText(page: Page, group: keyof typeof WORK_LIST_COPY.group): Locator {
  return visibleMatchingText(page, WORK_LIST_COPY.group[group]);
}

export function workListColumnHeader(page: Page, column: keyof typeof WORK_LIST_COPY.column): Locator {
  return workListSection(page).getByRole('columnheader', { name: WORK_LIST_COPY.column[column] });
}

/** The column checkbox of the per-user Aufträge column settings. */
export function workColumnSetting(page: Page, column: keyof typeof WORK_LIST_COPY.column): Locator {
  return page.getByRole('checkbox', { name: WORK_LIST_COPY.column[column], exact: true });
}

/** Saves the column settings and waits for their confirmation. */
export async function saveWorkColumnSettings(page: Page): Promise<void> {
  await page.getByRole('button', { name: WORK_LIST_COPY.columnSettings.save }).click();
  await expect(visibleText(page, WORK_LIST_COPY.columnSettings.saved)).toBeVisible();
}

// ---------------------------------------------------------------------------
// The creation dialog of /auftraege and of the other creation contexts.

const WORK_CREATE_COPY = {
  title: 'Neuen Auftrag oder Projekt erstellen',
  /** The tabs, and the submit of each tab's form. */
  tab: { job: 'Auftrag erstellen', project: 'Projekt erstellen' },
  jobNumber: 'Auftragsnummer *',
  plannedDate: SHARED_COPY.field.date,
  noProject: 'Kein Projekt',
  templatePicker: 'Arbeitsvorlage (optional)',
} as const;

type WorkCreateTab = keyof typeof WORK_CREATE_COPY.tab;

/** The Aufträge list's trigger of the job-or-project creation dialog. */
export function workCreateButton(page: Page): Locator {
  return page.getByRole('button', { name: SHARED_COPY.action.create, exact: true });
}

export function workCreateHeading(scope: Page | Locator): Locator {
  return scope.getByRole('heading', { name: WORK_CREATE_COPY.title });
}

export function workCreateDialog(page: Page): Locator {
  return page.getByRole('dialog').filter({ has: workCreateHeading(page) });
}

export function workCreateTab(scope: Page | Locator, tab: WorkCreateTab): Locator {
  return scope.getByRole('tab', { name: WORK_CREATE_COPY.tab[tab] });
}

/** The submit of the open tab's form; it carries the tab's name. */
export function workCreateSubmit(scope: Page | Locator, tab: WorkCreateTab): Locator {
  return scope.getByRole('button', { name: WORK_CREATE_COPY.tab[tab], exact: true });
}

export function workCreateJobNumberField(dialog: Locator): Locator {
  return dialog.getByLabel(WORK_CREATE_COPY.jobNumber);
}

/** Types the planned date (ddmmyyyy digits) into the creation dialog's date picker. */
export async function typeWorkCreatePlannedDate(dialog: Locator, digits: string): Promise<void> {
  await typeIntoDatePicker(dialog, WORK_CREATE_COPY.plannedDate, digits);
}

// ---------------------------------------------------------------------------
// Projects: the job assignment dialog, schedule indicators and the menu.

const PROJECT_COPY = {
  addJobsTitle: 'Aufträge zum Projekt hinzufügen',
  jobPicker: 'Aufträge zuweisen',
  deleteProject: 'Projekt löschen',
  scheduleIndicator: /Im Zeitplan|Leicht verzögert|Stark verzögert/,
} as const;

/** Texts of the job and project detail that specs assert. */
export const WORK_DETAIL_TEXT = {
  noProject: 'Keinem Projekt zugeordnet',
  projectHasNoJobs: 'Noch keine Aufträge in diesem Projekt.',
} as const;

/** The project's dialog that adds existing jobs to it. */
export function projectJobAssignmentDialog(page: Page): Locator {
  return page.getByRole('dialog').filter({
    has: page.getByRole('heading', { name: PROJECT_COPY.addJobsTitle }),
  });
}

export function projectJobPicker(dialog: Locator): Locator {
  return dialog.getByRole('combobox').filter({ hasText: PROJECT_COPY.jobPicker });
}

/** The visible schedule indicators of a project (on time, slightly or strongly delayed). */
export function projectScheduleIndicators(page: Page): Locator {
  return page.getByTitle(PROJECT_COPY.scheduleIndicator).filter({ visible: true });
}

export function projectDeleteMenuItem(page: Page): Locator {
  return page.getByRole('menuitem', { name: PROJECT_COPY.deleteProject });
}

/** The optional work template picker of a creation form. */
export function workTemplatePicker(scope: Locator): Locator {
  return scope.getByLabel(WORK_CREATE_COPY.templatePicker);
}

/** The work template select of a job or a project form, by its element id. */
export function workTemplateSelect(scope: Page | Locator, target: 'job' | 'project'): Locator {
  return scope.locator(`#work-template-${target}`);
}

/** The element ids of the job form, in the creation dialog, the calendar's job tab and the edit dialog. */
const JOB_FORM_FIELD_IDS = {
  number: 'job-number',
  title: 'job-title',
  description: 'job-description',
  priority: 'job-priority',
  duration: 'job-duration',
  location: 'job-location',
  site: 'job-site',
  contact: 'job-contact',
} as const;

/** One field of the job form, by its element id. */
export function jobFormField(scope: Page | Locator, field: keyof typeof JOB_FORM_FIELD_IDS): Locator {
  return scope.locator(`#${JOB_FORM_FIELD_IDS[field]}`);
}

// ---------------------------------------------------------------------------
// Handover review (P1-17): the section on the Übergabe page and the summary
// card on the work page.

const HANDOVER_COPY = {
  action: {
    saveDraft: 'Entwurf speichern',
    openPreview: 'Vorschau öffnen',
    release: 'Freigeben und übergeben',
    withdraw: 'Übergabe zurücknehmen',
    reopenForCorrection: 'Zur Korrektur in Ausführung geben',
  },
  field: {
    exceptionReason: 'Begründung der Ausnahme',
    withdrawReason: 'Grund für die Rücknahme',
    reopenReason: 'Ausführung erneut öffnen',
  },
  message: {
    draftSaved: 'Entwurf gespeichert.',
    previewCreated: 'Vorschau erstellt.',
    released: 'Übergabepaket freigegeben',
    withdrawn: 'Übergabe zurückgenommen.',
    reopened: 'Ausführung zur Korrektur geöffnet.',
  },
  text: {
    openReviewPoints: 'Offene Prüfpunkte',
    notAssessed: 'Nicht automatisch bewertet',
    executionMustBeComplete: 'Die Ausführung muss abgeschlossen sein',
    staleDraft: 'Die Übergabe wurde inzwischen geändert',
  },
  reviewLink: 'Übergabe prüfen',
} as const;

type HandoverAction = keyof typeof HANDOVER_COPY.action;
type HandoverField = keyof typeof HANDOVER_COPY.field;
type HandoverMessage = keyof typeof HANDOVER_COPY.message;
/** Section texts a spec checks with toContainText. */
export const HANDOVER_TEXT = HANDOVER_COPY.text;

export function handoverAction(section: Locator, action: HandoverAction): Locator {
  return section.getByRole('button', { name: HANDOVER_COPY.action[action] });
}

export function handoverField(section: Locator, field: HandoverField): Locator {
  return section.getByLabel(HANDOVER_COPY.field[field]);
}

/** The confirmation the section shows after an action; the longer sentences match by their start. */
export function handoverMessage(section: Locator, message: HandoverMessage): Locator {
  return section.getByText(HANDOVER_COPY.message[message]);
}

/** The package state as the product names it, for toContainText. */
export function handoverStateLabel(state: WorkHandoverPackageState | 'missing'): string {
  return WORK_HANDOVER_STATE_LABELS[state];
}

/** The release history heading with its count, for toContainText. */
export function handoverReleaseHistory(count: number): string {
  return `Freigabeverlauf (${count})`;
}

/** The link on the work page's handover summary that opens the review. */
export function handoverReviewLink(page: Page): Locator {
  return page
    .getByRole('main')
    .getByTestId('work-handover-summary')
    .getByRole('link', { name: HANDOVER_COPY.reviewLink });
}

export async function selectAllHandoverSources(section: Locator): Promise<void> {
  await expect(section.getByRole('checkbox').first()).toBeAttached({
    timeout: 20_000,
  });
  const sourceCheckboxes = await section.getByRole('checkbox').all();
  for (const checkbox of sourceCheckboxes) {
    if (!(await checkbox.isChecked())) await checkbox.check();
  }
}

export async function createJob(
  page: Page,
  options: {
    jobNumber: string;
    title: string;
    description?: string;
    assignEmployeeName?: string;
    // P1-01: pick the customer and its site/contact through the dialog.
    clientName?: string;
    projectNumber?: string;
    siteName?: string;
    contactName?: string;
    expectedInheritedSiteName?: string;
    expectedInheritedContactName?: string;
    qualificationOverrideReason?: string;
    plannedDateDigits?: string;
    workTemplateName?: string;
  },
): Promise<void> {
  await page.goto('/auftraege');
  await workCreateButton(page).click();
  await expect(workCreateHeading(page)).toBeVisible();
  await workCreateTab(page, 'job').click();

  await jobFormField(page, 'number').fill(options.jobNumber);
  await jobFormField(page, 'title').fill(options.title);
  if (options.description) await jobFormField(page, 'description').fill(options.description);

  if (options.workTemplateName) {
    await expect(workTemplateSelect(page, 'job')).toBeVisible({
      timeout: 15_000,
    });
    await selectFromSearchable(page, workTemplateSelect(page, 'job'), options.workTemplateName);
  }

  if (options.plannedDateDigits) {
    await typeWorkCreatePlannedDate(page.getByRole('dialog'), options.plannedDateDigits);
  }

  if (options.clientName) {
    // The customer picker is a searchable combobox showing "Kein Kunde".
    await customerPicker(page).click();
    await customerPickerSearch(page).fill(options.clientName);
    await page
      .getByRole('listbox')
      .getByRole('option')
      .filter({ hasText: options.clientName })
      .first()
      .click();
  }

  if ((options.siteName || options.contactName) && !options.clientName) {
    throw new Error('createJob: siteName/contactName require clientName');
  }

  if (options.projectNumber) {
    await page.getByRole('combobox').filter({ hasText: WORK_CREATE_COPY.noProject }).click();
    await page.getByPlaceholder(SHARED_COPY.picker.searchProject).fill(options.projectNumber);
    const projectOption = page
      .getByRole('listbox')
      .getByRole('option')
      .filter({ hasText: `${options.projectNumber} –` });
    await expect(projectOption).toHaveCount(1, { timeout: 15_000 });
    await projectOption.click();
    if (options.expectedInheritedSiteName) {
      await expect(jobFormField(page, 'site')).toContainText(options.expectedInheritedSiteName, {
        timeout: 15_000,
      });
    }
    if (options.expectedInheritedContactName) {
      await expect(jobFormField(page, 'contact')).toContainText(options.expectedInheritedContactName, {
        timeout: 15_000,
      });
    }
  }

  if (options.siteName) {
    // The site picker appears once the customer's sites finished loading.
    await expect(jobFormField(page, 'site')).toBeEnabled({ timeout: 15_000 });
    await selectFromSearchable(page, jobFormField(page, 'site'), options.siteName);
  }

  if (options.contactName) {
    await expect(jobFormField(page, 'contact')).toBeEnabled({ timeout: 15_000 });
    await selectFromSearchable(page, jobFormField(page, 'contact'), options.contactName);
  }

  if (options.assignEmployeeName) {
    // The employee picker renders as a combobox showing its placeholder text.
    await employeeAssignmentPicker(page).click();
    await employeeAssignmentSearch(page).fill(options.assignEmployeeName);
    // Options render as buttons inside the picker's listbox.
    await page
      .getByRole('listbox')
      .getByRole('option')
      .filter({ hasText: options.assignEmployeeName })
      .first()
      .click();
    // Dismiss the picker by clicking elsewhere in the dialog; Escape would
    // close the whole creation dialog.
    await workCreateHeading(page).click();
    await expect(employeeAssignmentSearch(page)).toBeHidden();
  }

  await workCreateSubmit(page, 'job').click();
  if (options.qualificationOverrideReason) {
    const warningDialog = await assignDespiteQualificationWarning(page, options.qualificationOverrideReason);
    await expect(warningDialog).toHaveCount(0, { timeout: 15_000 });
  }
  // The dialog closes on success; the caller asserts the job row afterwards.
  await expect(workCreateHeading(page)).toBeHidden({
    timeout: 15_000,
  });

  // Phase 5 creation is optimistic: validation closes the dialog before the
  // server action settles. A child row is not mounted while its project is
  // collapsed, so expand the owning project before observing the pending
  // marker. Otherwise the absence check passes vacuously and a prefix match
  // on the project number can be mistaken for the confirmed child.
  if (options.projectNumber) {
    const projectNumber = visibleText(page, options.projectNumber, true);
    await expect(projectNumber).toBeVisible({ timeout: 15_000 });
    const projectRow = projectNumber.locator('xpath=ancestor::tr[1]');
    const expandButton = expandProjectButton(projectRow);
    if (await expandButton.isVisible().catch(() => false)) {
      await expandButton.click();
    }
  }

  // Do not let a following navigation abort the request. The mounted pending
  // marker clearing proves the action response landed; the exact visible job
  // number then proves the confirmed result replaced the draft.
  await expect(pendingRow(page, options.jobNumber)).toHaveCount(0, {
    timeout: 15_000,
  });
  const confirmedJobNumber = visibleText(page, options.jobNumber, true);
  await expect(confirmedJobNumber).toBeVisible({
    timeout: 15_000,
  });
}

export async function createProject(
  page: Page,
  options: {
    projectNumber: string;
    title: string;
    clientName?: string;
    siteName?: string;
    contactName?: string;
    workTemplateName?: string;
  },
): Promise<void> {
  if ((options.siteName || options.contactName) && !options.clientName) {
    throw new Error('createProject: siteName/contactName require clientName');
  }
  await page.goto('/auftraege');
  await workCreateButton(page).click();
  const dialog = workCreateDialog(page);
  await workCreateTab(dialog, 'project').click();
  const projectNumberInput = dialog.locator('#create-project-number');
  await expect(projectNumberInput).not.toHaveValue('', { timeout: 15_000 });
  await projectNumberInput.fill(options.projectNumber);
  await dialog.locator('#create-project-name').fill(options.title);
  if (options.workTemplateName) {
    await expect(workTemplateSelect(dialog, 'project')).toBeVisible({
      timeout: 15_000,
    });
    await selectFromSearchable(page, workTemplateSelect(dialog, 'project'), options.workTemplateName);
  }
  if (options.clientName) {
    await customerPicker(dialog).click();
    await customerPickerSearch(page).fill(options.clientName);
    await page
      .getByRole('listbox')
      .getByRole('option')
      .filter({ hasText: options.clientName })
      .first()
      .click();
  }
  if (options.siteName) {
    await expect(dialog.locator('#create-project-site')).toBeVisible({
      timeout: 15_000,
    });
    await selectFromSearchable(page, dialog.locator('#create-project-site'), options.siteName);
  }
  if (options.contactName) {
    await expect(dialog.locator('#create-project-contact')).toBeVisible({
      timeout: 15_000,
    });
    await selectFromSearchable(page, dialog.locator('#create-project-contact'), options.contactName);
  }
  await workCreateSubmit(dialog, 'project').click();
  await expect(dialog).toHaveCount(0, { timeout: 15_000 });
  await expect(pendingRow(page, options.projectNumber)).toHaveCount(0, {
    timeout: 15_000,
  });
  await expect(visibleText(page, options.projectNumber)).toBeVisible({
    timeout: 15_000,
  });
}

export async function createAndPublishWorkTemplate(
  page: Page,
  options: {
    name: string;
    targetType: 'job' | 'project';
    firstItem: string;
    secondItem?: string;
    evidenceDescription?: string;
  },
): Promise<void> {
  await page.goto('/arbeitsvorlagen');
  await page
    .getByRole('button', { name: /Vorlage erstellen|Erste Vorlage erstellen/ })
    .first()
    .click();
  const createDialog = workTemplateCreateDialog(page);
  await createDialog.locator('#new-template-name').fill(options.name);
  if (options.targetType === 'project') {
    await createDialog.locator('#new-template-target').click();
    await workTemplateProjectTargetOption(page).click();
  }
  await createDialog.getByRole('button', { name: SHARED_COPY.action.create, exact: true }).click();
  await expect(createDialog).toHaveCount(0, { timeout: 15_000 });

  const editor = workTemplateDraftEditor(page, 1);
  await expect(editor).toBeVisible({ timeout: 20_000 });
  await workTemplateEditorAction(editor, 'addItem', { exact: true }).click();
  await workTemplateItemNames(editor).last().fill(options.firstItem);
  if (options.evidenceDescription) {
    await editor.getByRole('button', { name: 'Nachweis', exact: true }).click();
    await editor
      .getByLabel(INSTRUCTION_EDITOR_COPY.detailsField.evidenceDescription)
      .last()
      .fill(options.evidenceDescription);
  }
  if (options.secondItem) {
    await workTemplateEditorAction(editor, 'addItem', { exact: true }).click();
    const labels = workTemplateItemNames(editor);
    await labels.last().fill(options.secondItem);
    const secondCard = labels.last().locator('xpath=ancestor::*[@data-slot="card"][1]');
    await secondCard
      .getByRole('combobox', {
        name: `Verbindlichkeit für ${options.secondItem}`,
      })
      .click();
    await page.getByRole('option', { name: 'Optional', exact: true }).click();
    await toggleInSearchableMulti(
      page,
      secondCard.getByRole('combobox', {
        name: `Voraussetzungen für ${options.secondItem}`,
      }),
      [options.firstItem],
    );
  }
  await workTemplateEditorAction(editor, 'publish', { exact: true }).click();
  await expect(editor).toHaveCount(0, { timeout: 20_000 });
}

// P1-13: the work template list and editor.
const TEMPLATE_COPY = {
  search: 'Arbeitsvorlagen suchen',
  open: 'Öffnen',
  create: 'Vorlage erstellen',
  createDialog: 'Arbeitsvorlage erstellen',
  projectTarget: 'Projekte',
  editorAction: {
    newVersion: 'Neue Version',
    publish: 'Veröffentlichen',
    addItem: 'Eintrag',
    addMaterial: 'Material',
    addCapability: 'Qualifikation',
    save: SHARED_COPY.action.save,
    close: SHARED_COPY.action.close,
  },
  itemField: {
    name: SHARED_COPY.field.name,
    group: 'Gruppe',
    notes: 'Hinweise',
    documentCategory: 'Dokumentkategorie',
  },
  itemAction: { delete: 'Eintrag löschen', moveDown: 'Eintrag nach unten' },
  evidenceExpected: 'Nachweis erwartet',
} as const;

export function workTemplateSearch(page: Page): Locator {
  return page.getByRole('textbox', { name: TEMPLATE_COPY.search });
}

/** The list's open button; the spec searches first so that exactly one template is listed. */
export function workTemplateOpenButton(page: Page): Locator {
  return page.getByRole('button', { name: TEMPLATE_COPY.open, exact: true });
}

/** The list's create button (not the empty state's „Erste Vorlage erstellen“). */
export function workTemplateCreateButton(page: Page): Locator {
  return page.getByRole('button', { name: TEMPLATE_COPY.create, exact: true });
}

export function workTemplateCreateDialog(page: Page): Locator {
  return page.getByRole('dialog').filter({
    has: page.getByRole('heading', { name: TEMPLATE_COPY.createDialog }),
  });
}

/** The target option „Projekte“ of the create dialog. */
export function workTemplateProjectTargetOption(page: Page): Locator {
  return page.getByRole('option', { name: TEMPLATE_COPY.projectTarget, exact: true });
}

function draftVersionHeading(version: number): RegExp {
  return new RegExp(`Entwurf · Version ${version}`);
}

/** The editor of a template's draft in this version. */
export function workTemplateDraftEditor(page: Page, version: number): Locator {
  return page.getByRole('dialog').filter({
    has: page.getByRole('heading', { name: draftVersionHeading(version) }),
  });
}

export function workTemplateDraftHeading(editor: Locator, version: number): Locator {
  return editor.getByRole('heading', { name: draftVersionHeading(version) });
}

/** The editor of a published template, named by template and version. */
export function workTemplateEditor(page: Page, name: string, version: number): Locator {
  return page.getByRole('dialog').filter({
    has: page.getByRole('heading', { name: `${name} · Version ${version}`, exact: true }),
  });
}

export function workTemplateEditorAction(
  editor: Locator,
  action: keyof typeof TEMPLATE_COPY.editorAction,
  options: { exact?: boolean } = {},
): Locator {
  return editor.getByRole('button', {
    name: TEMPLATE_COPY.editorAction[action],
    ...(options.exact ? { exact: true } : {}),
  });
}

/** Every item name field of the editor, in item order. */
export function workTemplateItemNames(editor: Locator): Locator {
  return editor.getByLabel(TEMPLATE_COPY.itemField.name);
}

export function workTemplateItemField(item: Locator, field: keyof typeof TEMPLATE_COPY.itemField): Locator {
  return item.getByLabel(TEMPLATE_COPY.itemField[field]);
}

export function workTemplateItemAction(
  item: Locator,
  action: keyof typeof TEMPLATE_COPY.itemAction,
): Locator {
  return item.getByRole('button', { name: TEMPLATE_COPY.itemAction[action] });
}

/** The kind select of the item with this name. */
export function workTemplateItemKind(scope: Locator, itemName: string): Locator {
  return scope.getByRole('combobox', { name: `Art für ${itemName}` });
}

const TEMPLATE_ITEM_KIND_LABELS = { task: 'Aufgabe', checklist: 'Checkliste' } as const;

/** An option of an open item kind select. */
export function workTemplateItemKindOption(
  page: Page,
  kind: keyof typeof TEMPLATE_ITEM_KIND_LABELS,
): Locator {
  return page.getByRole('option', { name: TEMPLATE_ITEM_KIND_LABELS[kind], exact: true });
}

/** The prerequisite multi-select of the item with this name. */
export function workTemplateItemPrerequisites(scope: Locator, itemName: string): Locator {
  return scope.getByRole('combobox', { name: `Voraussetzungen für ${itemName}` });
}

/** The evidence expectation a checklist point shows for this description. */
export function instructionEvidenceExpectation(page: Page, description: string): Locator {
  return visibleText(page, `${TEMPLATE_COPY.evidenceExpected}: ${description}`);
}

// P1-16: employee work-pack actions. These keep the audit and Golden specs on
// business language while the shared components retain their own selectors.
export async function openFieldWorkPack(
  page: Page,
  jobNumber: string,
  projectNumber?: string,
): Promise<Locator> {
  const path = projectNumber
    ? `/auftraege/projekt/${encodeURIComponent(projectNumber)}/${encodeURIComponent(jobNumber)}`
    : `/auftraege/${encodeURIComponent(jobNumber)}`;
  await page.goto(path);
  // Scope to the active application surface. During an RSC navigation Next.js
  // may retain a hidden transition copy outside <main>; a document-wide test-id
  // lookup would then fail strict mode despite one user-visible work pack.
  const pack = page.getByRole('main').getByTestId('field-work-pack');
  await expect(pack).toBeVisible({ timeout: 20_000 });
  await expect(pack.getByTestId('field-work-pack-overview')).toHaveAttribute('data-realtime-ready', 'true', {
    timeout: 20_000,
  });
  return pack;
}

/**
 * The checklist row whose primary label is exactly this text. Dependency
 * summaries repeat a predecessor's text inside other rows, but never as the
 * whole text of an element.
 */
export function jobInstructionItem(page: Page, label: string): Locator {
  return page
    .getByRole('main')
    .getByTestId('job-instruction-item')
    .filter({
      has: page.getByText(label, { exact: true }),
    });
}

/** The row's primary label. */
export function jobInstructionLabel(item: Locator, label: string): Locator {
  return item.getByText(label, { exact: true });
}

/** The prerequisite line a checklist point shows for its predecessor. */
export function instructionPrerequisite(scope: Locator, predecessor: string): Locator {
  return scope.getByText(instructionPrerequisiteText(predecessor), { exact: true });
}

/** The prerequisite line's text, for the text helpers. */
export function instructionPrerequisiteText(predecessor: string): string {
  return `Voraussetzung: ${predecessor}`;
}

/** The row's button that marks the point done or open again. */
export function jobInstructionToggle(item: Locator, markAs: keyof typeof INSTRUCTION_ACTIONS): Locator {
  return item.getByRole('button', { name: INSTRUCTION_ACTIONS[markAs] });
}

export async function setInstructionCompletionOnJobPage(
  page: Page,
  label: string,
  completed: boolean,
): Promise<void> {
  const item = jobInstructionItem(page, label);
  const action = jobInstructionToggle(item, completed ? 'done' : 'open');
  await expect(action).toBeEnabled({ timeout: 20_000 });
  await action.click();
  await expect(jobInstructionToggle(item, completed ? 'open' : 'done')).toBeEnabled({ timeout: 20_000 });
}

export async function changeTimeOnWorkPack(page: Page, action: 'start' | 'stop' | 'switch'): Promise<void> {
  const pack = page.getByRole('main').getByTestId('field-work-pack');
  const label =
    action === 'start'
      ? 'Arbeitszeit starten'
      : action === 'stop'
        ? 'Arbeitszeit beenden'
        : 'Zu diesem Auftrag wechseln';
  await pack.getByRole('button', { name: label, exact: true }).click();
  const expected = action === 'stop' ? 'Arbeitszeit starten' : 'Arbeitszeit beenden';
  await expect(pack.getByRole('button', { name: label, exact: true })).toHaveCount(0, {
    timeout: 20_000,
  });
  await expect(pack.getByRole('button', { name: expected, exact: true })).toBeVisible({
    timeout: 20_000,
  });
}

export async function reportOwnBlockerOnJobPage(page: Page, details: string): Promise<void> {
  const dialog = await addWorkBlocker(page, { reason: 'site_access', details });
  await expect(dialog).toHaveCount(0, { timeout: 20_000 });
}

export async function resolveOwnBlockerOnJobPage(page: Page, reason: string): Promise<void> {
  const dialog = await confirmLifecycleReason(page, 'resolveBlocker', reason);
  await expect(dialog).toHaveCount(0, { timeout: 20_000 });
}

export async function parkJobOnJobPage(
  page: Page,
  jobNumber: string,
  details: string,
  responsibleName: string,
  reviewDate: string,
): Promise<void> {
  await page.goto(`/auftraege/${encodeURIComponent(jobNumber)}`);
  const dialog = await parkWork(page, { reason: 'material', details, responsibleName, reviewDate });
  await expect(dialog).toHaveCount(0, { timeout: 20_000 });
}

// ---------------------------------------------------------------------------
// Field work pack (P1-16): what the assigned field worker sees.

const FIELD_PACK_COPY = {
  heading: { beforeVisit: 'Vor dem Einsatz' },
  button: {
    copyAddress: 'Adresse kopieren',
    upload: 'Hochladen',
    handoverDocument: 'Übergabedokument',
  },
  link: {
    reviewOpenPoints: 'Offene Punkte prüfen',
    inventory: 'Inventar',
  },
  moreJobDetails: 'Weitere Auftragsangaben',
  timeAction: /Arbeitszeit (starten|beenden)/,
} as const;

/**
 * Words of office, commercial and later-slice surfaces that a field work pack
 * never shows, grouped as the absence checks name them.
 */
const FIELD_PACK_ABSENT_TERMS = {
  billing: /Abrechenbar/,
  prices: /Abrechenbar|Einkaufspreis|Verkaufspreis|Marge/,
  valuation: /Abrechenbar|Bewertung|Einkaufspreis|Verkaufspreis/,
  offline: /offline/i,
  laterSlices:
    /\bGPS\b|\bGoogle Maps\b|\bNachricht senden\b|\bKundenpaket\b|\bRechnung\b|\bServicehistorie\b/i,
} as const;

/** Text in the pack that matches one group of office-only terms; the checks expect none. */
export function fieldPackAbsentTerms(pack: Locator, terms: keyof typeof FIELD_PACK_ABSENT_TERMS): Locator {
  return pack.getByText(FIELD_PACK_ABSENT_TERMS[terms]);
}

/** The customer package, a P1-17 office artefact, by its name, for absence checks on the pack. */
export const CUSTOMER_PACKAGE_TERM = 'Kundenpaket';

/** The pack's section headings in the order the first viewport shows them. */
export const FIELD_PACK_SECTION_ORDER = [
  FIELD_PACK_COPY.heading.beforeVisit,
  LIFECYCLE_COPY.header,
  'Arbeitsanweisungen & Notizen',
  'Arbeitsnachweise',
] as const;

/** The pack's primary next action, whichever control the product makes primary. */
export function fieldPrimaryNextAction(pack: Locator): Locator {
  return pack.getByTestId('field-primary-next-action');
}

export function fieldPackHeading(pack: Locator, heading: keyof typeof FIELD_PACK_COPY.heading): Locator {
  return pack.getByRole('heading', { name: FIELD_PACK_COPY.heading[heading] });
}

export function fieldPackButton(pack: Locator, button: keyof typeof FIELD_PACK_COPY.button): Locator {
  return pack.getByRole('button', { name: FIELD_PACK_COPY.button[button] });
}

export function fieldPackLink(pack: Locator, link: keyof typeof FIELD_PACK_COPY.link): Locator {
  return pack.getByRole('link', { name: FIELD_PACK_COPY.link[link] });
}

/** The pack's time button, whether it starts or ends the work time. */
export function fieldPackTimeAction(pack: Locator): Locator {
  return pack.getByRole('button', { name: FIELD_PACK_COPY.timeAction });
}

/** The phone link for this contact; pass the pack, or the page for the job page's contact. */
export function fieldPackCallLink(scope: Page | Locator, contactName: string): Locator {
  return scope.getByRole('link', { name: `${contactName} anrufen` });
}

/** The access note line of a job's site. */
export function siteAccessText(accessNotes: string): string {
  return `Zugang: ${accessNotes}`;
}

/** The empty state of a job's time card and the project's hour total. */
export const WORK_TIME_TEXT = {
  noJobTime: 'Noch keine Arbeitszeiten für diesen Auftrag erfasst.',
  projectTotalHours: 'Gesamtstunden (alle Aufträge)',
} as const;

/** The navigation link for an address that starts with this street. */
export function fieldPackNavigationLink(pack: Locator, street: string): Locator {
  return pack.getByRole('link', { name: new RegExp(`Navigation zu ${escapeRegExp(street)}`) });
}

/** The disclosure with the further job details. */
export function fieldPackMoreJobDetails(pack: Locator): Locator {
  return pack.getByText(FIELD_PACK_COPY.moreJobDetails);
}

export async function removeJobAssignment(
  page: Page,
  jobNumber: string,
  employeeName: string,
): Promise<void> {
  await page.goto(`/auftraege/${encodeURIComponent(jobNumber)}`);
  await page
    .getByRole('button', {
      name: `Zuweisung für ${employeeName} entfernen`,
    })
    .click();
  await expect(
    page.getByRole('button', {
      name: `Zuweisung für ${employeeName} entfernen`,
    }),
  ).toHaveCount(0, { timeout: 20_000 });
}
