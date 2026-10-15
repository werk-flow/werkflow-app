import { expect, type Locator, type Page } from '@playwright/test';
import type { DialogAuditTarget } from '../../../lib/testing/selection/dialog-inventory';
import type { SurfaceTest } from '../../../lib/testing/selection/surface-groups';
import { dismissDialog, settled } from '../../golden/support/steps/interaction';
import { inPageTab } from '../../golden/support/steps/shared';
import { expectNoAxeViolations } from './axe';
import type { DialogOpener } from './dialog-opener';
import { DIALOG_OPENERS } from './dialog-openers';
import {
  expectDialogFits,
  expectNoSidewaysOverflow,
  expectPhoneMeasures,
  nextFrames,
} from './layout-measure';
import { expectKeyboardPath } from './keyboard-path';
import { openLayerAt } from './open-layer';
import type { SurfaceContext } from './surface-fixtures';
import { openSurface, surfaceDestination } from './surface-routes';

// The rendered audit of the inventories (werkflow-design, "Checklist"): every
// page of the route inventory in both themes, every in-page tab at every
// width, every dialog at 1280, 768 and 375 px with its keyboard path. The
// checks are soft, so one run names every defect of a page instead of the
// first; the test still fails on any of them.

const PHONE = { width: 375, height: 812 } as const;
const DESKTOP = { width: 1280, height: 800 } as const;

/** The canon's widths: the phone, the upright tablet, two laptops and the wide desktop. */
const TAB_VIEWPORTS = [
  PHONE,
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  DESKTOP,
  { width: 1680, height: 1050 },
] as const;

const DIALOG_VIEWPORTS = [DESKTOP, { width: 768, height: 1024 }, PHONE] as const;

type Scheme = 'light' | 'dark';

async function inScheme(page: Page, scheme: Scheme, run: () => Promise<void>): Promise<void> {
  await page.emulateMedia({ colorScheme: scheme });
  try {
    await nextFrames(page);
    await run();
  } finally {
    await page.emulateMedia({ colorScheme: 'light' });
  }
}

/** Axe in light and dark at the current width. */
async function axeBothThemes(page: Page, label: string, options: { include?: string; fieldWorker: boolean }) {
  for (const scheme of ['light', 'dark'] as const)
    await inScheme(page, scheme, async () => {
      await expectNoAxeViolations(page, `${label}, ${scheme}`, options).catch((error: unknown) => {
        expect.soft(error, `${label}, ${scheme}`).toBeUndefined();
      });
    });
}

async function softly(label: string, check: () => Promise<void>): Promise<void> {
  await check().catch((error: unknown) => {
    expect.soft(String(error).split('\n').slice(0, 12).join('\n'), label).toBe('');
  });
}

/** The page's default view: axe in both themes at 375 and 1280 px. */
async function auditDefaultView(context: SurfaceContext): Promise<void> {
  const { page, role, route } = context;
  const fieldWorker = role === 'employee';
  for (const viewport of [DESKTOP, PHONE]) {
    await page.setViewportSize(viewport);
    await settled(page);
    await axeBothThemes(page, `${role} ${route} at ${viewport.width} px`, { fieldWorker });
  }
  await page.setViewportSize(DESKTOP);
}

/**
 * One in-page tab: opened through its trigger, then the default-view measures
 * at every width, the strip keeping the active tab in view, and axe in both
 * themes at 375 and 1280 px.
 */
async function auditPageTab(context: SurfaceContext, value: string): Promise<void> {
  const { page, role, route } = context;
  const label = `${role} ${route} tab ${value}`;
  await page.setViewportSize(DESKTOP);
  const trigger = inPageTab(page.getByRole('main'), value);
  await trigger.click();
  await expect(trigger).toHaveAttribute('data-state', 'active');
  await settled(page);
  for (const viewport of TAB_VIEWPORTS) {
    await page.setViewportSize(viewport);
    const at = `${label} at ${viewport.width} px`;
    await softly(at, () =>
      viewport.width === PHONE.width ? expectPhoneMeasures(page, at) : expectNoSidewaysOverflow(page, at),
    );
    await softly(`${at}: the active tab stays in its strip's view`, () =>
      expect(trigger).toBeInViewport({ ratio: 0.95 }),
    );
    if (viewport.width === PHONE.width || viewport.width === DESKTOP.width)
      await axeBothThemes(page, at, { fieldWorker: role === 'employee' });
  }
  await page.setViewportSize(DESKTOP);
}

