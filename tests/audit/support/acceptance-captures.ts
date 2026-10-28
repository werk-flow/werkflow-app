import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, type Browser, type Locator, type Page, type TestInfo } from '@playwright/test';
import { z } from '../../../lib/zod';
import { browserTestIdentity } from '../../../lib/testing/evidence/test-evidence';
import { withFileLock, writeJsonAtomically } from '../../../lib/testing/runner/file-lock';
import { browserRunPaths } from '../../../lib/testing/runs/run-paths';
import { settled } from '../../golden/support/steps/interaction';
import { inPageTab } from '../../golden/support/steps/shared';
import { clockInLauncher } from '../../golden/support/steps/time-tracking';
import { currentRunKey } from '../../golden/support/run-state';
import type { TestWorld } from '../../golden/support/world';
import { standaloneScreen } from '../../../lib/testing/selection/standalone-route-inventory';
import type { CaptureSpec, StandaloneCaptureSpec } from './acceptance-sets';
import { stateCapturePlan, type CaptureState } from './acceptance-state-plan';
import { withState } from './acceptance-states';
import { DIALOG_OPENERS } from './dialog-openers';
import { openLayerAt } from './open-layer';
import { DESKTOP, VIEWPORT_HEIGHT } from './open-layer-plan';
import { openStandaloneScreen } from './standalone-sessions';
import { openSurface, surfaceDestination } from './surface-routes';

// The capture fixture of rendered acceptance (docs/technical/standards-audit.md,
// "Rendered design acceptance"). It refuses to write a capture of a screen that
// is not ready: the URL must be the requested page (never the login), the page
// title visible, every busy signal settled, the fonts loaded, the clock button
// ready and no failed region on screen. A capture that declares a `state`
// asks for its loading or error state instead, which the fixture produces and
// proves (captureState below). Each image lands under
// `<run>/acceptance/<set>/` with an entry in `<run>/acceptance/index.json`;
// the entry turns `passed` only when its test passed.

const REPOSITORY_ROOT = resolve(__dirname, '../../..');
const ACCEPTANCE_INDEX_FILE = 'index.json';

const entrySchema = z
  .object({
    set: z.string().min(1),
    capture: z.string().min(1),
    /** `<set>/<capture>-<width>-<scheme>.png`, relative to the acceptance folder. */
    file: z.string().min(1),
    testId: z.string().min(1),
    route: z.string().min(1),
    /** The app role, or the session of a screen outside the app shell. */
    role: z.enum(['admin', 'employee', 'anonymous', 'newcomer', 'subscriber', 'prestart']),
    view: z.enum(['page', 'tab', 'dialog', 'standalone']),
    width: z.number().int().positive(),
    height: z.number().int().nonnegative(),
    scheme: z.enum(['light', 'dark']),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    capturedAt: z.iso.datetime(),
    status: z.enum(['captured', 'passed', 'failed']),
  })
  .strict();

const acceptanceIndexSchema = z.object({ version: z.literal(1), entries: z.array(entrySchema) }).strict();

type AcceptanceEntry = z.infer<typeof entrySchema>;

/** The identity the run manifest records for the test's outcome. */
function testIdentityOf(testInfo: TestInfo): string {
  return browserTestIdentity({
    repositoryRoot: REPOSITORY_ROOT,
    file: testInfo.file,
    titles: testInfo.titlePath.slice(1),
  });
}

function acceptanceDirectory(): string {
  return resolve(browserRunPaths(REPOSITORY_ROOT, currentRunKey()).directory, 'acceptance');
}

function updateIndex(change: (entries: AcceptanceEntry[]) => AcceptanceEntry[]): void {
  const directory = acceptanceDirectory();
  mkdirSync(directory, { recursive: true });
  const path = resolve(directory, ACCEPTANCE_INDEX_FILE);
  withFileLock(`${path}.lock`, () => {
    const current = existsSync(path)
      ? acceptanceIndexSchema.parse(JSON.parse(readFileSync(path, 'utf8')))
      : { version: 1 as const, entries: [] };
    writeJsonAtomically(path, { version: 1, entries: change(current.entries) });
  });
}

/** After the test: its captures count as evidence only when the test passed. */
export function settleAcceptanceEntries(testInfo: TestInfo): void {
  const status = testInfo.status === 'passed' ? 'passed' : 'failed';
  if (!existsSync(resolve(acceptanceDirectory(), ACCEPTANCE_INDEX_FILE))) return;
  updateIndex((entries) =>
    entries.map((entry) => (entry.testId === testIdentityOf(testInfo) ? { ...entry, status } : entry)),
  );
}

/** The screen is ready to be judged: requested page, title, settled, fonts, clock button, no failed region. */
async function expectReady(page: Page, scope: Locator, view: CaptureSpec['view']['kind']): Promise<void> {
  await expect(page, 'a capture of a sign-in or onboarding screen is missing evidence').not.toHaveURL(
    /\/(login|signup|onboarding)(\/|$)/,
  );
  // An open modal hides the page from the accessibility tree, so the title is read in the DOM.
  await expect
    .poll(() => page.locator('h1').count(), { message: 'the page title is rendered' })
    .toBeGreaterThan(0);
  await expect(scope).toBeVisible();
  // A dialog may belong to a save the page holds open (the planning warning of a
  // move), so a dialog capture settles its layer, as the layout audit does; the
  // page behind it settled before its trigger was pressed.
  await settled(view === 'dialog' ? scope : page);
  await expect(page.locator('[data-slot="section-error"]:visible')).toHaveCount(0);
  const launcher = clockInLauncher(page);
  if (await launcher.count()) await expect(launcher).toBeEnabled();
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
}

