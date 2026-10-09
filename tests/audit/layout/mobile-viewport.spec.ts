import type { CDPSession, Page, TestInfo } from '@playwright/test';

import { expect, test } from '../support/fixtures';
import { expectButtonTextContrast } from '../support/button-contrast';
import { installShiftRecorder, shiftsAfterUsable } from '../support/layout-shifts';
import {
  DYNAMIC_PHONE_ROUTES,
  MANAGER_PHONE_ROUTES,
  PHONE_REDIRECTS,
  type DynamicPhoneRoute,
} from '../../../lib/testing/selection/mobile-route-inventory';
import {
  areaHeaderTitle,
  areaNavigation,
  areaSubpageHeading,
  dateTimeFieldGrid,
  layoutNames,
  prepareLayoutDetails,
} from '../support/layout-fixtures';
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
  serviceCaseCaptureButton,
  serviceDialogForms,
  serviceFormCustomerPicker,
  serviceFormCustomerRequired,
  serviceFormDialog,
  serviceFormHeading,
  serviceFormSave,
  serviceFormTrigger,
} from '../../golden/support/steps/service';
import { pageHeader, SHARED_COPY } from '../../golden/support/steps/shared';
import {
  monthlyResultListRow,
  monthlyResults,
  periodListHeading,
  periodOpenLinks,
  TIME_ACCOUNT_COPY,
} from '../../golden/support/steps/time-tracking';
import type { TestWorld } from '../../golden/support/world';
import { expectDefined } from '../../../lib/testing/spec-support/expect-defined';

// Design canon (werkflow-design, "Density and layout"): no page-level
// horizontal scroll on any viewport, and the app shell owns the vertical
// scroll, so the document itself never scrolls (the page header used to slide
// under the app bar on phones). Native form controls stay out of the web app.
// This audit walks every authenticated area at a phone width and fails on the
// first route that breaks either rule. Tag: @AUDIT-LAYOUT.

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

const EMPLOYEE_ROUTES = [
  '/dashboard',
  '/aufgaben',
  '/zeiterfassung',
  '/auftraege',
  '/qualifikationen',
] as const;

type ViewportReport = {
  documentOverflowX: number;
  documentOverflowY: number;
  pageBodyOverflowX: number;
  nativeSelects: number;
  nativeDateLikeInputs: number;
  unapprovedVisibleTables: number;
  unapprovedTableScrollRegions: number;
  contentPastBodyEdge: string[];
  controlsOutsideTheirCard: string[];
};

