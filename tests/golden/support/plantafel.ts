import { expect, type Locator, type Page } from '@playwright/test';
import { CALENDAR_DISPATCH_STATE_LABELS, type CalendarDispatchState } from '../../../lib/calendar/board';
import { calendarRefusalMessage } from '../../../lib/calendar/messages';
import { occurrenceStatusLabel } from './steps/calendar';
import { SHARED_COPY, visibleMatchingText, visibleText } from './steps/shared';

/**
 * Named lookups for the calendar of P1-24a (the Plantafel, the day and the
 * month view). The views expose their structure through data attributes
 * (docs/technical/realtime-and-caching.md, design skill "Calendar canon");
 * specs go through these helpers instead of repeating the markup.
 */

/** The view tabs of the calendar page. */
const CALENDAR_VIEW_TABS = {
  board: 'Plantafel',
  week: 'Woche',
  day: 'Tag',
  month: 'Monat',
} as const;

type CalendarViewTab = keyof typeof CALENDAR_VIEW_TABS;

/** Copy of the calendar views and the Plantafel toolbar that no pure product module owns. */
const BOARD_COPY = {
  pageHeading: 'Kalender',
  refresh: 'Aktualisieren',
  unassignedRow: 'Ohne Zuweisung',
  seriesMark: 'Serientermin',
  horizon: 'Horizont',
  search: 'Plantafel durchsuchen',
  filter: /^Filter/,
  conflictsOnly: 'Nur Konflikte',
  compact: /Kompakt anzeigen/,
  comfortable: /Komfortabel anzeigen/,
  shortcuts: 'Tastenkürzel anzeigen',
  shortcutsDialog: 'Tastenkürzel',
  weekNumber: /KW \d+/,
  closeBanner: 'Hinweis schließen',
  undo: 'Rückgängig',
  moreItems: /\+\d+ mehr/,
  showDetails: 'Details anzeigen',
  openMoveForm: 'Verschieben …',
  move: 'Verschieben',
  scheduleDialog: 'Auftrag einplanen',
  schedule: 'Einplanen',
  memberFilter: /Mitarbeiter/,
  memberFilterWithCount: /Mitarbeiter \(\d+\)/,
  memberFilterPicker: 'Mitarbeiter filtern',
  lockedCard: /begonnen oder vergangen/,
} as const;

/** The two layers a calendar view shows and can hide. */
const CALENDAR_LAYERS = { work: 'Arbeitszeiten', planned: 'Termine' } as const;

/** The header's period navigation. */
const CALENDAR_STEPS = { previous: SHARED_COPY.pagination.previous, next: SHARED_COPY.action.next } as const;

const MEMBER_FILTER_BULK = { all: 'Alle auswählen', none: 'Keine auswählen' } as const;

/** Distinctive parts of the calendar's confirmation banners. */
const CALENDAR_BANNERS = {
  moved: 'verschoben',
  copied: 'Kopie',
  extendedUntil: 'dauert jetzt bis',
  lengthened: 'Termin dauert jetzt',
  scheduled: 'eingeplant',
  parked: 'Auftrag wurde geparkt.',
  undoFailed: 'Rückgängig war nicht möglich',
} as const;

type CalendarBanner = keyof typeof CALENDAR_BANNERS;

/** Distinctive parts of the refusal a drag ghost names at the pointer. */
export const DRAG_REFUSALS = { absent: 'abwesend', pastMidnight: 'über Mitternacht' } as const;

/** The popover notice of a started or past occurrence. */
export function startedOccurrenceMessage(): string {
  const message = calendarRefusalMessage('started_occurrence');
  if (!message) throw new Error('The calendar names no refusal for a started occurrence.');
  return message;
}

/** The accessible name of a locked card mentions why it is locked. */
export const LOCKED_CARD_NAME = BOARD_COPY.lockedCard;

