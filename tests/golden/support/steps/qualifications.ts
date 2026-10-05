import { expect, type Locator, type Page } from '@playwright/test';
import {
  getCapabilityKindLabel,
  getCoverageStatusLabel,
  type CapabilityKind,
  type CoverageStatus,
  type EvidenceState,
} from '../../../../lib/qualifications/types';
import {
  employeeAssignmentHeading,
  employeeAssignmentPicker,
  employeeAssignmentSearch,
  openEmployeeAssignmentDialog,
  qualificationOverrideReason,
  expectBannerAfter,
  qualificationWarningDialog,
  SHARED_COPY,
  selectFromSearchable,
  typeIntoDatePicker,
  typeIntoDatePickerById,
  visibleText,
} from './shared';

// P1-09: teams and qualifications. These steps use stable semantic controls
// and data identities because Realtime refreshes may replace rows mid-step.

const MANAGEMENT_TABS = { teams: 'Teams', qualifications: 'Qualifikationen' } as const;
type ManagementTab = keyof typeof MANAGEMENT_TABS;

const QUALIFICATION_COPY = {
  apprenticeWarningToggle: 'Ausbildungs-Hinweis aktivieren',
  apprenticeNotice: 'Ausbildungs-Hinweis',
  reasonMissing: 'Bitte gib eine kurze Begründung ein.',
  noCoveringPerson: 'Keine passende Person zugewiesen',
  dissolve: 'Auflösen',
  confirmDissolve: 'Team auflösen',
  dissolveKeepsHistory: 'bleibt mit seiner Historie erhalten',
  dissolvedTeams: 'Aufgelöste Teams',
  renew: 'Erneuern',
} as const;

/** The employee's own overview labels validity on its own, apart from the coverage labels. */
const OWN_VALIDITY_LABELS = { expired: 'Abgelaufen', notYetValid: 'Noch nicht gültig' } as const;

/** The evidence states of a qualification entry, as its select names them. */
const EVIDENCE_STATE_LABELS = {
  not_required: 'Nicht erforderlich',
  pending: 'Ausstehend',
  received: 'Erhalten',
} as const satisfies Record<EvidenceState, string>;

/** The employee's own qualification overview's badges. */
export const OWN_QUALIFICATION_COPY = {
  expired: OWN_VALIDITY_LABELS.expired,
  evidenceReceived: 'Nachweis: erhalten',
} as const;

/** The section of a job, a project or a work template that plans the required qualifications. */
const PLANNED_QUALIFICATIONS = 'Geplante Qualifikationen';

/**
 * The first visible title of the planned qualifications section. On a project
 * it renders immediately before the material section; its hydration marks the
 * material actions as interactive.
 */
export function projectQualificationSection(page: Page): Locator {
  return visibleText(page, PLANNED_QUALIFICATIONS);
}

/** The planned qualifications section as its region, inside a work template editor. */
export function plannedQualificationsRegion(scope: Locator): Locator {
  return scope.getByRole('region', { name: PLANNED_QUALIFICATIONS, exact: true });
}

function managementTab(page: Page, tab: ManagementTab): Locator {
  return page.getByRole('tab', { name: MANAGEMENT_TABS[tab], exact: true });
}

/** Opens /mitarbeiter on the Teams or Qualifikationen tab. */
export async function openManagementTab(page: Page, tab: ManagementTab): Promise<void> {
  await page.goto('/mitarbeiter');
  await managementTab(page, tab).click();
}

/** A current team's management card inside its owner (`main`). */
function teamCard(scope: Locator, teamName: string): Locator {
  return scope.getByTestId('team-card').filter({ hasText: teamName });
}

/** A current member row on a team card. */
function teamMemberRow(card: Locator, memberName: string): Locator {
  return card.getByTestId('team-member-row').filter({ hasText: memberName });
}

export async function createTeamViaManagement(page: Page, teamName: string): Promise<void> {
  await openManagementTab(page, 'teams');
  await page.locator('#new-team-name').fill(teamName);
  await page.getByRole('button', { name: 'Team anlegen' }).click();
  await expect(teamCard(page.getByRole('main'), teamName)).toBeVisible({
    timeout: 15_000,
  });
}