async function measure(page: Page): Promise<ViewportReport> {
  return page.evaluate(() => {
    const root = document.documentElement;
    const body = document.querySelector<HTMLElement>('[data-page-body]');
    // FullCalendar owns its named, horizontally scrollable calendar grid.
    // Ordinary data tables must switch to cards at this viewport, even when
    // their own overflow container conceals them from document-width checks.
    const visibleTables = Array.from(document.querySelectorAll('table')).filter(
      (table) =>
        table.getClientRects().length > 0 &&
        getComputedStyle(table).visibility !== 'hidden' &&
        !table.closest('.fc'),
    );
    const nativeDateTypes = new Set(['date', 'time', 'datetime-local', 'month', 'week', 'number', 'range']);
    // Scroll width does not see everything: a size container keeps its
    // overflow to itself, and a control can leave its card without leaving
    // the page. Both are measured on the rendered boxes. Content belongs to
    // its own region when that region scrolls sideways, shortens a text with
    // an ellipsis, or is the scrolling title (`data-marquee`); any other
    // region that clips does not excuse what it cuts off.
    const insideOwnRegion = (element: Element): boolean => {
      for (let parent = element.parentElement; parent && parent !== body; parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        if (style.overflowX === 'auto' || style.overflowX === 'scroll') return true;
        if (style.overflowX !== 'visible' && style.textOverflow === 'ellipsis') return true;
        if (parent.hasAttribute('data-marquee')) return true;
      }
      return false;
    };
    const name = (element: Element): string =>
      `${element.tagName.toLowerCase()} „${(element.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 40)}“`;
    const rendered = Array.from(body?.querySelectorAll<HTMLElement>('*') ?? []).filter((element) => {
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return (
        box.width > 1 &&
        box.height > 1 &&
        style.visibility !== 'hidden' &&
        style.position !== 'fixed' &&
        !element.closest('.fc') &&
        !insideOwnRegion(element)
      );
    });
    const bodyRight = body?.getBoundingClientRect().right ?? 0;
    const pastEdge = rendered.filter((element) => element.getBoundingClientRect().right > bodyRight + 1);
    const cardOf = (element: Element): Element | null => {
      for (let parent = element.parentElement; parent && parent !== body; parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        if (
          Number.parseFloat(style.borderRightWidth) > 0 &&
          Number.parseFloat(style.borderTopLeftRadius) >= 6
        )
          return parent;
      }
      return null;
    };
    const outsideCard = rendered.filter((element) => {
      if (!element.matches('button, a[href]')) return false;
      const card = cardOf(element)?.getBoundingClientRect();
      if (!card) return false;
      const box = element.getBoundingClientRect();
      return box.right > card.right + 1 || box.left < card.left - 1;
    });
    return {
      contentPastBodyEdge: pastEdge
        .filter((element) => !element.parentElement || !pastEdge.includes(element.parentElement))
        .slice(0, 3)
        .map(name),
      controlsOutsideTheirCard: outsideCard.slice(0, 3).map(name),
      documentOverflowX: Math.max(0, root.scrollWidth - window.innerWidth),
      documentOverflowY: Math.max(0, root.scrollHeight - window.innerHeight),
      pageBodyOverflowX: body ? Math.max(0, body.scrollWidth - body.clientWidth) : 0,
      nativeSelects: Array.from(document.querySelectorAll('select')).filter(
        (element) => element.getAttribute('aria-hidden') !== 'true',
      ).length,
      nativeDateLikeInputs: Array.from(document.querySelectorAll('input')).filter((input) =>
        nativeDateTypes.has(input.type),
      ).length,
      unapprovedVisibleTables: visibleTables.length,
      unapprovedTableScrollRegions: visibleTables.filter((table) => {
        const container = table.parentElement;
        return container && container.scrollWidth > container.clientWidth;
      }).length,
    };
  });
}

// Two frames after a resize or a tab change, so the measured layout is the settled one.
async function expectNoSidewaysOverflow(page: Page, label: string): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
  const report = await measure(page);
  expect(report.documentOverflowX, `${label}: the document must not scroll sideways`).toBe(0);
  expect(report.pageBodyOverflowX, `${label}: content wider than the page body`).toBe(0);
  expect(report.contentPastBodyEdge, `${label}: content past the right edge of the page body`).toEqual([]);
  expect(report.controlsOutsideTheirCard, `${label}: a control sticks out of its card`).toEqual([]);
}

// The warehouse cards are a second layout of /inventar: every world holds one
// warehouse whose item name is a long unbroken token.
async function expectWarehouseCardsFit(page: Page, world: TestWorld, label: string): Promise<void> {
  await inventoryTab(page, 'locations').click();
  await expect(inventoryLocationCard(page, world.inventory.locationName)).toBeVisible();
  await expectNoSidewaysOverflow(page, `${label}, warehouse cards`);
}

