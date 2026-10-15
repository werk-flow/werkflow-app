import type { CDPSession, Page, TestInfo } from '@playwright/test';

import { expect } from './fixtures';
import { installShiftRecorder, shiftsAfterUsable } from './layout-shifts';
import { expectNoSidewaysOverflow, expectPhoneMeasures } from './layout-measure';
import { areaHeaderTitle, areaNavigation, areaSubpageHeading, dateTimeFieldGrid } from './layout-fixtures';
import { pressKey } from '../../golden/support/steps/interaction';
import { inventoryLocationCard, inventoryTab } from '../../golden/support/steps/inventory';
import {
  requestCaptureButton,
  requestCaptureDialog,
  requestListRefreshButton,
  requestSearchField,
} from '../../golden/support/steps/requests';
import {
  expandServiceFormSections,
  serviceDialogForms,
  serviceFormCustomerPicker,
  serviceFormCustomerRequired,
  serviceFormDialog,
  serviceFormHeading,
  serviceFormSave,
  serviceFormTrigger,
} from '../../golden/support/steps/service';
import { pageHeader, SHARED_COPY } from '../../golden/support/steps/shared';
import type { TestWorld } from '../../golden/support/world';
import { expectDefined } from '../../../lib/testing/spec-support/expect-defined';

// The viewport audit's checks per page (werkflow-design, "Density and
// layout"): no page-level horizontal scroll on any viewport, and the app shell
// owns the vertical scroll, so the document itself never scrolls (the page
// header used to slide under the app bar on phones). Native form controls stay
// out of the web app. Two groups use them: audit:layout walks every list page
// at a phone width, audit:layout:viewports the detail pages and route aliases
// at a phone width and every page at the tablet and laptop widths.

const PHONE = { width: 375, height: 812 };

// The canon names every viewport, and the office works on laptops. An upright
// tablet keeps the app sidebar and leaves the least room beside it; 1024 and
// 1280 px are the laptop widths where a fixed-width toolbar row stops fitting;
// at 1680 px the detail pages show their widest arrangement, two columns.
const WIDE_VIEWPORTS = [
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1280, height: 800 },
  { width: 1680, height: 1050 },
] as const;

// The warehouse cards are a second layout of /inventar: every world holds one
// warehouse whose item name is a long unbroken token.
export async function expectWarehouseCardsFit(page: Page, world: TestWorld, label: string): Promise<void> {
  await inventoryTab(page, 'locations').click();
  await expect(inventoryLocationCard(page, world.inventory.locationName)).toBeVisible();
  await expectNoSidewaysOverflow(page, `${label}, warehouse cards`);
}

export async function expectWideLayout(page: Page, route: string, world: TestWorld): Promise<void> {
  await page.setViewportSize(WIDE_VIEWPORTS[0]);
  await page.goto(route);
  await expect(page).toHaveURL((url) => decodeURIComponent(url.pathname) === route);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  const content = page.getByRole('main').locator('[data-page-body]');
  await expect(content).toBeVisible();
  await expect(content.locator('[data-slot="skeleton"]:visible')).toHaveCount(0);
  await expect(content).not.toHaveText('');
  for (const viewport of WIDE_VIEWPORTS) {
    await page.setViewportSize(viewport);
    await expectNoSidewaysOverflow(page, `${route} at ${viewport.width} px`);
  }
  if (route !== '/inventar') return;
  for (const viewport of WIDE_VIEWPORTS) {
    await page.setViewportSize(viewport);
    await expectWarehouseCardsFit(page, world, `${route} at ${viewport.width} px`);
  }
}