/** Picks the member, optionally types the start date, and presses the card's add button. */
async function submitTeamMember(
  page: Page,
  card: Locator,
  options: { teamName: string; employeeName: string; validFrom?: string },
): Promise<void> {
  await selectFromSearchable(
    page,
    card.getByRole('combobox', {
      name: `Mitglied zu ${options.teamName} hinzufügen`,
    }),
    options.employeeName,
  );
  if (options.validFrom) {
    // ISO date → DDMMYYYY segment digits for the DatePicker group.
    const digits = `${options.validFrom.slice(8, 10)}${options.validFrom.slice(5, 7)}${options.validFrom.slice(0, 4)}`;
    await typeIntoDatePicker(card, `Teamzugehörigkeit zu ${options.teamName} gültig ab`, digits);
  }
  await card.getByRole('button', { name: SHARED_COPY.action.add }).click();
}

export async function addTeamMemberViaManagement(
  page: Page,
  options: { teamName: string; employeeName: string; validFrom?: string },
): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await openManagementTab(page, 'teams');
    const card = teamCard(page.getByRole('main'), options.teamName);
    await expect(card).toBeVisible({ timeout: 15_000 });
    const memberRow = teamMemberRow(card, options.employeeName).first();
    if (await memberRow.isVisible().catch(() => false)) return;

    await submitTeamMember(page, card, options);
    // The row shows before the server answers; the banner confirms the write.
    if (
      await page
        .getByRole('alert')
        .filter({ hasText: 'Das Teammitglied wurde hinzugefügt.' })
        .waitFor({ state: 'visible', timeout: 10_000 })
        .then(() => true)
        .catch(() => false)
    ) {
      await expect(memberRow).toBeVisible();
      return;
    }
  }

  throw new Error(`Team member ${options.employeeName} was not persisted`);
}

/**
 * Adds a membership that starts in the future. The card lists only current
 * members, so the caller verifies the write against the persisted row.
 */
export async function addFutureTeamMemberViaManagement(
  page: Page,
  options: { teamName: string; employeeName: string; validFrom: string },
): Promise<void> {
  await openManagementTab(page, 'teams');
  const card = teamCard(page.getByRole('main'), options.teamName);
  await expect(card).toBeVisible({ timeout: 15_000 });
  await submitTeamMember(page, card, options);
}

/** Dissolves the team through its card and the confirmation that promises to keep its history. */
export async function dissolveTeamViaManagement(page: Page, teamName: string): Promise<void> {
  await openManagementTab(page, 'teams');
  await teamCard(page.getByRole('main'), teamName)
    .getByRole('button', { name: QUALIFICATION_COPY.dissolve })
    .click();
  const dissolveDialog = page.getByRole('alertdialog');
  await expect(
    dissolveDialog.getByText(QUALIFICATION_COPY.dissolveKeepsHistory, {
      exact: false,
    }),
  ).toBeVisible();
  await dissolveDialog.getByRole('button', { name: QUALIFICATION_COPY.confirmDissolve, exact: true }).click();
  await expect(page.getByRole('heading', { name: QUALIFICATION_COPY.dissolvedTeams })).toBeVisible({
    timeout: 15_000,
  });
}

/** The team shortcut button inside an assignment form. */
export function teamShortcut(scope: Locator, teamName: string): Locator {
  return scope.getByRole('button', { name: teamName, exact: true });
}

/** The notice that a team member without app access was left out of an assignment. */
export function teamMemberSkippedNotice(page: Page, personName: string): Locator {
  return visibleText(page, `${personName} wurde nicht übernommen, da kein aktiver App-Zugang verknüpft ist.`);
}

export async function createCapabilityViaManagement(
  page: Page,
  options: {
    name: string;
    kind: CapabilityKind;
    warningDays?: number;
  },
): Promise<void> {
  await openManagementTab(page, 'qualifications');
  await page.locator('#capability-kind').click();
  await page.getByRole('option', { name: getCapabilityKindLabel(options.kind), exact: true }).click();
  await page.locator('#capability-name').fill(options.name);
  if (options.kind === 'certification' && options.warningDays !== undefined) {
    await page.locator('#capability-warning-days').fill(String(options.warningDays));
  }
  await page.getByRole('button', { name: 'Anlegen', exact: true }).click();
  const definitionRow = page
    .getByRole('main')
    .getByTestId('capability-definition-row')
    .filter({ hasText: options.name });
  try {
    await expect(definitionRow).toBeVisible({ timeout: 15_000 });
  } catch {
    await page.reload();
    await managementTab(page, 'qualifications').click();
    await expect(definitionRow).toBeVisible({ timeout: 15_000 });
  }
}

