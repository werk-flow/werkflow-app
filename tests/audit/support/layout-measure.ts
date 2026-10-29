import { expect, type Locator, type Page } from '@playwright/test';

// The rendered measures of the layout audit (werkflow-design, "Density and
// layout"): the default view of a page, every in-page tab and every dialog.
// Each measure reads the rendered boxes in one page.evaluate, because a size
// container keeps its overflow out of the scroll width and a control can leave
// its card without widening the page.
//
// Sideways scrolling is allowed only inside a named scroll region: an element
// with `data-scroll-region` that a registry component sets itself (the tab
// strip, the area nav, a table from the tablet breakpoint, the calendar
// surfaces, the dispatch batch list). Any other element that scrolls sideways
// fails as an unnamed scroller, and it no longer excuses what it hides.

/** Scroll regions the design canon names, with the narrowest viewport each may scroll at. */
const NAMED_SCROLL_REGIONS: Readonly<Record<string, number>> = {
  calendar: 0,
  'tab-strip': 0,
  'area-nav': 0,
  'batch-list': 0,
  // Below the tablet breakpoint a table is a ListRow card list; a visible table fails on its own.
  table: 768,
};

type PageReport = {
  documentOverflowX: number;
  documentOverflowY: number;
  pageBodyOverflowX: number;
  nativeSelects: number;
  nativeDateLikeInputs: number;
  unapprovedVisibleTables: number;
  unapprovedTableScrollRegions: number;
  contentPastBodyEdge: string[];
  controlsOutsideTheirCard: string[];
  unnamedSidewaysScrollers: string[];
  regionsNotAllowedHere: string[];
};

/**
 * Two frames after a resize, a tab change, a theme switch or an opened layer,
 * then the end of every finite CSS animation and transition, so the measured
 * layout and colors are the settled ones: a theme switch fades colors for
 * 150 ms and a dialog slides in, and axe once read the colors halfway through
 * the fade. A spinner or a skeleton pulse runs forever and is not waited for.
 */
export async function nextFrames(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
    const finite = document
      .getAnimations()
      .filter((animation) => Number.isFinite(Number(animation.effect?.getComputedTiming().endTime)));
    await Promise.race([
      Promise.allSettled(finite.map((animation) => animation.finished)),
      // eslint-disable-next-line test-hygiene/no-wall-clock-wait -- caps a stuck animation; the race ends as soon as the finite animations finish
      new Promise((resolve) => setTimeout(resolve, 2_000)),
    ]);
  });
}

