import { expect, type Locator, type Page } from '@playwright/test';
import { PAYROLL_EXPORT_STATE_LABELS } from '../../../../lib/time-accounts/presentation';
import {
  TIME_CORRECTION_STATUS_LABELS,
  type TimeCorrectionStatus,
} from '../../../../lib/time-corrections/types';
import {
  TIME_ACTIVITY_LABELS,
  type TimeSegmentKind,
  type TimeStandbyContext,
  type TimeTravelRole,
  type TimeTravelRoute,
} from '../../../../lib/time-tracking/types';
import { expectReadyWithin, TIME_CORRECTION_READY_MS } from '../live';
import { pressKey } from './interaction';
import { memberDetailActionsButton } from './organization';
import { openMemberDetailFromList } from './personnel';
import {
  datePickerDigits,
  escapeRegExp,
  expectBannerAfter,
  pageHeader,
  selectFromSearchable,
  SHARED_COPY,
  typeIntoDatePicker,
  typeIntoDateTimeField,
  typeIntoTimeInput,
} from './shared';

/**
 * The time area's locators and copy (docs/technical/testing.md, "Write a spec
 * that stands alone"): the clock, manual entries, approvals, corrections, time
 * accounts and periods. Labels that a pure product module owns are imported;
 * the rest lives here once.
 */

const CLOCK_COPY = {
  start: 'Zeiterfassung starten',
  openRunning: 'Laufende Zeiterfassung öffnen',
  runningSheet: 'Laufende Zeiterfassung',
  moreActivities: 'Weitere Aktivitäten …',
  switchActivity: 'Aktivität wechseln',
  chooseActivity: 'Aktivität wählen',
  startActivity: 'Starten',
  workOnJob: 'Arbeit an Auftrag …',
  startWork: 'Arbeit starten',
  clockIn: 'Einstempeln',
  endCapture: 'Erfassung beenden',
  otherJob: 'Anderer Auftrag …',
  continueWork: 'Arbeit fortsetzen',
  continueAction: 'Fortsetzen',
  /** The sheet's one-tap resume after a break („Weiter mit …“). */
  resume: /^Weiter/,
  switchJobAction: /^Auftrag (wechseln|zuordnen) …$/,
  switchJob: 'Auftrag wechseln',
  switchAction: 'Wechseln',
  jobChoice: /Ohne Auftrag|Auftrag ausgewählt/,
  jobPickerHeading: /Einstempeln|Auftrag wechseln/,
  jobPickerConfirm: /Einstempeln|Wechseln/,
  travelRoute: 'Strecke',
  travelRole: 'Rolle',
  standbyContext: 'Bereitschaft',
} as const;

const TRAVEL_ROUTE_LABELS = {
  company_to_site: 'Betrieb → Einsatzort',
  home_to_site: 'Zuhause → Einsatzort',
  site_to_site: 'Einsatzort → Einsatzort',
  site_to_company: 'Einsatzort → Betrieb',
  other: 'Andere Strecke',
  unspecified: 'Nicht angegeben',
} as const satisfies Record<TimeTravelRoute, string>;

const TRAVEL_ROLE_LABELS = {
  driver: 'Selbst gefahren',
  passenger: 'Mitgefahren',
  unspecified: 'Nicht angegeben',
} as const satisfies Record<TimeTravelRole, string>;

const STANDBY_CONTEXT_LABELS = {
  on_site: 'Vor Ort',
  remote: 'Extern',
  unspecified: 'Nicht angegeben',
} as const satisfies Record<TimeStandbyContext, string>;

/** Copy of /zeiterfassung: the manual entry dialog, the history and the approvals. */
export const TIME_ENTRY_COPY = {
  pageTitle: 'Zeiterfassung',
  manualEntry: 'Manuelle Eintragung',
  date: SHARED_COPY.field.date,
  noJob: 'Kein Auftrag',
  clockOutBeforeClockIn: 'Die Einstempelzeit muss vor der Ausstempelzeit liegen.',
  overlap: /überschneidet|Überlappung/i,
  submittedForApproval: 'Antrag wurde zur Genehmigung eingereicht.',
  createdOrSubmitted: /Antrag wurde zur Genehmigung eingereicht\.|Eintrag erfolgreich erstellt!/,
  approvalsTab: /Anträge/,
  historyTab: 'Verlauf',
  entriesFound: /Einträge? gefunden/,
  noEntriesFound: 'Keine Einträge gefunden',
  allMembers: 'Alle Mitarbeiter',
  allStatuses: 'Alle',
  from: SHARED_COPY.field.rangeStart,
  to: SHARED_COPY.field.rangeEnd,
  refreshEntries: 'Einträge aktualisieren',
  approveEntry: 'Genehmigen - Eintrag bleibt erhalten',
  entryApproved: 'Der Zeiteintrag wurde genehmigt.',
  correctionReviewHeading: 'Zeitkorrekturen prüfen',
  responsibilityExpired:
    'Du bist für diese Freigabe nicht mehr verantwortlich. Die Ansicht wurde aktualisiert.',
  removalBlocked:
    'Vor dem Entfernen muss die Verantwortung für Zeitfreigaben neu zugewiesen oder auf den Standard zurückgestellt werden.',
  reassignFirst: 'Zuerst neu zuweisen',
} as const;

/** The status labels of a time entry in the history table and its filter. */
export const TIME_ENTRY_STATUS_TEXT = {
  pending: 'Ausstehend',
  approved: 'Genehmigt',
} as const;