export async function expectPhoneLayout(
  page: Page,
  route: string,
  testInfo: TestInfo,
  heading?: string,
): Promise<void> {
  await page.setViewportSize(PHONE);
  await installShiftRecorder(page);
  await page.goto(route);
  await expect(page).toHaveURL((url) => decodeURIComponent(url.pathname) === route);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  const content = page.getByRole('main').locator('[data-page-body]');
  await expect(content).toBeVisible();
  // Area/settings headings can arrive before their streamed content.
  await expect(content.locator('[data-slot="skeleton"]:visible')).toHaveCount(0);
  await expect(content).not.toHaveText('');
  if (heading) await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
  await testInfo.attach('phone-layout', { body: await page.screenshot(), contentType: 'image/png' });
  await expectPhoneMeasures(page, route);
  expect(await controlsUnderClockAtEnd(page), `${route}: a control stays under the clock button`).toEqual([]);
  await expectCurrentAreaItemInView(page, route);
  await expectMainThreadSettles(page, route);
  await expectNothingMovesAfterUsable(page, route, testInfo);
}

// Layout stability (docs/technical/performance.md, "Check layout stability"):
// once no skeleton is left and the main thread settled, nothing moves without
// an input. The world is quiet, so no live update can move a row legitimately.
// The shifts while content streamed in are attached per region: a high score
// names a skeleton whose box differs from its content.
async function expectNothingMovesAfterUsable(page: Page, route: string, testInfo: TestInfo): Promise<void> {
  const shifts = await shiftsAfterUsable(page, route);
  await testInfo.attach('layout-shifts', {
    body: JSON.stringify({ route, ...shifts }, null, 2),
    contentType: 'application/json',
  });
  for (const [region, score] of Object.entries(shifts.streaming))
    if (score > 0.02)
      testInfo.annotations.push({ type: 'streaming-shift', description: `${route} ${region} ${score}` });
  expect(shifts.afterUsable, `${route}: content moved after the page was usable`).toEqual([]);
}

// A navigation strip that scrolls within itself must still show where the user is. The scroll
// position rounds to whole pixels, so a shown item measures just under 1; a hidden one measures 0.
async function expectCurrentAreaItemInView(page: Page, route: string): Promise<void> {
  const current = pageHeader(page).locator('[aria-current="page"]');
  if ((await current.count()) === 0) return;
  await expect(current, `${route}: the current section is scrolled out of its strip`).toBeInViewport({
    ratio: 0.95,
  });
}

// The highest share of the main thread that tasks used in six consecutive
// windows of ten animation frames, about one second in total.
async function mainThreadPeakBusyShare(page: Page, cdp: CDPSession): Promise<number> {
  const taskSeconds = async (): Promise<number> => {
    const { metrics } = await cdp.send('Performance.getMetrics');
    return metrics.find((metric) => metric.name === 'TaskDuration')?.value ?? 0;
  };
  let peak = 0;
  for (let window = 0; window < 6; window++) {
    const before = await taskSeconds();
    const elapsedMs = await page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          const start = performance.now();
          let frames = 0;
          const onFrame = (): void => {
            frames += 1;
            if (frames === 10) resolve(performance.now() - start);
            else requestAnimationFrame(onFrame);
          };
          requestAnimationFrame(onFrame);
        }),
    );
    peak = Math.max(peak, (((await taskSeconds()) - before) * 1000) / elapsedMs);
  }
  return peak;
}

// A settled page leaves the main thread idle for a whole second. A commit loop
// kept the field work pack fully busy, without a network request, for as long
// as it was open; it began about a second after the load, so one short idle
// window right after the load did not prove the page settled.
export async function expectMainThreadSettles(page: Page, route: string): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send('Performance.enable');
    await expect
      .poll(() => mainThreadPeakBusyShare(page, cdp), {
        message: `${route}: the main thread stays busy after the page settled`,
        timeout: 8_000,
      })
      .toBeLessThan(0.5);
  } finally {
    await cdp.detach();
  }
}

// The clock button floats over the bottom right of every page. Scrolled to its
// end, the page body must leave every control clear of it: the service lists'
// fixed create buttons sat underneath it on phones (rendered review of 2026-10-02).
async function controlsUnderClockAtEnd(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const body = document.querySelector<HTMLElement>('[data-page-body]');
    const clock = document.querySelector<HTMLElement>('[data-clock-fab]');
    if (!body || !clock) return [];
    body.scrollTop = body.scrollHeight;
    const cover = clock.getBoundingClientRect();
    return Array.from(
      document.querySelectorAll<HTMLElement>('main a, main button, main input, main [role="combobox"]'),
    )
      .filter((control) => !clock.contains(control) && control.getClientRects().length > 0)
      .filter((control) => {
        const box = control.getBoundingClientRect();
        const overlapX = Math.min(cover.right, box.right) - Math.max(cover.left, box.left);
        const overlapY = Math.min(cover.bottom, box.bottom) - Math.max(cover.top, box.top);
        return overlapX > 2 && overlapY > 2;
      })
      .map((control) =>
        (control.getAttribute('aria-label') ?? control.textContent ?? control.tagName).trim().slice(0, 60),
      );
  });
}