/** The ISO date `days` calendar days after `dateIso` (negative moves back). */
export function shiftIsoDate(dateIso: string, days: number): string {
  const [year, month, day] = dateIso.split('-').map(Number);
  if (year === undefined || month === undefined || day === undefined)
    throw new Error(`Invalid ISO date: ${dateIso}`);
  return new Date(Date.UTC(year, month - 1, day) + days * 86_400_000).toISOString().slice(0, 10);
}

/** The Monday of the week that holds `dateIso`, so a board week is addressed by its anchor. */
export function mondayOf(dateIso: string): string {
  return shiftIsoDate(dateIso, -((new Date(`${dateIso}T00:00:00Z`).getUTCDay() + 6) % 7));
}

export function calendarViewReady(page: Page, view: 'day' | 'week' | 'month'): Locator {
  return page.locator(
    `[data-calendar-scroll-container][data-calendar-state="ready"][data-calendar-view="${view}"]`,
  );
}

export async function openPlantafel(page: Page, dateIso: string): Promise<void> {
  await page.goto(`/kalender?date=${dateIso}`);
  // The view persists per user: an earlier month or day step leaves the landing there.
  const tab = page.getByRole('tab', {
    name: new RegExp(`^(${CALENDAR_VIEW_TABS.board}|${CALENDAR_VIEW_TABS.week})$`),
  });
  await expect(tab).toBeVisible({ timeout: 30_000 });
  if ((await tab.getAttribute('data-state')) !== 'active') await tab.click();
  await expect(calendarViewReady(page, 'week')).toBeVisible({ timeout: 30_000 });
}

/** A view tab of the calendar page; managers see „Plantafel“, field workers „Woche“. */
export function calendarViewTab(page: Page, view: CalendarViewTab): Locator {
  return page.getByRole('tab', { name: CALENDAR_VIEW_TABS[view], exact: true });
}

export async function openCalendarView(page: Page, dateIso: string, view: 'day' | 'month'): Promise<void> {
  await page.goto(`/kalender?date=${dateIso}`);
  await calendarViewTab(page, view).click();
  await expect(calendarViewReady(page, view)).toBeVisible({ timeout: 30_000 });
}

/** The calendar page's title. */
export const CALENDAR_PAGE_TITLE = BOARD_COPY.pageHeading;

/** The page heading; clicking it moves focus out of any toolbar control before a shortcut. */
export function calendarPageHeading(page: Page): Locator {
  return page.getByRole('main').getByRole('heading', { name: BOARD_COPY.pageHeading, level: 1 });
}

export function calendarRefreshButton(page: Page): Locator {
  return page.getByRole('button', { name: BOARD_COPY.refresh, exact: true });
}

/** The header's step back or forward by one period of the current view. */
export function calendarStepButton(page: Page, direction: keyof typeof CALENDAR_STEPS): Locator {
  return page.getByRole('button', { name: CALENDAR_STEPS[direction], exact: true });
}

/** The toggle of a calendar layer inside main. */
export function calendarLayerToggle(page: Page, layer: keyof typeof CALENDAR_LAYERS): Locator {
  return page.getByRole('main').getByText(CALENDAR_LAYERS[layer], { exact: true });
}

/** The checkbox of a calendar layer. */
export function calendarLayerCheckbox(page: Page, layer: keyof typeof CALENDAR_LAYERS): Locator {
  return page.getByRole('checkbox', { name: CALENDAR_LAYERS[layer], exact: true });
}

/** A recorded work block of a calendar view, by its start and end time (HH:MM). */
export function calendarWorkTimeBlock(scope: Locator, from: string, to: string): Locator {
  return scope.getByRole('button', { name: new RegExp(`Arbeitszeit ${from} bis ${to}`) });
}

/** The first visible toggle of a calendar layer anywhere on the page. */
export function visibleCalendarLayerToggle(page: Page, layer: keyof typeof CALENDAR_LAYERS): Locator {
  return visibleText(page, CALENDAR_LAYERS[layer]);
}

/** The button that opens the member filter popover. */
export function memberFilterButton(page: Page): Locator {
  return page.getByRole('main').getByRole('button', { name: BOARD_COPY.memberFilter });
}