/** Copy of the organization's time tracking rules under /einstellungen/zeiterfassung. */
export const TIME_SETTINGS_COPY = {
  breakMode: 'Art der Pausenbuchung',
  automaticBreak: 'Pause automatisch abziehen',
  automaticThreshold: 'Automatische Schwelle (Minuten)',
  automaticDuration: 'Automatische Pausendauer (Minuten)',
  save: 'Zeiterfassung speichern',
  saved: 'Die Regeln für die Zeiterfassung wurden gespeichert.',
  readOnly: 'Du kannst diese Regeln einsehen, aber nur der Admin kann sie ändern.',
} as const;

/** Copy of the P1-22 correction dialog, its review cards and its banners. */
export const TIME_CORRECTION_COPY = {
  dialogTitle: 'Zeitkorrektur',
  addTime: 'Zeit nachtragen',
  kind: 'Art der Zeitkorrektur',
  person: 'Person für Zeitkorrektur',
  submittedForReview: 'Die Korrektur wurde zur Prüfung eingereicht.',
  applied: 'Die Zeit wurde korrigiert.',
  decisionSaved: 'Die Entscheidung wurde gespeichert.',
  before: 'Bisher wirksam',
  proposed: 'Vorgeschlagen',
  approve: 'Freigeben',
  askQuestion: 'Rückfrage',
  comment: 'Kommentar',
  answer: 'Antwort',
  resubmit: 'Erneut einreichen',
  approveSelection: 'Auswahl freigeben',
  noEntryBefore: 'Kein Eintrag',
} as const;

/** The banner after a batch review of corrections. */
export function correctionBatchReviewedText(count: number): string {
  return `${count} Anträge wurden gemeinsam bearbeitet.`;
}

/** Copy of time accounts, payroll settings and periods (P1-23). */
export const TIME_ACCOUNT_COPY = {
  settingsTitle: 'Zeitregeln & Lohnexport',
  policyForm: 'Zeitregel anlegen',
  policyName: 'Name',
  policyValidFrom: SHARED_COPY.field.validFrom,
  confirmDefaultPolicy: 'Standardversion bestätigen',
  createExceptionPolicy: 'Neue Ausnahmeregel anlegen',
  openingDate: 'Eröffnungsdatum',
  openAccount: 'Konto eröffnen',
  allAccountsOpen: 'Alle Zeitkonten sind eröffnet.',
  confirmDefaultMapping: 'Standardzuordnung bestätigen',
  bueroMayRequest: 'Büro-Nutzer können Korrekturen',
  adjustmentMinutes: 'Minuten',
  adjustmentReason: SHARED_COPY.field.reason,
  adjustmentKind: 'Korrektur',
  reject: 'Ablehnen',
  month: 'Monat',
  preparePeriod: 'Periode vorbereiten',
  findings: 'Prüfhinweise',
  closeMonth: 'Monat abschließen',
  createExport: 'Deterministisches ZIP erzeugen',
  reopenForm: 'Periode wieder öffnen',
  reopen: 'Wieder öffnen',
  monthlyResults: 'Monatswerte',
  accountTitle: 'Zeitkonto',
  monthlyCloses: 'Monatsabschlüsse',
  periodsLink: 'Perioden',
  rulesLink: 'Regeln & Export',
} as const;

/** The definition terms of one monthly result in the narrow layout. */
const MONTHLY_RESULT_TERMS = ['Soll', 'Gewertet', 'Differenz', 'Schlusssaldo', 'Sollquelle'] as const;

/** A dated version line of the policy and of the payroll mapping. */
export function timeAccountVersionText(version: number): string {
  return `Version ${version}`;
}

/** The payroll mapping's current version in the settings card description. */
export function currentMappingText(version: number): string {
  return `Aktuell: ${timeAccountVersionText(version)}`;
}

/** The label of one policy version in the assignment buttons and the policy list. */
export function policyVersionLabel(policyName: string, version: number): string {
  return `${policyName} · V${version}`;
}

/** One payroll export line of a closed period. */
export function payrollExportText(version: number, state: keyof typeof PAYROLL_EXPORT_STATE_LABELS): string {
  return `${timeAccountVersionText(version)} · ${PAYROLL_EXPORT_STATE_LABELS[state]}`;
}

// ---------------------------------------------------------------------------
// The clock

/** The clock launcher while no clock runs. */
export function clockInLauncher(page: Page): Locator {
  return page.getByRole('button', { name: CLOCK_COPY.start, exact: true });
}

/** The clock launcher while a clock runs. */
export function runningClockLauncher(page: Page): Locator {
  return page.getByRole('button', { name: CLOCK_COPY.openRunning, exact: true });
}

// The job picker is deliberately a FLAT LIST (search bar + always-visible
// radio rows), not a SearchableSelect — see components/job-picker-modal.tsx.
// A row's accessible name is its full text (title + number/client/project
// line), so match by substring, never exact.
async function selectJobInPicker(dialog: ReturnType<Page['getByRole']>, jobTitle: string): Promise<void> {
  await dialog
    .getByRole('radio', { name: new RegExp(escapeRegExp(jobTitle)) })
    .first()
    .click();
}

function dialogWithHeading(page: Page, heading: string | RegExp): Locator {
  return page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: heading }) });
}