type CaptureIdentity = Pick<AcceptanceEntry, 'role' | 'view'> & { id: string };

async function writeCapture(
  page: Page,
  testInfo: TestInfo,
  set: string,
  capture: CaptureIdentity,
  route: string,
  requestedWidth: number,
  scheme: 'light' | 'dark',
): Promise<void> {
  // The image names the width it was rendered at, which an opener's own viewport may override.
  const viewport = page.viewportSize();
  const renderedWidth = viewport?.width ?? requestedWidth;
  const file = `${set}/${capture.id}-${renderedWidth}-${scheme}.png`;
  const path = resolve(acceptanceDirectory(), file);
  mkdirSync(resolve(path, '..'), { recursive: true });
  const image = await page.screenshot({ path, animations: 'disabled', caret: 'hide', scale: 'css' });
  updateIndex((entries) => [
    ...entries.filter((entry) => entry.file !== file),
    {
      set,
      capture: capture.id,
      file,
      testId: testIdentityOf(testInfo),
      route,
      role: capture.role,
      view: capture.view,
      width: renderedWidth,
      height: viewport?.height ?? 0,
      scheme,
      sha256: createHash('sha256').update(image).digest('hex'),
      capturedAt: new Date().toISOString(),
      status: 'captured',
    },
  ]);
  await testInfo.attach(file, { body: image, contentType: 'image/png' });
}

/**
 * Captures a spec in its declared loading or error state at each width and
 * scheme: each width reaches the state anew through the test's route
 * interception (acceptance-states.ts), and the image is written only while
 * exactly that state is on screen.
 */
async function captureState(
  input: { page: Page; world: TestWorld; businessDate: string; testInfo: TestInfo },
  set: string,
  capture: CaptureSpec & { state: CaptureState },
  route: string,
): Promise<void> {
  const { page, world, businessDate, testInfo } = input;
  const plan = stateCapturePlan(capture.state, capture.view.kind);
  const context = { page, role: capture.role, world, businessDate, route };
  const identity = { id: capture.id, role: capture.role, view: capture.view.kind };
  try {
    for (const width of capture.widths)
      await withState(context, capture.view, plan, width, async (prove) => {
        for (const scheme of capture.schemes) {
          await page.emulateMedia({ colorScheme: scheme });
          await prove();
          await writeCapture(page, testInfo, set, identity, route, width, scheme);
        }
      });
  } finally {
    await page.emulateMedia({ colorScheme: 'light' });
  }
}

/**
 * Captures one spec of a set at each of its widths and schemes: the page, one
 * of its tabs, or one of its dialogs opened the way the layout audit opens it.
 */
export async function captureAcceptance(
  input: { page: Page; world: TestWorld; businessDate: string; testInfo: TestInfo },
  set: string,
  capture: CaptureSpec,
): Promise<void> {
  const { page, world, businessDate, testInfo } = input;
  await page.setViewportSize(DESKTOP);
  const destination = await surfaceDestination(capture.route, page, world, businessDate);
  if (capture.state) {
    await captureState(input, set, { ...capture, state: capture.state }, destination.route);
    return;
  }
  await openSurface(page, destination);
  const context = { page, role: capture.role, world, businessDate, route: destination.route };
  try {
    for (const [index, width] of capture.widths.entries()) {
      let scope: Locator = page.locator('[data-page-body]').first();
      if (capture.view.kind === 'dialog') {
        // Each width opens the dialog anew, the way a user at that width opens it.
        ({ layer: scope } = await openLayerAt(context, DIALOG_OPENERS[capture.view.opener], width, {
          fresh: true,
        }));
      } else {
        await page.setViewportSize({ width, height: VIEWPORT_HEIGHT[width] ?? 800 });
        if (capture.view.kind === 'tab' && index === 0) {
          const tab = inPageTab(page.getByRole('main'), capture.view.value);
          await tab.click();
          await expect(tab).toHaveAttribute('data-state', 'active');
        }
      }
      const identity = { id: capture.id, role: capture.role, view: capture.view.kind };
      for (const scheme of capture.schemes) {
        await page.emulateMedia({ colorScheme: scheme });
        await expectReady(page, scope, capture.view.kind);
        await writeCapture(page, testInfo, set, identity, destination.route, width, scheme);
      }
      if (capture.view.kind === 'dialog') await page.emulateMedia({ colorScheme: 'light' });
    }
  } finally {
    await page.emulateMedia({ colorScheme: 'light' });
  }
}

/**
 * Captures a screen outside the app shell at each width and scheme. The screen
 * opens with the session its inventory entry names, and the session helper
 * refuses a redirect, so the image shows the requested screen.
 */
export async function captureStandalone(
  input: { browser: Browser; baseURL: string | undefined; world: TestWorld; testInfo: TestInfo },
  set: string,
  capture: StandaloneCaptureSpec,
): Promise<void> {
  const screen = standaloneScreen(capture.screen);
  const { context, page } = await openStandaloneScreen({ ...input, screen });
  try {
    const identity = { id: capture.id, role: screen.session, view: 'standalone' } as const;
    for (const width of capture.widths) {
      await page.setViewportSize({ width, height: VIEWPORT_HEIGHT[width] ?? 800 });
      for (const scheme of capture.schemes) {
        await page.emulateMedia({ colorScheme: scheme });
        await settled(page);
        await expect(page.locator('[data-slot="section-error"]:visible')).toHaveCount(0);
        await page.evaluate(async () => {
          await document.fonts.ready;
        });
        await writeCapture(page, input.testInfo, set, identity, screen.path, width, scheme);
      }
    }
  } finally {
    await context.close();
  }
}