/** The member filter button while it names its selection count. */
export function memberFilterSummary(page: Page): Locator {
  return page.getByRole('main').getByRole('button', { name: BOARD_COPY.memberFilterWithCount });
}

export function memberFilterPicker(page: Page): Locator {
  return page.getByRole('combobox', { name: BOARD_COPY.memberFilterPicker });
}

/** The open member filter popover, recognised by its picker. */
export function memberFilterPopover(page: Page): Locator {
  return page.getByRole('dialog').filter({ has: memberFilterPicker(page) });
}

export function memberFilterBulkAction(page: Page, action: keyof typeof MEMBER_FILTER_BULK): Locator {
  return page.getByRole('button', { name: MEMBER_FILTER_BULK[action] });
}

export function plantafel(page: Page): Locator {
  return page.getByRole('main').locator('[data-plantafel]');
}

export function boardRows(page: Page): Locator {
  return plantafel(page).locator('[data-board-row]');
}

export function boardTeamHeader(page: Page, teamName: string): Locator {
  return plantafel(page).locator('[data-board-team]').filter({ hasText: teamName });
}

export function boardColumn(page: Page, dateIso: string): Locator {
  return plantafel(page).locator(`[data-board-column="${dateIso}"]`);
}

/** A visit card in one person's row; `dateIso` narrows to the card that starts on that date. */
export function boardCard(page: Page, employeeRecordId: string, title: string, dateIso?: string): Locator {
  const row = plantafel(page).locator(`[data-board-row="${employeeRecordId}"]`);
  const scope = dateIso ? row.locator(`[data-board-item-date="${dateIso}"]`) : row;
  return scope.locator('[data-calendar-card]').filter({ hasText: title });
}

export function boardCell(page: Page, employeeRecordId: string, dateIso: string): Locator {
  return plantafel(page).locator(
    `[data-board-row="${employeeRecordId}"] [data-board-cell][data-date="${dateIso}"]`,
  );
}

/** The cards with this title across every board row. */
export function boardRowCards(page: Page, title: string): Locator {
  return boardRows(page).locator('[data-calendar-card]').filter({ hasText: title });
}

/** The cards with this title that are not marked cancelled. */
export function activeBoardRowCards(page: Page, title: string): Locator {
  return boardRowCards(page, title).filter({ hasNotText: occurrenceStatusLabel('cancelled') });
}

/** The person-day action that creates an entry for this person in a board cell. */
export function boardCellEntryAction(
  page: Page,
  employeeRecordId: string,
  dateIso: string,
  personName: string,
): Locator {
  return boardCell(page, employeeRecordId, dateIso).getByRole('button', {
    name: new RegExp(`Eintrag am .* für ${personName} anlegen`),
  });
}

export function unassignedRowHeader(page: Page): Locator {
  return plantafel(page).getByRole('rowheader', { name: BOARD_COPY.unassignedRow });
}

/** The dispatch chip of a card, named by the recipient state. */
export function cardDispatchChip(card: Locator, state: CalendarDispatchState): Locator {
  return card.getByText(CALENDAR_DISPATCH_STATE_LABELS[state], { exact: true });
}

export function cardSeriesMark(card: Locator): Locator {
  return card.getByRole('img', { name: BOARD_COPY.seriesMark });
}

/** Picks the Plantafel horizon in weeks through its select. */
export async function chooseBoardHorizon(page: Page, weeks: 1 | 2 | 4 | 6): Promise<void> {
  await page.getByLabel(BOARD_COPY.horizon).click();
  await page.getByRole('option', { name: weeks === 1 ? '1 Woche' : `${weeks} Wochen` }).click();
}

export function boardWeekNumber(page: Page): Locator {
  return page.getByRole('main').getByText(BOARD_COPY.weekNumber);
}

export function boardSearch(page: Page): Locator {
  return page.getByLabel(BOARD_COPY.search);
}