async function expectWideLayout(page: Page, route: string, world: TestWorld): Promise<void> {
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

async function expectPhoneLayout(
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
  const report = await measure(page);
  expect(report, `${route}: the document must not scroll sideways`).toMatchObject({ documentOverflowX: 0 });
  expect(report.documentOverflowY, `${route}: the shell owns vertical scroll, not the document`).toBe(0);
  expect(report.pageBodyOverflowX, `${route}: content wider than the page body`).toBe(0);
  expect(report.contentPastBodyEdge, `${route}: content past the right edge of the page body`).toEqual([]);
  expect(report.controlsOutsideTheirCard, `${route}: a control sticks out of its card`).toEqual([]);
  expect(report.nativeSelects, `${route}: native <select> rendered`).toBe(0);
  expect(report.unapprovedTableScrollRegions, `${route}: nested table scroll hides mobile overflow`).toBe(0);
  expect(report.unapprovedVisibleTables, `${route}: data table has no mobile card layout`).toBe(0);
  expect(report.nativeDateLikeInputs, `${route}: native date/time/number input rendered`).toBe(0);
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
async function expectMainThreadSettles(page: Page, route: string): Promise<void> {
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

async function expectAreaHeader(page: Page, route: string): Promise<void> {
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

async function expectRequestControlsOnPhone(page: Page): Promise<void> {
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

async function expectServiceDialogContracts(page: Page, route: string): Promise<void> {
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

test.describe('@AUDIT-LAYOUT phone viewport: no horizontal scroll, shell-owned scroll, no native controls', () => {
  for (const route of MANAGER_PHONE_ROUTES) {
    test(`admin ${route} fits a 375 px viewport`, async ({ adminPage, world }, testInfo) => {
      await expectPhoneLayout(adminPage, route, testInfo);
      if (route === '/inventar') await expectWarehouseCardsFit(adminPage, world, `${route} at 375 px`);
      if (route === '/service/faelle') {
        await expectButtonTextContrast(adminPage, serviceCaseCaptureButton(adminPage.getByRole('main')));
        await expect(adminPage.getByRole('dialog')).toHaveCount(0);
      }
      await expectServiceDialogContracts(adminPage, route);
      await expectAreaHeader(adminPage, route);
      if (route === '/anfragen') await expectRequestControlsOnPhone(adminPage);
    });
  }

  for (const route of EMPLOYEE_ROUTES) {
    test(`employee ${route} fits a 375 px viewport`, async ({ employeePage }, testInfo) => {
      await expectPhoneLayout(employeePage, route, testInfo);
    });
  }
});

test.describe('@AUDIT-LAYOUT tablet and laptop widths: no horizontal scroll', () => {
  for (const route of MANAGER_PHONE_ROUTES) {
    test(`admin ${route} fits 768, 1024, 1280 and 1680 px`, async ({ adminPage, world }) => {
      await expectWideLayout(adminPage, route, world);
    });
  }

  for (const pattern of DYNAMIC_PHONE_ROUTES) {
    test(`admin ${pattern} fits 768, 1024, 1280 and 1680 px`, async ({ adminPage, world, businessDate }) => {
      const destination = await detailDestination(pattern, adminPage, world, businessDate);
      await expectWideLayout(adminPage, destination.route, world);
    });
  }
});

async function detailDestination(
  pattern: DynamicPhoneRoute,
  page: Page,
  world: TestWorld,
  businessDate: string,
): Promise<{ route: string; heading: string }> {
  if (pattern === '/zeiterfassung/perioden/[periodId]') {
    await page.goto('/zeiterfassung/perioden');
    const content = page.getByRole('main').locator('[data-page-body]');
    await expect(periodListHeading(content)).toBeVisible();
    const open = periodOpenLinks(content);
    if ((await open.count()) === 0) {
      // Use the real preparation boundary to obtain a calculated period with
      // employee rows and findings, rather than fabricating protected snapshots.
      // Seeded personnel starts in the business month. The default previous
      // month would produce an empty result and leave the mobile result cards unobserved.
      const month = businessDate.slice(0, 7);
      const monthInput = content.getByRole('textbox', { name: TIME_ACCOUNT_COPY.month, exact: true });
      await expect(monthInput).toHaveValue(/^\d{2}\.\d{4}$/);
      await monthInput.fill(month);
      // The picker commits a typed month and shows it in German order on blur.
      await monthInput.blur();
      await expect(monthInput).toHaveValue(`${month.slice(5)}.${month.slice(0, 4)}`);
      await content.getByRole('button', { name: TIME_ACCOUNT_COPY.preparePeriod, exact: true }).click();
      // Successful preparation redirects directly to the saved period.
      await expect(page).toHaveURL(/\/zeiterfassung\/perioden\/[0-9a-f-]{36}$/);
      return { route: new URL(page.url()).pathname, heading: TIME_ACCOUNT_COPY.monthlyResults };
    }
    await expect(open).toHaveCount(1);
    const route = await open.getAttribute('href');
    if (!route?.startsWith('/zeiterfassung/perioden/'))
      throw new Error('Period preparation did not expose its exact saved detail route.');
    return { route, heading: TIME_ACCOUNT_COPY.monthlyResults };
  }
  const details = await prepareLayoutDetails(world);
  const names = layoutNames(world);
  switch (pattern) {
    case '/kunden/[clientId]':
      return { route: `/kunden/${details.clientId}`, heading: names.client };
    case '/anfragen/[requestId]':
      return { route: `/anfragen/${details.requestId}`, heading: names.request };
    case '/mitarbeiter/[userId]':
      return {
        route: `/mitarbeiter/${world.users.employee.id}`,
        heading: `${world.users.employee.firstName} ${world.users.employee.lastName}`,
      };
    case '/service/anlagen/[equipmentNumber]':
      return { route: `/service/anlagen/${details.equipmentNumber}`, heading: names.equipment };
    case '/service/faelle/[caseNumber]':
      return { route: `/service/faelle/${details.caseNumber}`, heading: names.serviceCase };
    case '/auftraege/[jobNumber]':
      return { route: `/auftraege/${details.jobNumber}`, heading: names.job };
    case '/auftraege/[jobNumber]/uebergabe':
      return { route: `/auftraege/${details.jobNumber}/uebergabe`, heading: names.job };
    case '/auftraege/projekt/[projectNumber]':
      return { route: `/auftraege/projekt/${details.projectNumber}`, heading: names.project };
    case '/auftraege/projekt/[projectNumber]/uebergabe':
      return { route: `/auftraege/projekt/${details.projectNumber}/uebergabe`, heading: names.project };
    case '/auftraege/projekt/[projectNumber]/[jobNumber]':
      return {
        route: `/auftraege/projekt/${details.projectNumber}/${details.nestedJobNumber}`,
        heading: names.nestedJob,
      };
    case '/auftraege/projekt/[projectNumber]/[jobNumber]/uebergabe':
      return {
        route: `/auftraege/projekt/${details.projectNumber}/${details.nestedJobNumber}/uebergabe`,
        heading: names.nestedJob,
      };
    case '/auftraege/uebergaben/[targetType]/[targetId]':
      return { route: `/auftraege/uebergaben/auftrag/${details.jobId}`, heading: names.job };
  }
}

test.describe('@AUDIT-LAYOUT phone details and route aliases', () => {
  for (const pattern of DYNAMIC_PHONE_ROUTES) {
    test(`admin ${pattern} fits a 375 px viewport`, async ({ adminPage, world, businessDate }, testInfo) => {
      const destination = await detailDestination(pattern, adminPage, world, businessDate);
      await expectPhoneLayout(adminPage, destination.route, testInfo, destination.heading);
      if (pattern === '/zeiterfassung/perioden/[periodId]') {
        const employeeName = `${world.users.employee.firstName} ${world.users.employee.lastName}`;
        await expect(
          monthlyResultListRow(monthlyResults(adminPage), employeeName).getByText(employeeName, {
            exact: true,
          }),
        ).toBeVisible();
      }
    });
  }

  test('admin scoped project handover fits a 375 px viewport', async ({ adminPage, world }, testInfo) => {
    const details = await prepareLayoutDetails(world);
    await expectPhoneLayout(
      adminPage,
      `/auftraege/uebergaben/projekt/${details.projectId}`,
      testInfo,
      layoutNames(world).project,
    );
  });

  for (const pattern of [
    '/auftraege/[jobNumber]',
    '/auftraege/projekt/[projectNumber]/[jobNumber]',
  ] as const) {
    test(`employee ${pattern} work pack fits a 375 px viewport`, async ({
      adminPage,
      employeePage,
      world,
      businessDate,
    }, testInfo) => {
      const destination = await detailDestination(pattern, adminPage, world, businessDate);
      await expectPhoneLayout(employeePage, destination.route, testInfo, destination.heading);
      // A lifecycle transition reloads the pack with a flash param, which the
      // page strips with a route transition while hydration work is pending.
      await employeePage.goto(`${destination.route}?field_transition=updated`);
      await expect(employeePage).toHaveURL(
        (url) => decodeURIComponent(url.pathname) === destination.route && url.search === '',
      );
      // The URL changes before the replace's server render arrives; the loop began after that render.
      await employeePage.waitForLoadState('networkidle');
      await expectMainThreadSettles(employeePage, `${destination.route} after a lifecycle transition`);
    });
  }

  for (const alias of PHONE_REDIRECTS) {
    test(`admin ${alias.route} redirects to its audited page`, async ({ adminPage }, testInfo) => {
      await adminPage.goto(alias.route);
      await expect(adminPage).toHaveURL((url) => url.pathname === alias.destination);
      await expectPhoneLayout(adminPage, alias.destination, testInfo);
    });
  }
});