export async function expectAreaHeader(page: Page, route: string): Promise<void> {
  const isTimeArea = route.startsWith('/zeiterfassung');
  const isServiceArea = route.startsWith('/service/');
  if (!isTimeArea && !isServiceArea) return;
  const area = isTimeArea ? 'time' : 'service';
  const destinations = isTimeArea
    ? [
        '/zeiterfassung',
        '/zeiterfassung/zeitkonto',
        '/zeiterfassung/perioden',
        '/zeiterfassung/einstellungen',
      ]
    : ['/service/faelle', '/service/anlagen', '/service/wartung'];
  const header = pageHeader(page);
  await expect(header).toHaveCount(1);
  await expect(areaHeaderTitle(header, area)).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  const navigation = areaNavigation(header, area);
  await expect(navigation).toBeVisible();
  expect(
    await navigation.getByRole('link').evaluateAll((links) => links.map((link) => link.getAttribute('href'))),
  ).toEqual(destinations);
  await expect(navigation.locator('[aria-current="page"]')).toHaveCount(1);
  await expect(navigation.locator('[aria-current="page"]')).toHaveAttribute('href', route);

  // Use client navigation to prove that the layout's real DOM survives a
  // subpage change. A fresh page.goto would only prove its final appearance.
  if (route !== '/zeiterfassung' && route !== '/service/faelle') return;
  const headerNode = await header.elementHandle();
  const navigationNode = await navigation.elementHandle();
  if (!headerNode || !navigationNode) throw new Error('Area layout is not mounted.');
  const destination = isTimeArea ? '/zeiterfassung/zeitkonto' : '/service/anlagen';
  await navigation.locator(`a[href="${destination}"]`).click();
  await expect(page).toHaveURL(new RegExp(`${destination}$`));
  await expect(areaSubpageHeading(page, area)).toBeVisible();
  await expect(navigation.locator('[aria-current="page"]')).toHaveAttribute('href', destination);
  expect(await headerNode.evaluate((node) => node.isConnected)).toBe(true);
  expect(await navigationNode.evaluate((node) => node.isConnected)).toBe(true);
  expect(await header.evaluate((node, original) => node === original, headerNode)).toBe(true);
  expect(await navigation.evaluate((node, original) => node === original, navigationNode)).toBe(true);
  await expect(areaHeaderTitle(header, area)).toBeVisible();
}