/** The filter button; with a count, only while it names that many active filters. */
export function boardFilterButton(page: Page, activeCount?: number): Locator {
  return page.getByRole('button', {
    name: activeCount === undefined ? BOARD_COPY.filter : new RegExp(`^Filter, ${activeCount} aktiv`),
  });
}

export function conflictsOnlyFilter(page: Page): Locator {
  return page.getByRole('checkbox', { name: BOARD_COPY.conflictsOnly });
}

/** The open filter popover, recognised by its conflict filter. */
export function boardFilterPopover(page: Page): Locator {
  return page.getByRole('dialog').filter({ has: conflictsOnlyFilter(page) });
}

/** The density toggle, named by the density it switches to. */
export function densityToggle(page: Page, target: 'compact' | 'comfortable'): Locator {
  return page.getByRole('button', { name: BOARD_COPY[target] });
}

export function shortcutsButton(page: Page): Locator {
  return page.getByRole('button', { name: BOARD_COPY.shortcuts });
}

export function shortcutsDialog(page: Page): Locator {
  return page.getByRole('dialog', { name: BOARD_COPY.shortcutsDialog });
}

/** The absence bars of a calendar scope; a pending request has its own tone. */
const ABSENCE_BAR_TONES = { approved: 'absence', pending: 'absence-pending' } as const;

/**
 * The absence bars inside a scope (pass the page to include every render, or
 * `main`), optionally only the bars that start on one date.
 */
export function calendarAbsenceBars(
  scope: Page | Locator,
  tone: keyof typeof ABSENCE_BAR_TONES,
  startDateIso?: string,
): Locator {
  const start = startDateIso ? `[data-bar-start="${startDateIso}"]` : '';
  return scope.locator(`[data-calendar-bar="${ABSENCE_BAR_TONES[tone]}"]${start}`);
}

/** The neutral word an approved absence bar starts with (lib/calendar/board-model.ts). */
const ABSENCE_BAR_LABELS = { vacation: 'Urlaub', sickness: 'Abwesend' } as const;

export function boardAbsenceBar(
  page: Page,
  employeeRecordId: string,
  kind: keyof typeof ABSENCE_BAR_LABELS,
): Locator {
  return calendarAbsenceBars(
    plantafel(page).locator(`[data-board-row="${employeeRecordId}"]`),
    'approved',
  ).filter({
    hasText: ABSENCE_BAR_LABELS[kind],
  });
}

export function dragGhost(page: Page): Locator {
  return page.locator('[data-calendar-drag-ghost]');
}

export function jobPopover(page: Page): Locator {
  return page.locator('[data-job-popover]');
}

/** The card popover's notice that a started or past occurrence stays unchanged. */
export function lockedOccurrenceNotice(page: Page): Locator {
  return jobPopover(page).locator('[data-card-locked]');
}

/** An action of the card popover; `move` submits the move form that `openMoveForm` opens. */
export function cardPopoverAction(
  popover: Locator,
  action: 'openMoveForm' | 'move' | 'showDetails',
): Locator {
  return action === 'move'
    ? popover.getByRole('button', { name: BOARD_COPY.move, exact: true })
    : popover.getByRole('button', { name: BOARD_COPY[action] });
}

export function parkplatzButton(page: Page): Locator {
  return page.getByRole('button', { name: /^Parkplatz/ });
}

export function parkplatzCardOf(page: Page, title: string): Locator {
  return page.locator('[data-parkplatz-panel] [data-parkplatz-card]').filter({ hasText: title });
}

/** The keyboard route of a Parkplatz card back onto the board. */
export function parkplatzScheduleButton(card: Locator, title: string): Locator {
  return card.getByRole('button', { name: `${title} einplanen` });
}

export function scheduleParkedDialog(page: Page): Locator {
  return page
    .getByRole('dialog')
    .filter({ has: page.getByRole('heading', { name: BOARD_COPY.scheduleDialog }) });
}

export function scheduleParkedSubmit(dialog: Locator): Locator {
  return dialog.getByRole('button', { name: BOARD_COPY.schedule, exact: true });
}

