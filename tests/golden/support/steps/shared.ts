import { expect, type Locator, type Page } from '@playwright/test';
import {
  UNCONFIRMED_LAYER_SIGNAL,
  UNCONFIRMED_SIGNAL,
} from '../../../../lib/testing/spec-support/busy-signals';
import { retryBeforeSubmit } from '../../../../lib/testing/spec-support/retry-before-submit';
import { pressKey } from './interaction';

/**
 * Copy of the controls that several product areas share, in one place
 * (docs/technical/testing.md, "Write a spec that stands alone"). A deliberate
 * rename is one edit here. Copy that one area owns lives in that area's module;
 * a label that a pure product module owns is imported from it instead.
 */
/** The calendar button every date picker (`components/ui/date-picker.tsx`) renders. */
const DATE_PICKER_CALENDAR_BUTTON = 'Kalender öffnen';

export const SHARED_COPY = {
  /** Generic dialog and form actions. */
  action: {
    save: 'Speichern',
    saveChange: 'Änderung speichern',
    cancel: 'Abbrechen',
    close: 'Schließen',
    edit: 'Bearbeiten',
    delete: 'Löschen',
    remove: 'Entfernen',
    create: 'Erstellen',
    add: 'Hinzufügen',
    next: 'Weiter',
    new: 'Neu',
    openActions: 'Aktionen öffnen',
    retry: 'Erneut laden',
    /** Cancels a decided record: an approved vacation, a sickness report, an invitation. */
    cancelRecord: 'Stornieren',
    /** Links an exact record (work, evidence, approval). */
    link: 'Verknüpfen',
  },
  /** Generic field labels. */
  field: {
    title: 'Titel',
    name: 'Bezeichnung',
    reason: 'Grund',
    summary: 'Zusammenfassung',
    /** The two date pickers of a date range (vacation, sickness, time history). */
    rangeStart: 'Von',
    rangeEnd: 'Bis',
    /** A single date picker (planned date, exit date, manual entry). */
    date: 'Datum',
    /** The start of a dated version (conditions, schedules, delegations, time policies). */
    validFrom: 'Gültig ab',
  },
  /** Section and region names that several pages render. */
  region: {
    details: 'Details',
    documents: 'Dokumente & Bilder',
    /** The page header's breadcrumb navigation. */
    breadcrumb: 'Pfad',
  },
  /** The employee assignment picker (work, planning, dispatch, qualifications). */
  assignment: {
    assignEmployee: 'Mitarbeiter zuweisen',
    searchEmployee: 'Mitarbeiter suchen…',
    assign: 'Zuweisen',
  },
  /** The qualification warning before an assignment (qualifications, work, requests). */
  qualificationWarning: {
    review: 'Zuweisung prüfen',
    assignAnyway: 'Trotz Hinweis zuweisen',
  },
  /** The planning warning confirmation (planning, dispatch, calendar). */
  planningWarning: {
    title: 'Planungshinweise prüfen',
    saveWithReason: 'Mit Begründung speichern',
    revertChange: 'Änderung zurücknehmen',
  },
  /** Record pickers that several forms embed. */
  picker: {
    searchCustomer: 'Kunde suchen…',
    searchJob: 'Auftrag suchen…',
    /** The project picker's search (work, documents). */
    searchProject: 'Projekt suchen…',
    /** The customer picker's trigger text while no customer is chosen (work, requests). */
    noCustomer: 'Kein Kunde',
  },
  /** The document upload dialog that every „Dokumente & Bilder“ frame opens (documents, work). */
  upload: {
    failed: 'Upload fehlgeschlagen.',
  },
  /** The ListPagination control under paged lists (components/shared/list-pagination.tsx) and the calendar's period steps. */
  pagination: {
    count: 'Eintragsanzahl',
    previous: 'Zurück',
  },
} as const;

/**
 * Marks text the test itself writes: a run-scoped record name, a note or a
 * reason (testData`Kundendienst ${world.runId}`). It is data the spec owns, not
 * product copy, so a spec may assert it directly. Never wrap product wording.
 */