export async function assignCapabilityViaManagement(
  page: Page,
  options: {
    employeeName: string;
    capabilityName: string;
    validFrom: string;
    validUntil?: string;
    issuer?: string;
    renewalDueDate?: string;
    confirmed?: boolean;
    evidence?: EvidenceState;
    operationalNote?: string;
  },
): Promise<void> {
  await openManagementTab(page, 'qualifications');
  await selectFromSearchable(
    page,
    page.getByRole('combobox', { name: 'Mitarbeiter für Qualifikation' }),
    options.employeeName,
  );
  await selectFromSearchable(
    page,
    page.getByRole('combobox', { name: 'Qualifikation auswählen' }),
    options.capabilityName,
  );
  await typeIntoDatePickerById(page.locator('body'), 'qualification-valid-from', options.validFrom);
  if (options.validUntil) {
    await typeIntoDatePickerById(page.locator('body'), 'qualification-valid-until', options.validUntil);
  }
  if (options.issuer !== undefined) {
    await page.locator('#qualification-issuer').fill(options.issuer);
  }
  if (options.renewalDueDate) {
    await typeIntoDatePickerById(page.locator('body'), 'qualification-renewal-date', options.renewalDueDate);
  }
  if (options.evidence) {
    await page.getByRole('combobox', { name: 'Nachweisstatus' }).click();
    await page.getByRole('option', { name: EVIDENCE_STATE_LABELS[options.evidence], exact: true }).click();
  }
  const confirmation = page.locator('#qualification-confirmed');
  if (options.confirmed && !(await confirmation.isChecked())) {
    await confirmation.click();
  }
  if (options.operationalNote) {
    await page.locator('#qualification-operational-note').fill(options.operationalNote);
  }
  // The row shows before the server answers; the banner confirms the write.
  await expectBannerAfter(page, 'Der Eintrag wurde gespeichert.', () =>
    page.getByRole('button', { name: 'Eintrag speichern' }).click(),
  );
  await expect(
    page
      .getByRole('main')
      .getByTestId('employee-capability-row')
      .filter({ hasText: options.employeeName })
      .filter({ hasText: options.capabilityName }),
  ).toBeVisible({ timeout: 15_000 });
}

export async function renewCapabilityViaManagement(
  page: Page,
  options: {
    employeeName: string;
    capabilityName: string;
    validFrom: string;
    validUntil: string;
  },
): Promise<void> {
  await openManagementTab(page, 'qualifications');
  const row = page
    .getByRole('main')
    .getByTestId('employee-capability-row')
    .filter({ hasText: options.employeeName })
    .filter({ hasText: options.capabilityName });
  await row.getByRole('button', { name: QUALIFICATION_COPY.renew }).click();
  await typeIntoDatePickerById(page.locator('body'), 'qualification-valid-from', options.validFrom);
  await typeIntoDatePickerById(page.locator('body'), 'qualification-valid-until', options.validUntil);
  await expectBannerAfter(page, 'Der Eintrag wurde gespeichert.', () =>
    page.getByRole('button', { name: 'Erneuerung speichern' }).click(),
  );
  await expect(
    page
      .getByRole('main')
      .getByTestId('employee-capability-row')
      .filter({ hasText: options.capabilityName })
      // The row reads the date as people write it (01.09.2026).
      .filter({ hasText: `bis ${options.validUntil.split('-').reverse().join('.')}` }),
  ).toBeVisible({ timeout: 15_000 });
}

/** The admin-only switch for the apprentice notice on the Qualifikationen tab. */
export function apprenticeWarningToggle(page: Page): Locator {
  return page.getByRole('checkbox', {
    name: QUALIFICATION_COPY.apprenticeWarningToggle,
  });
}

export async function setApprenticeWarningViaManagement(page: Page, enabled: boolean): Promise<void> {
  await openManagementTab(page, 'qualifications');
  const checkbox = apprenticeWarningToggle(page);
  if ((await checkbox.isChecked()) !== enabled) {
    await checkbox.click();
    await expect(page.getByText('Einstellung gespeichert.')).toBeVisible({
      timeout: 15_000,
    });
  }
  await expect(checkbox).toBeChecked({ checked: enabled });
}