/** The dialog measures at the current width and axe at 375 and 1280 px. */
async function measureLayer(
  page: Page,
  layer: Locator,
  label: string,
  role: SurfaceContext['role'],
): Promise<void> {
  const width = page.viewportSize()?.width ?? DESKTOP.width;
  await softly(label, () => expectDialogFits(layer, label));
  if (width !== 768)
    await axeBothThemes(page, label, {
      include: '[role="dialog"], [role="alertdialog"]',
      fieldWorker: role === 'employee',
    });
}

/**
 * One dialog of the inventory: opened from its trigger with Enter at 1280 px,
 * focus and Tab order checked, closed with Escape with focus back on the
 * trigger; then opened anew at 1280, 768 and 375 px, the way a user at each
 * width opens it, and measured with axe in both themes at 1280 and 375, each
 * of its own tabs measured the same way. Nothing is saved.
 */
async function auditDialog(
  context: SurfaceContext,
  target: DialogAuditTarget,
  opener: DialogOpener,
): Promise<void> {
  const { page, role } = context;
  const label = `${role} ${target.route} dialog ${target.opener}`;
  const closeParents = async (): Promise<void> => {
    for (const parent of opener.parents?.(page) ?? []) await dismissDialog(parent);
  };
  // The keyboard path at the trigger's own width: first focus, the Tab cycle,
  // Escape and focus return.
  const first = await openLayerAt(context, opener, opener.viewport?.width ?? DESKTOP.width, { fresh: false });
  await expectKeyboardPath(page, first.layer, label);
  await dismissDialog(first.layer);
  const returned = opener.returnFocus?.(context) ?? first.trigger;
  await softly(`${label}: Escape returns focus to the trigger`, () => expect(returned).toBeFocused());
  await closeParents();
  for (const viewport of DIALOG_VIEWPORTS) {
    const { layer } = await openLayerAt(context, opener, viewport.width, { fresh: true });
    const at = `${label} at ${viewport.width} px`;
    await measureLayer(page, layer, at, role);
    for (const value of target.tabs ?? []) {
      const tab = inPageTab(layer, value);
      await tab.click();
      await expect(tab).toHaveAttribute('data-state', 'active');
      await settled(layer);
      await measureLayer(page, layer, `${label} tab ${value} at ${viewport.width} px`, role);
    }
  }
  await page.setViewportSize(DESKTOP);
}

/** No dialog, alert dialog or sheet is open on the page. */
async function noLayerOpen(page: Page): Promise<boolean> {
  return page.evaluate(() => document.querySelectorAll('[role="dialog"], [role="alertdialog"]').length === 0);
}

/**
 * One test of a surface group: opens the page for the role, audits its default
 * view and tabs when the test owns them, then each of its dialogs from a
 * freshly loaded page, so no dialog inherits the state another one left.
 */
export async function auditSurfaceTest(
  session: Omit<SurfaceContext, 'route'>,
  piece: SurfaceTest,
): Promise<void> {
  const { page, world, businessDate } = session;
  await page.setViewportSize(DESKTOP);
  const destination = await surfaceDestination(piece.route, page, world, businessDate);
  await openSurface(page, destination);
  const context: SurfaceContext = { ...session, route: destination.route };
  if (piece.defaultView) await auditDefaultView(context);
  for (const tab of piece.tabs) await auditPageTab(context, tab);
  let fresh = piece.tabs.length === 0;
  for (const dialog of piece.dialogs) {
    const opener = DIALOG_OPENERS[dialog.opener];
    if (!opener) throw new Error(`No opener implements ${dialog.opener}.`);
    if (!fresh || !(await noLayerOpen(page))) {
      await page.setViewportSize(DESKTOP);
      await openSurface(page, destination);
    }
    await auditDialog(context, dialog, opener);
    fresh = false;
  }
}