export function testData(parts: TemplateStringsArray, ...values: Array<string | number>): string {
  return parts.reduce((text, part, index) => `${text}${part}${values[index] ?? ''}`, '');
}

/** The job's employee assignment dialog, named by its heading. */
function employeeAssignmentDialog(page: Page): Locator {
  return page.getByRole('dialog').filter({
    has: employeeAssignmentHeading(page),
  });
}

/** The assignment dialog's heading; clicking it closes the picker popover inside the dialog. */
export function employeeAssignmentHeading(scope: Page | Locator): Locator {
  return scope.getByRole('heading', { name: SHARED_COPY.assignment.assignEmployee });
}

/** Opens the assignment dialog from the job detail's „Zuweisen“ action. */
export async function openEmployeeAssignmentDialog(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: SHARED_COPY.assignment.assign, exact: true }).click();
  return employeeAssignmentDialog(page);
}

/** The summary an employee multi-select shows for its selection („1 Mitarbeiter“). */
export function employeeSelectionSummary(count: number): string {
  return `${count} Mitarbeiter`;
}

/**
 * The employee multi-select trigger inside a form. Without a count it shows its
 * placeholder; with a count it shows the selection summary („1 Mitarbeiter“).
 */
export function employeeAssignmentPicker(scope: Page | Locator, selectedCount?: number): Locator {
  const summary =
    selectedCount === undefined
      ? SHARED_COPY.assignment.assignEmployee
      : employeeSelectionSummary(selectedCount);
  return scope.getByRole('combobox').filter({ hasText: summary });
}

/** The search field of an open employee picker; the popover renders outside the form. */
export function employeeAssignmentSearch(page: Page): Locator {
  return page.getByPlaceholder(SHARED_COPY.assignment.searchEmployee);
}

/** The qualification warning that interrupts an assignment with uncovered requirements. */
export function qualificationWarningDialog(page: Page): Locator {
  return page.getByRole('dialog').filter({
    has: page.getByRole('heading', { name: SHARED_COPY.qualificationWarning.review }),
  });
}

/** The warning's reason field for assigning despite the warning. */
export function qualificationOverrideReason(warning: Locator): Locator {
  return warning.locator('#qualification-override-reason');
}

/** Waits for the qualification warning, gives the override reason and assigns anyway; returns the warning. */
export async function assignDespiteQualificationWarning(page: Page, reason: string): Promise<Locator> {
  const warning = qualificationWarningDialog(page);
  await expect(warning).toBeVisible({ timeout: 15_000 });
  await qualificationOverrideReason(warning).fill(reason);
  await warning.getByRole('button', { name: SHARED_COPY.qualificationWarning.assignAnyway }).click();
  return warning;
}

/** The planning warning confirmation after a planning change. */
export function planningWarningDialog(page: Page): Locator {
  return page.getByRole('dialog').filter({
    has: page.getByRole('heading', { name: SHARED_COPY.planningWarning.title }),
  });
}

/** The customer picker of a work or request form while it shows no customer. */
export function customerPicker(scope: Page | Locator): Locator {
  return scope.getByRole('combobox').filter({ hasText: SHARED_COPY.picker.noCustomer });
}

/** The search field of the open customer picker; the popover renders outside the form. */
export function customerPickerSearch(page: Page): Locator {
  return page.getByPlaceholder(SHARED_COPY.picker.searchCustomer);
}

/** The search field of the open job picker; the popover renders outside the form. */
export function jobPickerSearch(page: Page): Locator {
  return page.getByPlaceholder(SHARED_COPY.picker.searchJob);
}

/** The page header of the open page (title, breadcrumb, actions, area navigation). */
export function pageHeader(page: Page): Locator {
  return page.getByRole('main').locator('[data-page-header]');
}

/** The actions menu trigger in the page header of a customer, project or job detail. */
export function detailActionsButton(page: Page): Locator {
  return pageHeader(page).getByRole('button', { name: SHARED_COPY.action.openActions });
}