export async function addJobCapabilityRequirement(
  page: Page,
  options: {
    jobNumber: string;
    capabilityName: string;
    requireConfirmation?: boolean;
  },
): Promise<void> {
  await page.goto(`/auftraege/${options.jobNumber}`);
  await expect(page.getByRole('heading', { name: 'Qualifikationsabdeckung' })).toBeVisible({
    timeout: 15_000,
  });
  await selectFromSearchable(page, page.locator('#job-qualification-capability'), options.capabilityName);
  if (options.requireConfirmation) {
    await page.locator('#job-require-confirmation').click();
  }
  await page.getByRole('button', { name: 'Anforderung hinzufügen', exact: true }).click();
  await expect(
    page
      .getByRole('main')
      .getByTestId('qualification-coverage-row')
      .filter({ hasText: options.capabilityName }),
  ).toBeVisible({ timeout: 15_000 });
}

/** A coverage status label inside a coverage row or a warning gap row. */
export function coverageStatusLabel(scope: Locator, status: CoverageStatus, exact = false): Locator {
  return scope.getByText(getCoverageStatusLabel(status), { exact });
}

/** The strongest matching person a job coverage row names. */
export function coverageContributor(row: Locator, personName: string): Locator {
  return row.getByText(`Abgedeckt durch ${personName}`);
}

/** The coverage row's note that no assigned person matches. */
export function noCoveringPerson(row: Locator): Locator {
  return row.getByText(QUALIFICATION_COPY.noCoveringPerson);
}

/** The apprentice-alone notice in the qualification warning. */
export function apprenticeNotice(dialog: Locator): Locator {
  return dialog.getByText(QUALIFICATION_COPY.apprenticeNotice, { exact: true });
}

/** The error the qualification warning shows when the reason is empty. */
export function missingReasonError(dialog: Locator): Locator {
  return dialog.getByText(QUALIFICATION_COPY.reasonMissing);
}

/** The qualification warning's continue action. */
export function assignDespiteWarningButton(dialog: Locator): Locator {
  return dialog.getByRole('button', { name: SHARED_COPY.qualificationWarning.assignAnyway });
}

/** The validity label on an own qualification card. */
export function ownValidityLabel(card: Locator, validity: keyof typeof OWN_VALIDITY_LABELS): Locator {
  return card.getByText(OWN_VALIDITY_LABELS[validity]);
}

/** The renewal control's text, which only management offers. */
export function renewControlText(scope: Locator): Locator {
  return scope.getByText(QUALIFICATION_COPY.renew);
}

export async function assignJobWithQualificationWarning(
  page: Page,
  options: {
    jobNumber: string;
    employeeName?: string;
    teamName?: string;
    expectedStatus: CoverageStatus;
    overrideReason: string;
  },
): Promise<void> {
  await page.goto(`/auftraege/${options.jobNumber}`);
  const assignmentDialog = await openEmployeeAssignmentDialog(page);
  if (options.teamName) {
    await teamShortcut(assignmentDialog, options.teamName).click();
  } else if (options.employeeName) {
    await employeeAssignmentPicker(assignmentDialog).click();
    await employeeAssignmentSearch(page).fill(options.employeeName);
    await page
      .getByRole('listbox')
      .getByRole('option')
      .filter({ hasText: options.employeeName })
      .first()
      .click();
    await employeeAssignmentHeading(assignmentDialog).click();
  }
  await assignmentDialog.getByRole('button', { name: SHARED_COPY.action.save }).click();
  const warningDialog = qualificationWarningDialog(page);
  await expect(warningDialog).toBeVisible({ timeout: 15_000 });
  await expect(warningDialog.getByText(getCoverageStatusLabel(options.expectedStatus)).first()).toBeVisible();
  await qualificationOverrideReason(warningDialog).fill(options.overrideReason);
  await assignDespiteWarningButton(warningDialog).click();
  await expect(warningDialog).toHaveCount(0, { timeout: 15_000 });
  if (options.employeeName) {
    await page.reload();
    await expect(visibleText(page, options.employeeName)).toBeVisible({
      timeout: 15_000,
    });
  }
}