export async function expectRequestControlsOnPhone(page: Page): Promise<void> {
  const search = requestSearchField(page);
  const refresh = requestListRefreshButton(page);
  const tabs = page.getByRole('tablist');
  const searchBox = await search.boundingBox();
  const refreshBox = await refresh.boundingBox();
  const tabsBox = await tabs.boundingBox();
  if (!searchBox || !refreshBox || !tabsBox) throw new Error('Request filter strip is not visible.');
  expect(searchBox.width).toBeGreaterThan(150);
  expect(searchBox.y).toBeGreaterThanOrEqual(tabsBox.y + tabsBox.height);
  expect(searchBox.x + searchBox.width).toBeLessThanOrEqual(refreshBox.x);
  await refresh.click();
  await expect(search).not.toBeFocused();
  await expect(refresh).toBeEnabled();

  await requestCaptureButton(page).click();
  const dialog = requestCaptureDialog(page);
  await expect(dialog).toBeVisible();
  const date = dialog.locator('#request-received-at-date');
  const time = dialog.locator('#request-received-at-time');
  // The DateTimeField grid holds exactly the date and the time control.
  const pair = dateTimeFieldGrid(dialog, 'request-received-at-date');
  expect(await pair.evaluate((grid) => grid.scrollWidth - grid.clientWidth)).toBeLessThanOrEqual(1);
  await page.setViewportSize({ width: 768, height: PHONE.height });
  await date.scrollIntoViewIfNeeded();
  const wideContainer = await pair.evaluate((grid) => {
    const container = grid.parentElement;
    if (!container) throw new Error('expected the date and time pair inside a container');
    return {
      width: container.getBoundingClientRect().width,
      threshold: Number.parseFloat(getComputedStyle(document.documentElement).fontSize) * 20,
    };
  });
  expect(wideContainer.width).toBeGreaterThanOrEqual(wideContainer.threshold);
  await expect
    .poll(async () => {
      const dateBox = await date.boundingBox();
      const timeBox = await time.boundingBox();
      return dateBox && timeBox ? Math.abs(dateBox.y - timeBox.y) : Number.POSITIVE_INFINITY;
    })
    .toBeLessThanOrEqual(1);

  await page.setViewportSize({ width: 320, height: PHONE.height });
  await date.scrollIntoViewIfNeeded();
  await expect
    .poll(() =>
      pair.evaluate((grid) => {
        const [dateControl, timeControl] = Array.from(grid.children);
        if (!dateControl || !timeControl) throw new Error('expected a date and a time control');
        const dateBox = dateControl.getBoundingClientRect();
        const timeBox = timeControl.getBoundingClientRect();
        return timeBox.top - dateBox.bottom;
      }),
    )
    .toBeGreaterThanOrEqual(0);
  const dimensions = await pair.evaluate((grid) => {
    const container = grid.parentElement;
    if (!container) throw new Error('expected the date and time pair inside a container');
    const box = container.getBoundingClientRect();
    const controls = Array.from(grid.children).map((control) => control.getBoundingClientRect());
    return {
      width: box.width,
      threshold: Number.parseFloat(getComputedStyle(document.documentElement).fontSize) * 20,
      overflow: container.scrollWidth - container.clientWidth,
      contained: controls.every((control) => control.left >= box.left - 1 && control.right <= box.right + 1),
    };
  });
  expect(dimensions.width).toBeLessThan(dimensions.threshold);
  expect(dimensions.overflow).toBeLessThanOrEqual(1);
  expect(dimensions.contained).toBe(true);
  await dialog.getByRole('button', { name: SHARED_COPY.action.close, exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.setViewportSize(PHONE);
}

export async function expectServiceDialogContracts(page: Page, route: string): Promise<void> {
  for (const form of serviceDialogForms(route)) {
    await serviceFormTrigger(page, form).click();
    const dialog = serviceFormDialog(page, form);
    const input = dialog.locator(form.input);
    await expect(dialog.locator('form')).toHaveCount(1);
    await expect(serviceFormSave(dialog, form)).toBeEnabled();
    await pressKey(dialog, 'Enter', { into: input });
    // Required business context stays empty, so this proves native submit
    // validation without creating a customer, site, equipment or maintenance row.
    await expect(serviceFormCustomerRequired(dialog)).toBeVisible();
    await expect(serviceFormCustomerPicker(dialog)).toBeFocused();
    await expandServiceFormSections(dialog, form);
    const body = dialog.locator('[data-slot="dialog-body"]');
    const heading = serviceFormHeading(dialog, form);
    const save = serviceFormSave(dialog, form);
    await expect(heading).toBeInViewport({ ratio: 1 });
    await expect(save).toBeInViewport({ ratio: 1 });
    const before = expectDefined(await save.boundingBox(), 'the save button box before scrolling');
    expect(await body.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
    await body.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect(heading).toBeInViewport({ ratio: 1 });
    await expect(save).toBeInViewport({ ratio: 1 });
    const after = expectDefined(await save.boundingBox(), 'the save button box after scrolling');
    expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(1);
    await dialog.getByRole('button', { name: SHARED_COPY.action.cancel, exact: true }).click();
    await expect(dialog).toBeHidden();
  }
}