export function dayRow(page: Page, userId: string): Locator {
  return page.getByRole('main').locator(`[data-day-view] [data-day-row="${userId}"]`);
}

export function dayTimeline(row: Locator): Locator {
  return row.locator('[data-day-timeline]');
}

export function dayCard(row: Locator, title: string): Locator {
  return row.locator('[data-calendar-card]').filter({ hasText: title });
}

/** The day view's cards with this title in any row; a visit with two people shows in both rows. */
export function dayViewCards(page: Page, title: string): Locator {
  return page.locator('[data-day-view] [data-calendar-card]').filter({ hasText: title });
}

export function monthDay(page: Page, dateIso: string): Locator {
  return page.getByRole('main').locator(`[data-month-day="${dateIso}"]`);
}

/** The month day while it shows this text anywhere among its items. */
export function monthDayShowing(page: Page, dateIso: string, text: string): Locator {
  return monthDay(page, dateIso).filter({ hasText: text });
}

/** The month day's date number; it owns day navigation where a populated cell's center can hit an item. */
export function monthDayNumber(page: Page, dateIso: string): Locator {
  return page.getByRole('main').locator(`[data-month-day-number="${dateIso}"]`);
}

export function monthCell(page: Page, dateIso: string): Locator {
  return page.getByRole('main').locator(`[data-month-cell="${dateIso}"]`);
}

export function monthDayPopover(page: Page, dateIso: string): Locator {
  return page.locator(`[data-month-day-popover="${dateIso}"]`);
}

export function monthCards(scope: Locator, title?: string): Locator {
  const cards = scope.locator('[data-calendar-card]');
  return title ? cards.filter({ hasText: title }) : cards;
}

/** The „+n mehr“ button of a month day that holds more items than it shows. */
export function monthMoreButton(day: Locator): Locator {
  return day.getByRole('button', { name: BOARD_COPY.moreItems });
}

export function calendarHolidayLabel(page: Page, label: string): Locator {
  return page.getByRole('main').locator('[data-calendar-holiday]').filter({ hasText: label });
}

export function calendarAbsenceBarStarting(page: Page, dateIso: string, label: string): Locator {
  return calendarAbsenceBars(page.getByRole('main'), 'approved', dateIso).filter({ hasText: label });
}

export function inMonthCells(page: Page): Locator {
  return page.getByRole('main').locator('[data-month-cell][data-in-month="true"]');
}

/** The trailing resize handle of a card; the card exposes its handles positionally by design. */
export function trailingResizeHandle(card: Locator): Locator {
  return card.locator('[role="presentation"]').last();
}

/**
 * Presses on `from`, crosses the engine's threshold, moves onto `to` and
 * releases unless told otherwise. Modifier keys are held across the move.
 */
export async function dragCardTo(
  page: Page,
  from: Locator,
  to: Locator,
  options: { release?: boolean; alt?: boolean } = {},
): Promise<void> {
  await from.scrollIntoViewIfNeeded();
  const source = await from.boundingBox();
  const target = await to.boundingBox();
  if (!source || !target) throw new Error('The drag source or target has no layout.');
  const startX = source.x + Math.min(20, source.width / 2);
  const startY = source.y + source.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 8, startY, { steps: 2 });
  if (options.alt) await page.keyboard.down('Alt');
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 12 });
  if (options.release !== false) {
    await page.mouse.up();
    if (options.alt) await page.keyboard.up('Alt');
  }
}

/** Presses on a card, crosses the threshold and moves to an absolute viewport point without releasing. */
export async function beginCardDragToPoint(
  page: Page,
  from: Locator,
  point: { x: number; y: number },
): Promise<void> {
  const source = await from.boundingBox();
  if (!source) throw new Error('The drag source has no layout.');
  const startX = source.x + Math.min(20, source.width / 2);
  const startY = source.y + source.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 8, startY, { steps: 2 });
  await page.mouse.move(point.x, point.y, { steps: 10 });
}