async function measurePage(page: Page): Promise<PageReport> {
  return page.evaluate((regions) => {
    const root = document.documentElement;
    const body = document.querySelector<HTMLElement>('[data-page-body]');
    // Ordinary data tables switch to cards at a phone width, even when their own
    // overflow container conceals them from document-width checks.
    const visibleTables = Array.from(document.querySelectorAll('table')).filter(
      (table) => table.getClientRects().length > 0 && getComputedStyle(table).visibility !== 'hidden',
    );
    const nativeDateTypes = new Set(['date', 'time', 'datetime-local', 'month', 'week', 'number', 'range']);
    // Content belongs to its own region inside a named scroll region, inside a
    // text shortened with an ellipsis (a truncated title is not cut-off
    // content), or inside the scrolling title (`data-marquee`). A region that
    // clips or scrolls without a name does not excuse what it cuts off.
    const insideOwnRegion = (element: Element): boolean => {
      for (let parent = element.parentElement; parent && parent !== body; parent = parent.parentElement) {
        if (parent.hasAttribute('data-scroll-region')) return true;
        const style = getComputedStyle(parent);
        if (style.overflowX !== 'visible' && style.textOverflow === 'ellipsis') return true;
        if (parent.hasAttribute('data-marquee')) return true;
      }
      return false;
    };
    const name = (element: Element): string =>
      `${element.tagName.toLowerCase()} „${(element.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 40)}“`;
    const all = Array.from(body?.querySelectorAll<HTMLElement>('*') ?? []);
    const rendered = all.filter((element) => {
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return (
        box.width > 1 &&
        box.height > 1 &&
        style.visibility !== 'hidden' &&
        style.position !== 'fixed' &&
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
    // `overflow-y: auto` computes `overflow-x` to `auto` too, so the class does
    // not decide whether a region scrolls sideways; its scroll width does.
    const scrollers = all.filter((element) => {
      const style = getComputedStyle(element);
      return (
        (style.overflowX === 'auto' || style.overflowX === 'scroll') &&
        element.scrollWidth > element.clientWidth + 1 &&
        element.getClientRects().length > 0
      );
    });
    const unnamed = scrollers.filter((element) => !element.closest('[data-scroll-region]'));
    const notAllowed = Array.from(body?.querySelectorAll<HTMLElement>('[data-scroll-region]') ?? [])
      .filter((region) => region.scrollWidth > region.clientWidth + 1)
      .filter((region) => {
        const minimum = regions[region.getAttribute('data-scroll-region') ?? ''];
        return minimum === undefined || window.innerWidth < minimum;
      });
    return {
      contentPastBodyEdge: pastEdge
        .filter((element) => !element.parentElement || !pastEdge.includes(element.parentElement))
        .slice(0, 3)
        .map(name),
      controlsOutsideTheirCard: outsideCard.slice(0, 3).map(name),
      unnamedSidewaysScrollers: unnamed.slice(0, 3).map(name),
      regionsNotAllowedHere: notAllowed
        .slice(0, 3)
        .map((region) => `${region.getAttribute('data-scroll-region')} ${name(region)}`),
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
  }, NAMED_SCROLL_REGIONS);
}

/** The sideways measures that hold at every width: no page scroll, nothing past the page body, no control out of its card. */
export async function expectNoSidewaysOverflow(page: Page, label: string): Promise<void> {
  await nextFrames(page);
  const report = await measurePage(page);
  expect(report.documentOverflowX, `${label}: the document must not scroll sideways`).toBe(0);
  expect(report.pageBodyOverflowX, `${label}: content wider than the page body`).toBe(0);
  expect(report.contentPastBodyEdge, `${label}: content past the right edge of the page body`).toEqual([]);
  expect(report.controlsOutsideTheirCard, `${label}: a control sticks out of its card`).toEqual([]);
  expect(
    report.unnamedSidewaysScrollers,
    `${label}: a region scrolls sideways without a scroll-region name`,
  ).toEqual([]);
  expect(
    report.regionsNotAllowedHere,
    `${label}: a scroll region the canon does not allow at this width`,
  ).toEqual([]);
}

/** The phone-only measures on top of the sideways ones: no native controls, no visible table. */
export async function expectPhoneMeasures(page: Page, label: string): Promise<void> {
  await expectNoSidewaysOverflow(page, label);
  const report = await measurePage(page);
  expect(report.documentOverflowY, `${label}: the shell owns vertical scroll, not the document`).toBe(0);
  expect(report.nativeSelects, `${label}: native <select> rendered`).toBe(0);
  expect(report.unapprovedTableScrollRegions, `${label}: nested table scroll hides mobile overflow`).toBe(0);
  expect(report.unapprovedVisibleTables, `${label}: data table has no mobile card layout`).toBe(0);
  expect(report.nativeDateLikeInputs, `${label}: native date/time/number input rendered`).toBe(0);
}

type DialogReport = {
  box: { top: number; right: number; bottom: number; left: number };
  viewport: { width: number; height: number };
  sidewaysScrollers: string[];
  controlsOutsideBox: string[];
  clippedWithoutScroll: string[];
  footerActionsOutOfReach: string[];
  nativeControls: number;
};

/**
 * Measures an open dialog, alert dialog or sheet. The footer is checked with
 * the dialog body scrolled to its end, the way a user reaches it; the body's
 * scroll position is restored afterwards.
 */
async function measureDialog(dialog: Locator): Promise<DialogReport> {
  return dialog.evaluate((layer) => {
    const name = (element: Element): string =>
      `${element.tagName.toLowerCase()} „${(element.getAttribute('aria-label') ?? element.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 40)}“`;
    const box = layer.getBoundingClientRect();
    const visible = (element: Element): boolean => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 1 && rect.height > 1 && style.visibility !== 'hidden';
    };
    const all = [layer, ...Array.from(layer.querySelectorAll<HTMLElement>('*'))];
    const insideOwnRegion = (element: Element): boolean => {
      for (
        let parent = element.parentElement;
        parent && parent !== layer.parentElement;
        parent = parent.parentElement
      ) {
        if (parent.hasAttribute('data-scroll-region')) return true;
        const style = getComputedStyle(parent);
        if (style.overflowX !== 'visible' && style.textOverflow === 'ellipsis') return true;
      }
      return false;
    };
    const verticalScroller = (element: Element): Element | null => {
      for (
        let parent = element.parentElement;
        parent && parent !== layer.parentElement;
        parent = parent.parentElement
      ) {
        const style = getComputedStyle(parent);
        if (
          (style.overflowY === 'auto' || style.overflowY === 'scroll') &&
          parent.scrollHeight > parent.clientHeight + 1
        )
          return parent;
      }
      return null;
    };
    const sideways = all.filter((element) => {
      const style = getComputedStyle(element);
      return (
        (style.overflowX === 'auto' || style.overflowX === 'scroll' || element === layer) &&
        element.scrollWidth > element.clientWidth + 1 &&
        !element.closest('[data-scroll-region]') &&
        visible(element)
      );
    });
    const controls = all.filter(
      (element) =>
        element.matches(
          'button, a[href], input, textarea, [role="combobox"], [role="tab"], [role="checkbox"]',
        ) &&
        visible(element) &&
        !insideOwnRegion(element),
    );
    const outside = controls.filter((element) => {
      const rect = element.getBoundingClientRect();
      return rect.right > box.right + 1 || rect.left < box.left - 1;
    });
    // Content below the layer's lower edge must sit inside a region that
    // scrolls vertically, or the user cannot reach it.
    const clipped = all
      .filter((element) => visible(element) && element.getBoundingClientRect().bottom > box.bottom + 1)
      .filter((element) => !verticalScroller(element));
    const footer = layer.querySelector(
      '[data-slot="dialog-footer"], [data-slot="alert-dialog-footer"], [data-slot="sheet-footer"]',
    );
    const scrollBody = layer.querySelector<HTMLElement>('[data-slot="dialog-body"]');
    const previousScroll = scrollBody?.scrollTop ?? 0;
    if (scrollBody) scrollBody.scrollTop = scrollBody.scrollHeight;
    const outOfReach = Array.from(footer?.querySelectorAll<HTMLElement>('button, a[href]') ?? [])
      .filter(visible)
      .filter((button) => {
        const rect = button.getBoundingClientRect();
        return (
          rect.left < Math.max(0, box.left) - 1 ||
          rect.right > Math.min(window.innerWidth, box.right) + 1 ||
          rect.top < -1 ||
          rect.bottom > window.innerHeight + 1
        );
      })
      .map(name);
    if (scrollBody) scrollBody.scrollTop = previousScroll;
    const nativeDateTypes = new Set(['date', 'time', 'datetime-local', 'month', 'week', 'number', 'range']);
    return {
      box: { top: box.top, right: box.right, bottom: box.bottom, left: box.left },
      viewport: { width: window.innerWidth, height: window.innerHeight },
      sidewaysScrollers: sideways.slice(0, 3).map(name),
      controlsOutsideBox: outside.slice(0, 3).map(name),
      clippedWithoutScroll: clipped
        .filter((element) => !element.parentElement || !clipped.includes(element.parentElement))
        .slice(0, 3)
        .map(name),
      footerActionsOutOfReach: outOfReach,
      nativeControls:
        layer.querySelectorAll('select:not([aria-hidden="true"])').length +
        Array.from(layer.querySelectorAll('input')).filter((input) => nativeDateTypes.has(input.type)).length,
    };
  });
}

/** Asserts the dialog measures of `measureDialog` with one label per failure. */
export async function expectDialogFits(dialog: Locator, label: string): Promise<void> {
  await nextFrames(dialog.page());
  const report = await measureDialog(dialog);
  const { box, viewport } = report;
  expect(
    box.left >= -1 && box.top >= -1 && box.right <= viewport.width + 1 && box.bottom <= viewport.height + 1,
    `${label}: the dialog lies inside the ${viewport.width}x${viewport.height} viewport (box ${JSON.stringify(box)})`,
  ).toBe(true);
  expect(report.sidewaysScrollers, `${label}: the dialog or a region in it scrolls sideways`).toEqual([]);
  expect(report.controlsOutsideBox, `${label}: a control leaves the dialog's box`).toEqual([]);
  expect(
    report.clippedWithoutScroll,
    `${label}: content below the dialog edge without a vertical scroll region`,
  ).toEqual([]);
  expect(report.footerActionsOutOfReach, `${label}: a footer action is out of reach`).toEqual([]);
  expect(report.nativeControls, `${label}: a native select, date, time or number control`).toBe(0);
}

/**
 * The field worker's touch targets (werkflow-design, "Density and layout"):
 * every button, tab, link row and the clock button in the scope measures at
 * least 44 x 44 CSS px. Returns the targets that are smaller.
 */
async function smallTouchTargets(scope: Locator): Promise<string[]> {
  return scope.evaluate((root) => {
    const targets = Array.from(
      root.querySelectorAll<HTMLElement>(
        '[data-slot="button"], [role="tab"], [data-clock-fab], [data-slot="list-row"] a[href], a[data-slot="list-row"]',
      ),
    ).filter((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return (
        rect.width > 1 && rect.height > 1 && style.visibility !== 'hidden' && !element.closest('[inert]')
      );
    });
    return targets
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width < 44 - 0.5 || rect.height < 44 - 0.5;
      })
      .slice(0, 5)
      .map((element) => {
        const rect = element.getBoundingClientRect();
        const label = (element.getAttribute('aria-label') ?? element.textContent ?? '')
          .trim()
          .replace(/\s+/g, ' ');
        return `${element.tagName.toLowerCase()} „${label.slice(0, 30)}“ ${Math.round(rect.width)}x${Math.round(rect.height)}`;
      });
  });
}

/** Soft by default: every field-worker target in the scope measures at least 44 x 44 CSS px. */
export async function expectTouchTargets(
  scope: Locator,
  label: string,
  options: { soft?: boolean } = {},
): Promise<void> {
  const check = options.soft === false ? expect : expect.soft;
  check(await smallTouchTargets(scope), `${label}: touch targets below 44 x 44 px`).toEqual([]);
}