/**
 * The confirmed state of a record (testing.md, "Spec checklist"): the row,
 * card or value the locator finds, minus every match that shows an optimistic
 * layer's content. A match is unconfirmed when it carries `data-unconfirmed`
 * (lib/ui/unconfirmed.ts), sits inside an element that does, or contains one
 * (an active `InlinePending`). An assertion on the result therefore waits for
 * the authoritative read, and fails when that read disagrees with the echo.
 * Every record locator of the area modules returns through it
 * (lib/testing/spec-support/confirmed-locators.test.ts).
 */
export function confirmed(locator: Locator): Locator {
  const page = locator.page();
  return locator
    .and(page.locator(`:not([${UNCONFIRMED_SIGNAL}]):not([${UNCONFIRMED_SIGNAL}] *)`))
    .filter({ hasNot: page.locator(`[${UNCONFIRMED_SIGNAL}]`) });
}

/**
 * The absence of a record after a change. A confirmed locator finds nothing
 * while its record is unconfirmed, and an optimistic removal leaves nothing
 * to mark, so absence is asserted only once no unconfirmed content and no
 * optimistic layer remain on the page.
 */
export async function expectGone(locator: Locator, options: { timeout?: number } = {}): Promise<void> {
  const page = locator.page();
  await expect(
    page.locator(`html[${UNCONFIRMED_LAYER_SIGNAL}], [${UNCONFIRMED_SIGNAL}]`),
    'No unconfirmed content or optimistic layer remains',
  ).toHaveCount(0, options);
  await expect(locator).toHaveCount(0, options);
}

/**
 * The optimistic row of a record that is still being saved, by a text it
 * shows; its marker clears when the confirmed row replaces it. A pending-state
 * locator by purpose (PENDING_STATE_LOCATORS in confirmed-locators.test.ts).
 */
export function pendingRow(page: Page, text: string): Locator {
  return page.locator('[data-pending-row]').filter({ hasText: text });
}

/** The „Details“ card of a job or project detail (a MetadataSection named by its title). */
export function detailsRegion(scope: Page | Locator): Locator {
  return scope.getByRole('region', { name: SHARED_COPY.region.details, exact: true });
}

/**
 * One field row of a MetadataSection card, named by its label, in display and
 * edit mode alike. Exact: a row „Geplantes Datum“ contains a date group „Datum“.
 */
export function metadataField(section: Locator, label: string): Locator {
  return section.getByRole('group', { name: label, exact: true });
}

/** The pagination navigation of one list; each list names its pager. */
export function listPager(page: Page, pagerName: string): Locator {
  return page.getByRole('navigation', { name: pagerName, exact: true });
}

/** The pager's entry count status („1–50 von 61“). */
export function pagerCount(pager: Locator): Locator {
  return pager.getByRole('status', { name: SHARED_COPY.pagination.count, exact: true });
}

export function pagerButton(pager: Locator, direction: 'previous' | 'next'): Locator {
  const name = direction === 'previous' ? SHARED_COPY.pagination.previous : SHARED_COPY.action.next;
  return pager.getByRole('button', { name, exact: true });
}

/** The text of the entry count status for one page. */
export function pagerRange(first: number, last: number, total: number): string {
  return `${pagerRangeStart(first, last)} ${total}`;
}

/** The entry count status of one page up to its total („1–50 von“), for a total the test does not fix. */
export function pagerRangeStart(first: number, last: number): string {
  return `${first}–${last} von`;
}

/** The retry button of a region whose read failed (SectionError). */
export function retryButton(scope: Page | Locator): Locator {
  return scope.getByRole('button', { name: SHARED_COPY.action.retry, exact: true });
}

// Pages often render the same text twice (desktop table + hidden mobile card);
// assertions must target the visible instance.
/** First visible match of a pattern; responsive views can render the same text twice. */
export function visibleMatchingText(page: Page, text: RegExp): Locator {
  return page.getByText(text).filter({ visible: true }).first();
}

export function visibleText(container: Page | Locator, text: string, exact = false): Locator {
  return container.getByText(text, { exact }).filter({ visible: true }).first();
}

// Absence and privacy assertions must inspect every matching DOM node. A
// visible-only lookup would let forbidden data survive in a hidden responsive
// render while the boundary test still passed.
export function textInDom(page: Page, text: string): Locator {
  return page.getByText(text);
}