// The clock button opens a sheet of next actions (pre-Wave-3 step 3); one tap
// per transition, the job picker for job choices, "Weitere Aktivitäten …" for
// the full activity dialog. These helpers are the one home per flow.
function clockSheet(page: Page, running: boolean): Locator {
  return dialogWithHeading(page, running ? CLOCK_COPY.runningSheet : CLOCK_COPY.start);
}

async function openRunningClockSheet(page: Page): Promise<Locator> {
  await runningClockLauncher(page).click();
  const sheet = clockSheet(page, true);
  await expect(sheet).toBeVisible();
  return sheet;
}

/** Opens the full activity dialog from the running sheet ("Weitere Aktivitäten …"). */
async function openActivityDialogFromSheet(page: Page): Promise<Locator> {
  const sheet = await openRunningClockSheet(page);
  await sheet.getByRole('button', { name: CLOCK_COPY.moreActivities }).click();
  const dialog = dialogWithHeading(page, CLOCK_COPY.switchActivity);
  await expect(dialog).toBeVisible();
  return dialog;
}

/** One activity kind of the full activity dialog. */
export function activityKindButton(dialog: Locator, kind: TimeSegmentKind): Locator {
  return dialog.getByRole('button', { name: TIME_ACTIVITY_LABELS[kind], exact: true });
}

/** Switches the running clock to another activity through the full activity dialog. */
export async function switchClockActivity(page: Page, kind: TimeSegmentKind): Promise<void> {
  const dialog = await openActivityDialogFromSheet(page);
  await activityKindButton(dialog, kind).click();
  await dialog.getByRole('button', { name: CLOCK_COPY.switchActivity, exact: true }).click();
  await expect(dialog).toHaveCount(0, { timeout: 15_000 });
}

/**
 * Opens the full activity dialog from a stopped or a running clock and returns
 * it with its confirm button („Starten“ or „Aktivität wechseln“).
 */
export async function openFullActivityDialog(page: Page): Promise<{ dialog: Locator; confirm: Locator }> {
  const openButton = runningClockLauncher(page);
  const startButton = clockInLauncher(page);
  const clockControl = openButton.or(startButton);
  await expect(clockControl).toHaveCount(1);
  await expect(clockControl).toBeVisible();
  // The button is disabled and labelled "starten" until the background clock
  // read lands; the real label is only known once it is enabled.
  await expect(clockControl).toBeEnabled();
  const isOpen = await openButton.isVisible();
  await (isOpen ? openButton : startButton).click();
  // The button opens the sheet of next actions; the full activity dialog with
  // every kind and qualifier sits behind "Weitere Aktivitäten …".
  await clockSheet(page, isOpen).getByRole('button', { name: CLOCK_COPY.moreActivities }).click();
  const dialog = dialogWithHeading(page, isOpen ? CLOCK_COPY.switchActivity : CLOCK_COPY.chooseActivity);
  return {
    dialog,
    confirm: dialog.getByRole('button', {
      name: isOpen ? CLOCK_COPY.switchActivity : CLOCK_COPY.startActivity,
      exact: true,
    }),
  };
}

/** Allocates the activity of the full dialog to a job through the job picker. */
export async function chooseActivityJob(page: Page, dialog: Locator, jobTitle: string): Promise<void> {
  await dialog.getByRole('button', { name: CLOCK_COPY.jobChoice }).click();
  const picker = dialogWithHeading(page, CLOCK_COPY.jobPickerHeading);
  await picker.getByPlaceholder(SHARED_COPY.picker.searchJob).fill(jobTitle);
  await picker.getByRole('radio', { name: new RegExp(escapeRegExp(jobTitle)) }).click();
  await picker.getByRole('button', { name: CLOCK_COPY.jobPickerConfirm, exact: true }).click();
}

/** Sets the route and the role of a travel activity. */
export async function chooseTravelQualifiers(
  page: Page,
  dialog: Locator,
  qualifiers: { route: TimeTravelRoute; role: TimeTravelRole },
): Promise<void> {
  await dialog.getByLabel(CLOCK_COPY.travelRoute).click();
  await page.getByRole('option', { name: TRAVEL_ROUTE_LABELS[qualifiers.route] }).click();
  await dialog.getByLabel(CLOCK_COPY.travelRole).click();
  await page.getByRole('option', { name: TRAVEL_ROLE_LABELS[qualifiers.role] }).click();
}

/** Sets the context of a standby activity. */
export async function chooseStandbyContext(
  page: Page,
  dialog: Locator,
  context: TimeStandbyContext,
): Promise<void> {
  await dialog.getByLabel(CLOCK_COPY.standbyContext).click();
  await page.getByRole('option', { name: STANDBY_CONTEXT_LABELS[context] }).click();
}

export async function clockInOnJob(page: Page, jobTitle?: string): Promise<void> {
  await page.goto('/dashboard');
  await clockInLauncher(page).click();
  const sheet = clockSheet(page, false);
  await expect(sheet).toBeVisible();

  if (jobTitle) {
    await sheet.getByRole('button', { name: CLOCK_COPY.workOnJob }).click();
    const picker = dialogWithHeading(page, CLOCK_COPY.clockIn);
    await selectJobInPicker(picker, jobTitle);
    await picker.getByRole('button', { name: CLOCK_COPY.clockIn, exact: true }).click();
  } else {
    await sheet.getByRole('button', { name: CLOCK_COPY.startWork, exact: true }).click();
  }

  await expect(sheet).toHaveCount(0, { timeout: 15_000 });
  await expect(runningClockLauncher(page)).toBeVisible({
    timeout: 15_000,
  });
}