/** Drags a resize handle by `deltaPx` along the axis and releases. */
export async function dragHandleBy(page: Page, handle: Locator, deltaPx: number): Promise<void> {
  const bounds = await handle.boundingBox();
  if (!bounds) throw new Error('The resize handle has no layout.');
  const x = bounds.x + bounds.width / 2;
  const y = bounds.y + bounds.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + Math.sign(deltaPx) * 8, y, { steps: 2 });
  await page.mouse.move(x + deltaPx, y, { steps: 8 });
  await page.mouse.up();
}

/** Drags a handle onto the centre of a target element. */
export async function dragHandleTo(page: Page, handle: Locator, target: Locator): Promise<void> {
  const bounds = await handle.boundingBox();
  const targetBox = await target.boundingBox();
  if (!bounds || !targetBox) throw new Error('The handle or its target has no layout.');
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 12, bounds.y + bounds.height / 2, { steps: 2 });
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 8 });
  await page.mouse.up();
}

/** Drags across empty time of a day row: from `startHour` to `endHour` (fractions allowed). */
export async function dragToCreateOnDayRow(
  page: Page,
  timeline: Locator,
  startHour: number,
  endHour: number,
): Promise<void> {
  const bounds = await timeline.boundingBox();
  if (!bounds) throw new Error('The day timeline has no layout.');
  const hour = bounds.width / 24;
  const y = bounds.y + bounds.height - 6;
  await page.mouse.move(bounds.x + hour * startHour, y);
  await page.mouse.down();
  await page.mouse.move(bounds.x + hour * endHour, y, { steps: 6 });
  await page.mouse.up();
}

/** The feedback banners: alerts that carry the close button (other alert roles are inline errors). */
export function banners(page: Page): Locator {
  return page
    .getByRole('alert')
    .filter({ visible: true })
    .filter({ has: page.getByRole('button', { name: BOARD_COPY.closeBanner, exact: true }) });
}

function successBanner(page: Page, text: string): Locator {
  return banners(page).filter({ hasText: text });
}

/** A visible feedback banner of this kind. */
export function calendarBanner(page: Page, kind: CalendarBanner): Locator {
  return successBanner(page, CALENDAR_BANNERS[kind]);
}

/** The banner that confirms a move to another person. */
export function reassignedBanner(page: Page, personName: string): Locator {
  return successBanner(page, `Termin wurde zu ${personName} verschoben.`);
}

/** The Undo button of a banner. */
export function bannerUndo(banner: Locator): Locator {
  return banner.getByRole('button', { name: BOARD_COPY.undo, exact: true });
}

/** The first visible text of this confirmation, wherever the page shows it. */
export function calendarConfirmation(page: Page, kind: CalendarBanner): Locator {
  return visibleText(page, CALENDAR_BANNERS[kind]);
}

/** The confirmation of a day-view move to another person; a snapped start adds its time. */
export function reassignedConfirmation(page: Page, personName: string): Locator {
  return visibleMatchingText(
    page,
    new RegExp(`^Termin wurde zu ${personName} (auf \\d\\d:\\d\\d Uhr )?verschoben\\.$`),
  );
}

/** The confirmation that a parked job was scheduled for a person. */
export function scheduledFromParkplatzConfirmation(page: Page): Locator {
  return visibleMatchingText(page, /^Auftrag wurde bei .* eingeplant\.$/);
}

/** Closes every visible banner; the calendar's confirmations stay until dismissed. */
export async function closeBanners(page: Page): Promise<void> {
  const open = banners(page);
  for (let attempt = 0; attempt < 10 && (await open.count()) > 0; attempt += 1) {
    // A banner auto-dismisses after a few seconds; one that leaves mid-click is closed all the same.
    await open
      .first()
      .getByRole('button', { name: BOARD_COPY.closeBanner, exact: true })
      .click({ timeout: 2_000 })
      .catch(() => undefined);
  }
  await expect(open).toHaveCount(0, { timeout: 10_000 });
}