/**
 * Runs the action and waits for a banner with this text that was not on
 * screen before it. Optimistic surfaces show the result before the server
 * answers, so the banner is the first signal that the write was accepted. A
 * banner an earlier step left on screen must not satisfy the wait. Not for an
 * action that reloads the page: banner ids restart with the document.
 */
export async function expectBannerAfter(
  page: Page,
  text: string | RegExp,
  action: () => Promise<void>,
  timeout = 20_000,
): Promise<void> {
  const banners = page.locator('[role="alert"][data-banner-id]');
  const idsOf = (locator: Locator): Promise<Array<string | null>> =>
    locator.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-banner-id')));
  const before = await idsOf(banners);
  await action();
  await expect
    .poll(async () => (await idsOf(banners.filter({ hasText: text }))).some((id) => !before.includes(id)), {
      timeout,
      message: `A new banner confirms the action: ${String(text)}`,
    })
    .toBe(true);
}

// Dialog suspension drops a *scheduled* refresh timer, but it cannot cancel a
// router.refresh already in flight — a refresh that fired just before the
// dialog opened can still land mid-interaction and unmount the dialog
// (structural gap recorded at Stage B closure, 2026-08-28; it closed the
// Zurücklegen dialog under a running fill and hung an unbounded retry 287 s).
// "The dialog vanished under me" is therefore a bounded, retryable condition,
// never something to wait out. Preparation contains no submission. Once
// submit starts, an error cannot safely distinguish a rejected click from a
// committed write whose response was lost, so submission never retries.
export async function retryDialogTransaction(input: {
  open: () => Promise<void>;
  dialog: Locator;
  prepare: () => Promise<void>;
  submit: () => Promise<void>;
  /** Bounded open/prepare attempts, default 3. Submission runs once. */
  attempts?: number;
}): Promise<void> {
  await retryBeforeSubmit({
    prepare: async () => {
      await input.open();
      await input.prepare();
    },
    submit: input.submit,
    canRetryPreparation: async () => (await input.dialog.count()) === 0,
    ...(input.attempts !== undefined ? { attempts: input.attempts } : {}),
  });
  await expect(input.dialog).toHaveCount(0, { timeout: 20_000 });
}

export async function openDialogWithRetry(input: {
  trigger: Locator;
  dialog: Locator;
  attempts?: number;
}): Promise<void> {
  const attempts = input.attempts ?? 3;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    await input.trigger.click({ timeout: 15_000 });
    if (
      await input.dialog
        .waitFor({ state: 'visible', timeout: 2_500 })
        .then(() => true)
        .catch(() => false)
    ) {
      return;
    }
  }
  throw new Error('Dialog did not open after bounded retries');
}