export async function clockOut(page: Page): Promise<void> {
  const sheet = await openRunningClockSheet(page);
  await sheet.getByRole('button', { name: CLOCK_COPY.endCapture }).click();
  await expect(clockInLauncher(page)).toBeVisible({
    timeout: 15_000,
  });
}

export async function startClockBreak(page: Page): Promise<void> {
  const sheet = await openRunningClockSheet(page);
  await sheet.getByRole('button', { name: TIME_ACTIVITY_LABELS.break, exact: true }).click();
  await expect(sheet).toHaveCount(0, { timeout: 15_000 });
  // The pill above the button names the running break.
  await expect(page.getByRole('button', { name: new RegExp(`^${TIME_ACTIVITY_LABELS.break}`) })).toBeVisible({
    timeout: 15_000,
  });
}

export async function endClockBreak(page: Page, jobTitle?: string): Promise<void> {
  const sheet = await openRunningClockSheet(page);
  if (jobTitle) {
    await sheet.getByRole('button', { name: CLOCK_COPY.otherJob }).click();
    const picker = dialogWithHeading(page, CLOCK_COPY.continueWork);
    await selectJobInPicker(picker, jobTitle);
    await picker.getByRole('button', { name: CLOCK_COPY.continueAction, exact: true }).click();
  } else {
    await sheet.getByRole('button', { name: CLOCK_COPY.resume }).first().click();
  }
  await expect(sheet).toHaveCount(0, { timeout: 15_000 });
}

export async function switchClockJob(page: Page, jobTitle: string): Promise<void> {
  const sheet = await openRunningClockSheet(page);
  await sheet.getByRole('button', { name: CLOCK_COPY.switchJobAction }).click();
  const picker = dialogWithHeading(page, CLOCK_COPY.switchJob);
  await selectJobInPicker(picker, jobTitle);
  await picker.getByRole('button', { name: CLOCK_COPY.switchAction, exact: true }).click();
  await expect(sheet).toHaveCount(0, { timeout: 15_000 });
}

/** Time tracking: the hero and summary copy of /zeiterfassung. */
export const TIME_PAGE_TEXT = {
  notClockedIn: 'Du bist nicht eingestempelt.',
  working: 'Du arbeitest gerade.',
  onBreak: 'Du machst gerade Pause.',
  workTime: 'Arbeitszeit',
  breakTime: 'Pause',
  overtimeToday: 'Überstunden heute',
  clockedInElsewhere: 'Bereits in anderer Organisation eingestempelt',
} as const;

/** The accessible name and title of a daily time summary bar. */
export const DAILY_TIME_SUMMARY_NAME = /Anwesenheit.*Arbeitszeit.*Pause.*Überstunden/;

/** Every daily time summary bar of the week view. */
export function dailyTimeSummaries(page: Page): Locator {
  return page.getByRole('img', { name: DAILY_TIME_SUMMARY_NAME });
}

/** The first summary bar of the week view, the subject of a seven-day assertion. */
export function firstDailyTimeSummary(page: Page): Locator {
  return dailyTimeSummaries(page).first();
}

/** The heading of the sheet that the stopped clock opens. */
export function clockInSheetHeading(page: Page): Locator {
  return page.getByRole('heading', { name: CLOCK_COPY.start });
}

/** The stopped clock sheet's one-tap start without a job („Arbeit starten“). */
export function clockInConfirmationButton(page: Page): Locator {
  return clockSheet(page, false).getByRole('button', { name: CLOCK_COPY.startWork, exact: true });
}

// ---------------------------------------------------------------------------
// Manual entries

/** The „Manuelle Eintragung“ action of the page header beside the title „Zeiterfassung“. */
export function manualEntryHeaderButton(page: Page): Locator {
  return pageHeader(page)
    .filter({ has: page.getByRole('heading', { level: 1, name: TIME_ENTRY_COPY.pageTitle }) })
    .getByRole('button', { name: TIME_ENTRY_COPY.manualEntry });
}

/** The manual entry action wherever /zeiterfassung renders it. */
export function manualEntryButton(page: Page): Locator {
  return page.getByRole('button', { name: TIME_ENTRY_COPY.manualEntry });
}

/** Types the date, the clock-in and the clock-out time of an open manual entry dialog. */
export async function fillManualEntryInterval(
  dialog: Locator,
  interval: { dateDigits: string; clockInDigits: string; clockOutDigits: string },
): Promise<void> {
  await typeIntoDatePicker(dialog, TIME_ENTRY_COPY.date, interval.dateDigits);
  await fillManualEntryTimes(dialog, interval);
}

/** The member picker of a manual entry form, which only managers see. */
export function manualEntryMemberPicker(dialog: Locator): Locator {
  return dialog.locator('#manual-entry-member');
}

/** Types the clock-in and the clock-out time (HHMM digits) of an open manual entry form. */
export async function fillManualEntryTimes(
  dialog: Locator,
  times: { clockInDigits: string; clockOutDigits: string },
): Promise<void> {
  await typeIntoTimeInput(dialog, 'clockInTime', times.clockInDigits);
  await typeIntoTimeInput(dialog, 'clockOutTime', times.clockOutDigits);
}

/** Picks the job of an open manual entry dialog by its number. */
export async function selectManualEntryJob(page: Page, dialog: Locator, jobNumber: string): Promise<void> {
  await dialog.getByRole('combobox').filter({ hasText: TIME_ENTRY_COPY.noJob }).click();
  await page.getByPlaceholder(SHARED_COPY.picker.searchJob).fill(jobNumber);
  await page.getByRole('listbox').getByRole('option').filter({ hasText: jobNumber }).click();
}

