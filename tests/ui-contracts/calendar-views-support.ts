import { expect, type Locator, type Page } from '@playwright/test';
import { assertWorkspaceTestLock } from '@/lib/testing/runner/workspace-test-lock';

export async function openCalendarContract(
  page: Page,
  fixture: 'calendar-board' | 'calendar-day' | 'calendar-month',
): Promise<void> {
  assertWorkspaceTestLock();
  const bundle = process.env.WERKFLOW_UI_CONTRACT_BUNDLE;
  if (!bundle) throw new Error('Run through bun tests/ui-contracts/run.ts.');
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.route('http://localhost/ui-contracts', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<html lang="de"><body><div id="root"></div></body></html>',
    }),
  );
  await page.goto('http://localhost/ui-contracts');
  // The app's compiled stylesheet: the hour axis, lanes and handles need real geometry.
  const css = process.env.WERKFLOW_UI_CONTRACT_CSS;
  if (!css) throw new Error('Calendar contracts require the compiled application stylesheet.');
  await page.addStyleTag({ path: css });
  await page.evaluate((name) => {
    window.uiContractFixture = name;
  }, fixture);
  await page.addScriptTag({ path: bundle });
}

/** The fixture's calendar region; every lookup below scopes from it or from the portal root. */
function view(page: Page): Locator {
  return page.getByRole('region', { name: 'Kalenderansicht' });
}

export function card(page: Page, title: string): Locator {
  return view(page).locator('[data-calendar-card]').filter({ hasText: title });
}

export function boardRowCard(page: Page, employeeRecordId: string, title: string): Locator {
  return view(page)
    .locator(`[data-board-row="${employeeRecordId}"] [data-calendar-card]`)
    .filter({ hasText: title });
}

export function boardCell(page: Page, employeeRecordId: string, dateIso: string): Locator {
  return view(page).locator(
    `[data-board-row="${employeeRecordId}"] [data-board-cell][data-date="${dateIso}"]`,
  );
}

export function boardHighlight(page: Page): Locator {
  return view(page).locator('[data-board-highlight]');
}

export function dayTimeline(page: Page, userId: string): Locator {
  return view(page).locator(`[data-day-row="${userId}"] [data-day-timeline]`);
}

export function monthDay(page: Page, dateIso: string): Locator {
  return view(page).locator(`[data-month-day="${dateIso}"]`);
}

export function monthCell(page: Page, dateIso: string): Locator {
  return view(page).locator(`[data-month-cell="${dateIso}"]`);
}

export function monthDayPopover(page: Page, dateIso: string): Locator {
  return page.locator(`[data-month-day-popover="${dateIso}"]`);
}

/** The engine's ghost lives in the provider's portal, outside the region. */
export function dragGhost(page: Page): Locator {
  return page.locator('[data-calendar-drag-ghost]');
}

export function isDragging(page: Page): Locator {
  return page.locator('body.is-dragging');
}

/** The trailing resize handle of a card; the card exposes its handles positionally by design. */
export function trailingResizeHandle(cardLocator: Locator): Locator {
  return cardLocator.locator('[role="presentation"]').last();
}

export async function writeCount(page: Page): Promise<number> {
  return page.evaluate(() => window.calendarWriteContract.calls.length);
}

/** Presses on `from`, crosses the 5 px threshold, moves to `to` in steps, releases. */
export async function dragPointer(
  page: Page,
  from: Locator,
  to: Locator,
  options: { release?: boolean; moves?: number; beforeRelease?: () => Promise<void> } = {},
): Promise<void> {
  const source = await from.boundingBox();
  const target = await to.boundingBox();
  if (!source || !target) throw new Error('Drag source or target has no layout.');
  const startX = source.x + Math.min(20, source.width / 2);
  const startY = source.y + source.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 8, startY, { steps: 2 });
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, {
    steps: options.moves ?? 10,
  });
  await options.beforeRelease?.();
  if (options.release !== false) await page.mouse.up();
}

/** Presses on a card, crosses the threshold and moves to an absolute point without releasing. */
export async function beginDragToPoint(
  page: Page,
  from: Locator,
  point: { x: number; y: number },
): Promise<void> {
  const source = await from.boundingBox();
  if (!source) throw new Error('Drag source has no layout.');
  const startX = source.x + 20;
  const startY = source.y + source.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 10, startY, { steps: 2 });
  await page.mouse.move(point.x, point.y, { steps: 8 });
}

/** Drags a resize handle by `deltaPx` and releases. */
export async function dragHandleBy(page: Page, handle: Locator, deltaPx: number): Promise<void> {
  const bounds = await handle.boundingBox();
  if (!bounds) throw new Error('The resize handle has no layout.');
  const x = bounds.x + bounds.width / 2;
  const y = bounds.y + bounds.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 8, y, { steps: 2 });
  await page.mouse.move(x + deltaPx, y, { steps: 6 });
  await page.mouse.up();
}

export function saving(page: Page): Locator {
  return page.getByLabel('Laufende Speicherung');
}

export async function expectBanner(page: Page, text: string): Promise<void> {
  await expect(page.getByRole('alert').getByText(text, { exact: false })).toBeVisible();
}