/** Finds the labelled input whose current DOM value matches exactly. */
export async function inputByValue(
  container: Page | Locator,
  label: string,
  value: string,
): Promise<Locator> {
  const inputs = container.getByLabel(label);
  await expect(inputs).not.toHaveCount(0, { timeout: 15_000 });
  const count = await inputs.count();
  for (let index = 0; index < count; index += 1) {
    const input = inputs.nth(index);
    if ((await input.inputValue()) === value) return input;
  }
  throw new Error(`No input labelled "${label}" has the value "${value}".`);
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// P1-01: customer contact and work-site management on the customer detail.

// The customer detail refreshes itself after each save, but under suite load
// that refresh has landed after 15-30s, and a single Realtime delivery can be
// missed entirely (documented transient class; a certification failure showed
// the committed row with a still-empty list after 30s). Wait within the live
// envelope first, then use the one sanctioned reload as an explicit goto to
// the captured route — a bare reload racing a concurrent router refresh has
// landed on Dashboard before — and assert the server-rendered persisted row.
export async function expectVisibleAfterSave(page: Page, text: string): Promise<void> {
  try {
    await expect(visibleText(page, text)).toBeVisible({ timeout: 30_000 });
  } catch {
    const route = page.url();
    await page.goto(route);
    await expect(visibleText(page, text)).toBeVisible({ timeout: 15_000 });
  }
}

// The segmented DatePicker (dd.mm.yyyy) is driven by typing digits after
// focusing the group; segments auto-advance after two/two/four digits. The
// group's accessible name is the field label (e.g. "Gültig ab").
export async function typeIntoDatePicker(
  scope: Locator,
  groupName: string,
  digits: string,
  delayMs = 50,
): Promise<void> {
  // The date picker is the group of that name that holds the calendar button
  // and no further group: a Details field row is a group named by its label
  // too („Eintrittsdatum“, or „Geplantes Datum“ around the picker „Datum“).
  // The inner locators are queried inside each match, so they start at the page.
  const group = scope
    .getByRole('group', { name: groupName })
    .filter({ has: scope.page().getByRole('button', { name: DATE_PICKER_CALENDAR_BUTTON }) })
    .filter({ hasNot: scope.page().getByRole('group') });
  await group.click();
  // The click may land on any segment; ArrowLeft twice normalizes to the day
  // segment because the control has exactly day, month, and year segments.
  await pressKey(group, 'ArrowLeft', { into: group });
  await pressKey(group, 'ArrowLeft', { into: group });
  await group.pressSequentially(digits, { delay: delayMs });
}

// (TimeInput already has a shared helper: typeIntoTimeInput below, addressed
// by element id. Reuse it for every migrated time field.)

/** Day, month and year digits of an ISO date for the segmented date picker. */
export function datePickerDigits(dateIso: string): string {
  return `${dateIso.slice(8, 10)}${dateIso.slice(5, 7)}${dateIso.slice(0, 4)}`;
}

// DatePicker addressed by element id instead of accessible name — for the
// DateTimeField composite and standalone pickers with known ids.
export async function typeIntoDatePickerById(
  scope: Locator,
  id: string,
  isoDate: string, // 'YYYY-MM-DD'
  options?: { timeout?: number },
): Promise<void> {
  const digits = datePickerDigits(isoDate);
  const group = scope.locator(`#${id}`);
  const timeoutOptions = options?.timeout !== undefined ? { timeout: options.timeout } : {};
  await group.click(timeoutOptions);
  await pressKey(group, 'ArrowLeft', { into: group, ...timeoutOptions });
  await pressKey(group, 'ArrowLeft', { into: group, ...timeoutOptions });
  await group.pressSequentially(digits, { delay: 50, ...timeoutOptions });
}

// DateTimeField (DatePicker + TimeInput over one combined value). Accepts the
// former datetime-local string format so migrated steps stay drop-in.
export async function typeIntoDateTimeField(
  scope: Locator,
  idPrefix: string,
  localValue: string, // 'YYYY-MM-DDTHH:mm'
  options?: { timeout?: number },
): Promise<void> {
  const [datePart, timePart] = localValue.split('T');
  if (!datePart) throw new Error("typeIntoDateTimeField requires a 'YYYY-MM-DD[THH:mm]' value");
  await typeIntoDatePickerById(scope, `${idPrefix}-date`, datePart, options);
  if (timePart) {
    await typeIntoTimeInput(scope, `${idPrefix}-time`, timePart.replace(':', ''), options);
  }
}

// UI/UX consolidation shared steps: every SearchableSelect/-MultiSelect in the
// app has the same anatomy (combobox trigger → search textbox → semantic options
// in a listbox). Specs pass the trigger locator (by id or by visible text via
// page.getByRole('combobox').filter({ hasText })). Migrating a form onto the
// registry components means switching its spec steps to these helpers, so a
// future component change touches only this file.

export async function selectFromSearchable(
  page: Page,
  trigger: Locator,
  optionText: string,
  options?: { searchFirst?: boolean },
): Promise<void> {
  const listbox = page.getByRole('listbox').filter({ visible: true }).first();
  const triggerId = await trigger.getAttribute('id');
  const stableTrigger = triggerId ? page.locator(`#${triggerId}`) : trigger;
  const openPicker = async (): Promise<void> => {
    if (await listbox.isVisible().catch(() => false)) return;
    await expect(stableTrigger).toBeVisible({ timeout: 15_000 });
    await expect(stableTrigger).toBeEnabled({ timeout: 15_000 });
    let lastError: unknown;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        await stableTrigger.click({ timeout: 2_000 });
        await expect(listbox).toBeVisible({ timeout: 2_000 });
        return;
      } catch (error) {
        lastError = error;
        // Retry the same semantic trigger when a live refresh remounts it.
      }
    }
    throw new Error('Searchable picker could not be opened.', {
      cause: lastError,
    });
  };
  const searchFirst = options?.searchFirst ?? true;
  const restoreOpenState = async (): Promise<void> => {
    let lastError: unknown;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await openPicker();
      if (!searchFirst) return;
      try {
        await listbox.locator('..').getByRole('textbox').fill(optionText, { timeout: 2_000 });
        return;
      } catch (error) {
        lastError = error;
        // Realtime can remount the open picker while its search field is
        // filling. Reopen it and resolve the current textbox on the next pass.
      }
    }
    throw new Error('Searchable picker search could not be restored.', {
      cause: lastError,
    });
  };
  await restoreOpenState();
  const optionName = new RegExp(`(?:^|\\s|·)${escapeRegExp(optionText)}(?:$|\\s)`);
  const optionButton = listbox.getByRole('option', { name: optionName }).first();
  let selected = false;
  let lastSelectionError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await restoreOpenState();
      await expect(optionButton).toBeVisible({ timeout: 5_000 });
      await optionButton.click({ timeout: 5_000 });
      if (triggerId) {
        await expect(stableTrigger).toContainText(optionText, {
          timeout: 5_000,
        });
      } else {
        await expect(listbox).toBeHidden({ timeout: 2_000 });
      }
      selected = true;
      break;
    } catch (error) {
      lastSelectionError = error;
      // A remount also closes the popover. The next attempt restores it and
      // any search text before resolving the same exact option again.
    }
  }
  if (!selected) {
    throw new Error(`Searchable option could not be selected: ${optionText}`, {
      cause: lastSelectionError,
    });
  }
  // Single select closes its popover on selection.
  await expect(listbox).toBeHidden();
}