export async function createOwnManualTimeEntry(
  page: Page,
  options: {
    memberName?: string;
    dateDigits: string;
    clockInDigits: string;
    clockOutDigits: string;
  },
): Promise<void> {
  await page.goto('/zeiterfassung');
  await manualEntryButton(page).click();
  const dialog = page.getByRole('dialog');
  if (options.memberName) {
    await selectFromSearchable(page, manualEntryMemberPicker(dialog), options.memberName);
  }
  await fillManualEntryInterval(dialog, options);
  await dialog.getByRole('button', { name: SHARED_COPY.action.save, exact: true }).click();
  // Close-then-banner: the dialog closes immediately and the global banner
  // confirms the save (M5).
  await expect(page.getByText(TIME_ENTRY_COPY.createdOrSubmitted)).toBeVisible({ timeout: 15_000 });
  await expect(dialog).toHaveCount(0, { timeout: 15_000 });
}

// ---------------------------------------------------------------------------
// History

/** The history tab of /zeiterfassung. */
export function timeHistoryTab(page: Page): Locator {
  return page.getByRole('tab', { name: TIME_ENTRY_COPY.historyTab });
}

/** The history tab's panel. */
export function timeHistoryPanel(page: Page): Locator {
  return page.getByRole('tabpanel', { name: TIME_ENTRY_COPY.historyTab });
}

/** A history filter that currently shows this text (a member, a status or „Alle“). */
export function timeHistoryFilter(history: Locator, showing: string | RegExp): Locator {
  return history.getByRole('combobox').filter({ hasText: showing });
}

/** Sets the status filter of the history. */
export async function selectTimeHistoryStatus(
  page: Page,
  filter: Locator,
  status: keyof typeof TIME_ENTRY_STATUS_TEXT,
): Promise<void> {
  await filter.click();
  await page.getByRole('option', { name: TIME_ENTRY_STATUS_TEXT[status], exact: true }).click();
}

/** Sets the history's date range to one day. */
export async function setTimeHistoryDay(history: Locator, dateDigits: string): Promise<void> {
  await typeIntoDatePicker(history, TIME_ENTRY_COPY.from, dateDigits);
  await typeIntoDatePicker(history, TIME_ENTRY_COPY.to, dateDigits);
}

/** Reloads the history with the current filters. */
export function refreshTimeHistoryButton(history: Locator): Locator {
  return history.getByRole('button', { name: TIME_ENTRY_COPY.refreshEntries });
}

/** The rows of the history table. */
export function timeHistoryRows(history: Locator): Locator {
  return history.locator('tbody tr');
}

// ---------------------------------------------------------------------------
// Approvals

/** The approvals panel of /zeiterfassung; it marks itself `data-loaded` once its read landed. */
export function pendingApprovalsPanel(page: Page): Locator {
  return page.getByRole('main').getByTestId('pending-approvals-panel');
}

/** The approvals tab of /zeiterfassung („Anträge“ with its count). */
export function timeApprovalsTab(page: Page): Locator {
  return page.getByRole('tab', { name: TIME_ENTRY_COPY.approvalsTab });
}

export async function openTimeApprovals(page: Page): Promise<void> {
  await page.goto('/zeiterfassung?tab=approvals');
  await expect(timeApprovalsTab(page)).toHaveAttribute('aria-selected', 'true', {
    timeout: 15_000,
  });
  await expect(pendingApprovalsPanel(page)).toHaveAttribute('data-loaded', 'true', {
    timeout: 30_000,
  });
}

export async function expectTimeApprovalsUnavailable(page: Page): Promise<void> {
  await page.goto('/zeiterfassung?tab=approvals');
  await expect(timeApprovalsTab(page)).toHaveAttribute('aria-selected', 'true', {
    timeout: 15_000,
  });
  await expect(page.getByTestId('pending-approvals-panel')).toHaveCount(0, {
    timeout: 15_000,
  });
  await expect(page.getByRole('heading', { name: TIME_ENTRY_COPY.correctionReviewHeading })).toHaveCount(0, {
    timeout: 15_000,
  });
}

function pendingTimeApprovalCard(page: Page, userId: string): Locator {
  return page.locator(`[data-testid^="pending-session-"][data-user-id="${userId}"]`);
}

export async function expectPendingTimeApprovalVisible(page: Page, userId: string): Promise<void> {
  await expect(pendingTimeApprovalCard(page, userId)).toBeVisible({
    timeout: 15_000,
  });
}

export async function expectPendingTimeApprovalHidden(page: Page, userId: string): Promise<void> {
  await expect(pendingTimeApprovalCard(page, userId)).toHaveCount(0, {
    timeout: 15_000,
  });
}

export async function approvePendingTimeEntry(
  page: Page,
  userId: string,
  visibleText?: string | RegExp,
): Promise<void> {
  const cards = pendingTimeApprovalCard(page, userId);
  const card = visibleText ? cards.filter({ hasText: visibleText }) : cards;
  await expect(card).toHaveCount(1, { timeout: 15_000 });
  // The card leaves with the click, before the server answers. The banner is
  // the confirmation, and a fresh read of the approvals proves the decision
  // persisted.
  await expectBannerAfter(page, TIME_ENTRY_COPY.entryApproved, () =>
    card.getByTitle(TIME_ENTRY_COPY.approveEntry).click(),
  );
  await openTimeApprovals(page);
  await expect(card).toHaveCount(0, { timeout: 15_000 });
}

export async function expectExpiredResponsibilityDeniedAtAction(page: Page, userId: string): Promise<void> {
  const card = pendingTimeApprovalCard(page, userId);
  await card.getByTitle(TIME_ENTRY_COPY.approveEntry).click();
  await expect(page.getByText(TIME_ENTRY_COPY.responsibilityExpired)).toBeVisible({ timeout: 15_000 });
  await expect(card).toHaveCount(0, { timeout: 15_000 });
}

export async function expectMemberRemovalBlockedByResponsibility(
  page: Page,
  memberName: string,
): Promise<void> {
  await openMemberDetailFromList(page, memberName);
  await memberDetailActionsButton(page).click();
  await page.getByRole('menuitem', { name: SHARED_COPY.action.remove }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog.getByText(TIME_ENTRY_COPY.removalBlocked)).toBeVisible({ timeout: 15_000 });
  await expect(dialog.getByRole('button', { name: TIME_ENTRY_COPY.reassignFirst })).toBeDisabled();
}

/** A pending submission of the approvals panel that shows this text (a job title). */
export function pendingSubmission(page: Page, text: string): Locator {
  return page
    .getByRole('main')
    .getByTestId(/pending-session-/)
    .filter({ hasText: text });
}

// ---------------------------------------------------------------------------
// Rules of the organization (/einstellungen/zeiterfassung)

/** The break mode select of the time tracking rules. */
export function breakModeSelect(page: Page): Locator {
  return page.getByLabel(TIME_SETTINGS_COPY.breakMode);
}

/** Switches the rules to an automatic break and saves them. */
export async function saveAutomaticBreakRule(
  page: Page,
  rule: { thresholdMinutes: number; durationMinutes: number },
): Promise<void> {
  await breakModeSelect(page).click();
  await page.getByRole('option', { name: TIME_SETTINGS_COPY.automaticBreak }).click();
  // The minute fields dropped type="number" (M4 canon migration): textbox
  // role with inputMode="numeric", zod keeps the bounds.
  await page
    .getByRole('textbox', { name: TIME_SETTINGS_COPY.automaticThreshold })
    .fill(String(rule.thresholdMinutes));
  await page
    .getByRole('textbox', { name: TIME_SETTINGS_COPY.automaticDuration })
    .fill(String(rule.durationMinutes));
  await page.getByRole('button', { name: TIME_SETTINGS_COPY.save }).click();
}

// ---------------------------------------------------------------------------
// Corrections (P1-22)

/** The correction dialog, named by its title. */
export function timeCorrectionDialog(page: Page): Locator {
  return dialogWithHeading(page, TIME_CORRECTION_COPY.dialogTitle);
}

/**
 * Opens „Zeit nachtragen“ on the history and measures until the correction kind
 * is usable; `observation` names the recorded readiness observation.
 */
/** The correction kind field: the control that shows the dialog is usable. */
export function timeCorrectionKindField(dialog: Locator): Locator {
  return dialog.getByRole('combobox', { name: TIME_CORRECTION_COPY.kind, exact: true });
}

/** The history's „add missed time“ button that opens the correction dialog. */
export function addMissedTimeButton(page: Page): Locator {
  return page.getByRole('button', { name: TIME_CORRECTION_COPY.addTime });
}

export async function openMissedTimeDialog(page: Page, observation: string): Promise<Locator> {
  const dialog = timeCorrectionDialog(page);
  await expectReadyWithin(timeCorrectionKindField(dialog), {
    label: observation,
    targetMs: TIME_CORRECTION_READY_MS,
    trigger: () => addMissedTimeButton(page).click({ timeout: 10_000 }),
  });
  return dialog;
}

/** Fills an open missed-time correction; a person is chosen only for someone else's time. */
export async function fillMissedTime(
  page: Page,
  dialog: Locator,
  input: { date: string; from: string; to: string; reason: string; personName?: string },
): Promise<void> {
  const bounded = { timeout: 5_000 };
  if (input.personName) {
    await selectFromSearchable(
      page,
      dialog.getByRole('combobox', { name: TIME_CORRECTION_COPY.person }),
      input.personName,
    );
  }
  await typeIntoDateTimeField(dialog, 'time-correction-start', `${input.date}T${input.from}`, bounded);
  await typeIntoDateTimeField(dialog, 'time-correction-end', `${input.date}T${input.to}`, bounded);
  await dialog.getByLabel(SHARED_COPY.field.reason).fill(input.reason, bounded);
}

/** The save button of the correction dialog; it submits the dialog's form by its form attribute. */
export function timeCorrectionSaveButton(dialog: Locator): Locator {
  return dialog.getByRole('button', { name: SHARED_COPY.action.save, exact: true });
}

/** A correction's card on the history or the approvals, by request id. */
export function timeCorrectionCard(page: Page, requestId: string): Locator {
  return page.getByRole('main').getByTestId(`time-correction-${requestId}`);
}

/** The status badge of a correction card. */
export function timeCorrectionStatus(card: Locator, status: TimeCorrectionStatus): Locator {
  return card.getByText(TIME_CORRECTION_STATUS_LABELS[status], { exact: true });
}

/** Approves one correction from its card. */
export function approveCorrectionButton(card: Locator): Locator {
  return card.getByRole('button', { name: TIME_CORRECTION_COPY.approve });
}