export async function toggleInSearchableMulti(
  page: Page,
  trigger: Locator,
  optionTexts: string[],
): Promise<void> {
  await trigger.click();
  const listbox = page.getByRole('listbox');
  await expect(listbox).toBeVisible();
  const search = listbox.locator('..').getByRole('textbox');
  for (const optionText of optionTexts) {
    await search.fill(optionText);
    await listbox.getByRole('option').filter({ hasText: optionText }).first().click();
  }
  // The multi popover stays open; close by toggling the trigger. Never press
  // Escape here — inside a dialog it closes the whole dialog (known gotcha).
  await trigger.click();
  await expect(listbox).toBeHidden();
}

export async function typeIntoTimeInput(
  dialog: Locator,
  id: string,
  digits: string,
  options?: { timeout?: number },
): Promise<void> {
  if (!/^\d{4}$/.test(digits)) {
    throw new Error('typeIntoTimeInput requires exactly four HHMM digits');
  }
  const group = dialog.locator(`#${id}`);
  const timeoutOptions = options?.timeout !== undefined ? { timeout: options.timeout } : {};
  await group.focus(timeoutOptions);
  await pressKey(group, 'ArrowLeft', { into: group, ...timeoutOptions });
  await pressKey(group, 'Delete', { into: group, ...timeoutOptions });
  await group.pressSequentially(digits.slice(0, 2), { delay: 50, ...timeoutOptions });
  await pressKey(group, 'ArrowRight', { into: group, ...timeoutOptions });
  await pressKey(group, 'Delete', { into: group, ...timeoutOptions });
  await group.pressSequentially(digits.slice(2), { delay: 50, ...timeoutOptions });
}

/**
 * Navigation guard for read-only routes: a Realtime router refresh can abort a
 * same-moment navigation with net::ERR_ABORTED. Retries the goto once; the route
 * is read-only, so the retry cannot duplicate a write.
 */
export async function gotoReadOnlyRoute(page: Page, path: string): Promise<void> {
  try {
    await page.goto(path);
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes('net::ERR_ABORTED')) throw error;
    await page.goto(path);
  }
}