/** Asks the employee a question about one correction. */
export async function askCorrectionQuestion(card: Locator, comment: string): Promise<void> {
  await card.getByLabel(TIME_CORRECTION_COPY.comment).fill(comment);
  await card.getByRole('button', { name: TIME_CORRECTION_COPY.askQuestion }).click();
}

/** Answers a question about one correction and resubmits it. */
export async function answerCorrectionQuestion(card: Locator, answer: string): Promise<void> {
  await card.getByLabel(TIME_CORRECTION_COPY.answer).fill(answer);
  await card.getByRole('button', { name: TIME_CORRECTION_COPY.resubmit }).click();
}

/** Approves every selected correction at once. */
export function approveSelectedCorrectionsButton(page: Page): Locator {
  return page.getByRole('button', { name: TIME_CORRECTION_COPY.approveSelection });
}

// ---------------------------------------------------------------------------
// Corrections from the calendar

const CALENDAR_CORRECTION_COPY = {
  correctWorkTime: 'Arbeitszeit korrigieren',
  submitCorrection: 'Korrektur einreichen',
} as const;

/**
 * Types a time into a segmented time group (hours, then minutes). Each key goes
 * into the group through pressKey, which settles the dialog first.
 */
export async function typeIntoTimeGroup(dialog: Locator, group: Locator, digits: string): Promise<void> {
  if (!/^\d{4}$/.test(digits)) throw new Error('typeIntoTimeGroup requires exactly four HHMM digits');
  await group.focus();
  await pressKey(dialog, 'ArrowLeft', { into: group });
  await pressKey(dialog, 'Delete', { into: group });
  await group.pressSequentially(digits.slice(0, 2), { delay: 50 });
  await pressKey(dialog, 'ArrowRight', { into: group });
  await pressKey(dialog, 'Delete', { into: group });
  await group.pressSequentially(digits.slice(2), { delay: 50 });
}

/** The correction dialog that a calendar move or resize opens. */
export function calendarTimeCorrectionDialog(page: Page): Locator {
  return page.getByRole('dialog', { name: CALENDAR_CORRECTION_COPY.correctWorkTime });
}

/** Gives the calendar correction its reason and submits it. */
export async function submitCalendarTimeCorrection(dialog: Locator, reason: string): Promise<void> {
  await dialog.getByLabel(SHARED_COPY.field.reason).fill(reason);
  await dialog.getByRole('button', { name: CALENDAR_CORRECTION_COPY.submitCorrection }).click();
}

// ---------------------------------------------------------------------------
// Time accounts and periods (P1-23)

/** The main region of /zeiterfassung/einstellungen, proven by its title. */
export function timeAccountSettings(page: Page): Locator {
  return page
    .getByRole('main')
    .filter({ has: page.getByRole('heading', { name: TIME_ACCOUNT_COPY.settingsTitle }) });
}

/** The policy form: the default version and exception policies. */
function timePolicyForm(settings: Locator): Locator {
  return settings.getByRole('form', { name: TIME_ACCOUNT_COPY.policyForm });
}

/** Confirms the default policy version from a date. */
export async function confirmDefaultTimePolicy(settings: Locator, validFrom: string): Promise<void> {
  const form = timePolicyForm(settings);
  await typeIntoDatePicker(form, TIME_ACCOUNT_COPY.policyValidFrom, datePickerDigits(validFrom));
  await form.getByRole('button', { name: TIME_ACCOUNT_COPY.confirmDefaultPolicy }).click();
}

/** Creates a named exception policy from a date. */
export async function createExceptionTimePolicy(
  settings: Locator,
  input: { name: string; validFrom: string },
): Promise<void> {
  const form = timePolicyForm(settings);
  await form.getByLabel(TIME_ACCOUNT_COPY.policyName).fill(input.name);
  await typeIntoDatePicker(form, TIME_ACCOUNT_COPY.policyValidFrom, datePickerDigits(input.validFrom));
  await form.getByRole('button', { name: TIME_ACCOUNT_COPY.createExceptionPolicy }).click();
}

function openingBalanceLabel(employeeName: string): string {
  return `Anfangssaldo in Minuten für ${employeeName}`;
}

// One table row per person; its fields join the row's form by the form attribute.
function openingBalanceRow(settings: Locator, employeeName: string): Locator {
  return settings
    .getByRole('row')
    .filter({ has: settings.page().getByLabel(openingBalanceLabel(employeeName)) });
}

/** Types the opening date and balance of one person's missing time account. */
export async function fillOpeningBalance(
  settings: Locator,
  employeeName: string,
  input: { openedOn: string; minutes: number },
): Promise<void> {
  const row = openingBalanceRow(settings, employeeName);
  await typeIntoDatePicker(row, TIME_ACCOUNT_COPY.openingDate, datePickerDigits(input.openedOn));
  await row.getByLabel(openingBalanceLabel(employeeName)).fill(String(input.minutes));
}

/** The open action of one person's missing time account. */
export function openAccountButton(settings: Locator, employeeName: string): Locator {
  return openingBalanceRow(settings, employeeName).getByRole('button', {
    name: TIME_ACCOUNT_COPY.openAccount,
  });
}

/** Confirms the default payroll mapping. */
export function confirmDefaultMappingButton(settings: Locator): Locator {
  return settings.getByRole('button', { name: TIME_ACCOUNT_COPY.confirmDefaultMapping });
}

/** Assigns a policy version to one person from a date. */
export async function assignTimePolicy(
  settings: Locator,
  employeeName: string,
  input: { policyLabel: string; validFrom: string },
): Promise<void> {
  const dateName = `Regel gültig ab für ${employeeName}`;
  // One table row per person; its fields join the row's form by the form attribute.
  const row = settings
    .getByRole('row')
    .filter({ has: settings.page().getByRole('group', { name: dateName }) });
  await typeIntoDatePicker(row, dateName, datePickerDigits(input.validFrom));
  await row.getByRole('button', { name: input.policyLabel }).click();
}

/** Requests a manual adjustment of one person's time account. */
export async function requestTimeAccountAdjustment(
  settings: Locator,
  employeeName: string,
  input: { minutes: number; reason: string; effectiveDate: string },
): Promise<void> {
  const dateName = `Wirksamkeitsdatum für ${employeeName}`;
  const row = settings
    .getByRole('row')
    .filter({ has: settings.page().getByRole('group', { name: dateName }) });
  await row.getByLabel(TIME_ACCOUNT_COPY.adjustmentMinutes).fill(String(input.minutes));
  await row.getByLabel(TIME_ACCOUNT_COPY.adjustmentReason).fill(input.reason);
  await typeIntoDatePicker(row, dateName, datePickerDigits(input.effectiveDate));
  await row.getByRole('button', { name: TIME_ACCOUNT_COPY.adjustmentKind }).click();
}

/** Rejects one person's pending adjustment with a reason. */
export async function rejectTimeAccountAdjustment(
  settings: Locator,
  employeeName: string,
  reason: string,
): Promise<void> {
  const form = settings.getByRole('form', { name: `Entscheidung für ${employeeName}`, exact: true });
  await form.getByLabel(`Entscheidungsgrund für ${employeeName}`).fill(reason);
  await form.getByRole('button', { name: TIME_ACCOUNT_COPY.reject }).click();
}

/** Prepares (or recalculates) the period of one month from the period list. */
export async function preparePeriodMonth(page: Page, month: string): Promise<void> {
  await page.goto('/zeiterfassung/perioden');
  await page.getByLabel(TIME_ACCOUNT_COPY.month).fill(month);
  await page.getByRole('button', { name: TIME_ACCOUNT_COPY.preparePeriod }).click();
}

/** The findings heading of a period detail. */
export function periodFindingsHeading(page: Page): Locator {
  return page.getByRole('heading', { name: TIME_ACCOUNT_COPY.findings });
}

/** The close action of a period detail. */
export function closeMonthButton(page: Page): Locator {
  return page.getByRole('button', { name: TIME_ACCOUNT_COPY.closeMonth });
}

/** The payroll export action of a closed period. */
export function createPayrollExportButton(page: Page): Locator {
  return page.getByRole('button', { name: TIME_ACCOUNT_COPY.createExport });
}

/** Reopens a closed period with a reason. */
export async function reopenPeriod(page: Page, reason: string): Promise<void> {
  const form = page.getByRole('form', { name: TIME_ACCOUNT_COPY.reopenForm });
  await form.getByRole('textbox').fill(reason);
  await form.getByRole('button', { name: TIME_ACCOUNT_COPY.reopen }).click();
}

/** The monthly results section of a period detail. */
export function monthlyResults(page: Page): Locator {
  return page.getByRole('region', { name: TIME_ACCOUNT_COPY.monthlyResults, exact: true });
}

/** One person's monthly result in the narrow (list) layout. */
export function monthlyResultListRow(results: Locator, employeeName: string): Locator {
  return results.locator('[data-slot="list-row"]').filter({ hasText: employeeName });
}

/** Every definition term one monthly result shows in the narrow layout. */
export function monthlyResultTerms(row: Locator): Locator[] {
  return MONTHLY_RESULT_TERMS.map((term) => row.locator('dt').filter({ hasText: new RegExp(`^${term}$`) }));
}

/** The headings of the employee's own time account page. */
export function timeAccountHeadings(page: Page): { account: Locator; monthlyCloses: Locator } {
  return {
    account: page.getByRole('heading', { name: TIME_ACCOUNT_COPY.accountTitle }),
    monthlyCloses: page.getByRole('heading', { name: TIME_ACCOUNT_COPY.monthlyCloses }),
  };
}

/** The time area's header: title, subpage navigation and the time account subpage heading. */
export const TIME_AREA_HEADER = {
  title: TIME_ENTRY_COPY.pageTitle,
  navigation: 'Arbeitszeitmanagement',
  subpageHeading: TIME_ACCOUNT_COPY.accountTitle,
} as const;

const PERIOD_LIST_COPY = {
  heading: 'Abrechnungsperioden',
  open: 'Öffnen',
} as const;

/** The heading of the period list. */
export function periodListHeading(content: Locator): Locator {
  return content.getByRole('heading', { name: PERIOD_LIST_COPY.heading, exact: true });
}

/** The links that open one period of the list. */
export function periodOpenLinks(content: Locator): Locator {
  return content.getByRole('link', { name: PERIOD_LIST_COPY.open, exact: true });
}

/** The time area's navigation links that depend on responsibility and role. */
export function timeAccountNavigation(page: Page): { periods: Locator; rules: Locator } {
  return {
    periods: page.getByRole('link', { name: TIME_ACCOUNT_COPY.periodsLink }),
    rules: page.getByRole('link', { name: TIME_ACCOUNT_COPY.rulesLink }),
  };
}
