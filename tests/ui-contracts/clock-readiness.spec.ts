import { expect, test, type Page } from '@playwright/test';
import { assertWorkspaceTestLock } from '@/lib/testing/workspace-test-lock';
import type { LiveClockState } from '@/lib/time-tracking/types';
import { CLOCK_ORGANIZATION_ID, RUNNING_CLOCK_STATE } from './clock-state-fixture';

declare global {
  interface Window {
    clockReadCancellation: {
      signals: AbortSignal[];
      abortEvents: number;
      releaseOldRead: (() => void) | null;
    };
  }
}

async function mountClock(page: Page, options: { withStyles?: boolean } = {}): Promise<void> {
  assertWorkspaceTestLock();
  const bundle = process.env.WERKFLOW_UI_CONTRACT_BUNDLE;
  const css = process.env.WERKFLOW_UI_CONTRACT_CSS;
  if (!bundle || !css) throw new Error('Run through bun tests/ui-contracts/run.ts.');
  await page.route('http://localhost/ui-contracts**', (route) => route.fulfill({
    contentType: 'text/html',
    body: '<html lang="de"><body><div id="root"></div></body></html>',
  }));
  await page.goto('http://localhost/ui-contracts');
  if (options.withStyles) await page.addStyleTag({ path: css });
  await page.evaluate(() => {
    window.uiContractFixture = 'clock';
    window.clockContract = { transitions: [], directResult: null, resolveTransition: null };
  });
  await page.addScriptTag({ path: bundle });
}

const RESUME_JOB = {
  id: '40000000-0000-4000-8000-000000000001',
  title: 'Heizungswartung Müller',
  jobNumber: 'A-2026-0142',
  status: 'in_bearbeitung',
  projectName: null,
  clientName: 'Familie Müller',
};
const BREAK_CLOCK_STATE: LiveClockState = {
  ...RUNNING_CLOCK_STATE,
  status: 'on_break',
  isOnBreak: true,
  breakStartTime: RUNNING_CLOCK_STATE.statusStartedAt,
  currentActivity: { kind: 'break', allocationKind: 'none' },
  resumeActivity: { kind: 'work', allocationKind: 'job', jobId: RESUME_JOB.id },
  resumeJobInfo: RESUME_JOB,
};

const RESUMED_CLOCK_STATE: LiveClockState = {
  ...RUNNING_CLOCK_STATE,
  sessionVersion: 8,
  activeJobId: RESUME_JOB.id,
  activeJobInfo: RESUME_JOB,
  currentActivity: { kind: 'work', allocationKind: 'job', jobId: RESUME_JOB.id },
  resumeActivity: { kind: 'work', allocationKind: 'job', jobId: RESUME_JOB.id },
  resumeJobInfo: RESUME_JOB,
};

test('a break resumes its job from the hot key and the sheet, and hot keys wait for readiness', async ({ page }) => {
  let releaseRead: () => void = () => { throw new Error('Read barrier was not initialized.'); };
  const heldRead = new Promise<void>((resolve) => { releaseRead = resolve; });
  let resumed = false;
  await page.route('**/api/time-tracking-state?**', async (route) => {
    await heldRead;
    await route.fulfill({ json: { success: true, state: resumed ? RESUMED_CLOCK_STATE : BREAK_CLOCK_STATE } });
  });
  await mountClock(page);
  await expect(page.getByRole('button', { name: 'Zeiterfassung starten', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: /^Weiter: Arbeit/ })).toHaveCount(0);
  releaseRead();
  const resumeHotKey = page.getByRole('button', { name: 'Weiter: Arbeit · Heizungswartung Müller', exact: true });
  await expect(resumeHotKey).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Weiter ohne Auftrag', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Laufende Zeiterfassung öffnen', exact: true }).click();
  const sheet = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Laufende Zeiterfassung' }) });
  await expect(sheet.getByRole('button', { name: 'Weiter: Arbeit · Heizungswartung Müller', exact: true })).toBeVisible();
  await expect(sheet.getByRole('button', { name: 'Anderer Auftrag …', exact: true })).toBeVisible();
  await expect(sheet.getByRole('button', { name: 'Erfassung beenden', exact: true })).toBeVisible();
  await expect(sheet.getByRole('button', { name: 'Weitere Aktivitäten …', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);

  await resumeHotKey.click();
  await expect.poll(() => page.evaluate(() => window.clockContract.transitions.length)).toBe(1);
  expect(await page.evaluate(() => window.clockContract.transitions[0])).toMatchObject({
    action: 'switch',
    expectedSessionId: BREAK_CLOCK_STATE.sessionId,
    expectedVersion: 7,
    selection: { kind: 'work', allocationKind: 'job', jobId: RESUME_JOB.id },
  });
  await expect(resumeHotKey).toBeDisabled();
  resumed = true;
  await page.evaluate(() => { window.clockContract.resolveTransition?.(); });
  await expect(page.getByRole('button', { name: /^Arbeit · Heizungswartung Müller/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeEnabled();
});

test('with the app stylesheet at phone width every clock action is a 44 px target and the selected tile is not clipped', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/time-tracking-state?**', (route) => route.fulfill({ json: { success: true, state: BREAK_CLOCK_STATE } }));
  await mountClock(page, { withStyles: true });
  const hotKey = page.getByRole('button', { name: 'Weiter: Arbeit · Heizungswartung Müller', exact: true });
  await expect(hotKey).toBeEnabled();
  const hotKeyHeight = await hotKey.evaluate((element) => element.getBoundingClientRect().height);
  expect(hotKeyHeight).toBeGreaterThanOrEqual(44);

  await page.getByRole('button', { name: 'Laufende Zeiterfassung öffnen', exact: true }).click();
  const sheet = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Laufende Zeiterfassung' }) });
  const actionHeights = await sheet.getByRole('group', { name: 'Nächste Aktion' }).getByRole('button').evaluateAll(
    (elements) => elements.map((element) => element.getBoundingClientRect().height)
  );
  expect(actionHeights.length).toBeGreaterThan(0);
  for (const height of actionHeights) expect(height).toBeGreaterThanOrEqual(44);

  await sheet.getByRole('button', { name: 'Weitere Aktivitäten …', exact: true }).click();
  const dialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Aktivität wechseln' }) });
  const selectedTile = dialog.getByRole('button', { name: 'Pause', exact: true });
  await expect(selectedTile).toHaveAttribute('aria-pressed', 'true');
  const geometry = await selectedTile.evaluate((element) => {
    const body = element.closest('[data-slot="dialog-body"]');
    if (!body) throw new Error('The activity dialog must scroll inside DialogBody.');
    const tile = element.getBoundingClientRect();
    const scroller = body.getBoundingClientRect();
    const style = getComputedStyle(element);
    return { tileTop: tile.top, tileBottom: tile.bottom, scrollerTop: scroller.top, scrollerBottom: scroller.bottom, borderColor: style.borderTopColor, boxShadow: style.boxShadow };
  });
  // Selection is drawn inside the tile's box (an orange border), never as an
  // outer ring the scroll container would clip on the first row. The border
  // check also pins that the global border-color rule stays in the base layer.
  expect(geometry.tileTop).toBeGreaterThanOrEqual(geometry.scrollerTop);
  expect(geometry.tileBottom).toBeLessThanOrEqual(geometry.scrollerBottom);
  expect(geometry.borderColor).toBe('rgb(255, 121, 0)');
  expect(geometry.boxShadow).not.toContain('rgb(255, 121, 0)');
});

test('unknown clock state blocks real controls and direct calls until the canonical session loads', async ({ page }) => {
  let releaseRead: () => void = () => { throw new Error('Read barrier was not initialized.'); };
  const heldRead = new Promise<void>((resolve) => { releaseRead = resolve; });
  let reads = 0;
  await page.route('**/api/time-tracking-state?**', async (route) => {
    expect(route.request().method()).toBe('GET');
    const url = new URL(route.request().url());
    expect(url.searchParams.get('organizationId')).toBe(CLOCK_ORGANIZATION_ID);
    expect(url.searchParams.get('kind')).toBe('clock');
    reads += 1;
    await heldRead;
    await route.fulfill({ json: { success: true, state: { ...RUNNING_CLOCK_STATE, sessionVersion: reads > 1 ? 8 : 7 } } });
  });
  await mountClock(page);
  await expect.poll(() => reads).toBe(1);
  await expect(page.getByRole('button', { name: 'Zeiterfassung starten', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Direkter Startversuch' }).click();
  await expect.poll(() => page.evaluate(() => window.clockContract.directResult)).toEqual({ success: false, error: 'time_transition_failed' });
  expect(await page.evaluate(() => window.clockContract.transitions)).toEqual([]);
  await page.getByRole('button', { name: 'Aktivitätsdialog prüfen' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: 'Starten', exact: true })).toBeDisabled();
  await expect(dialog.getByRole('status')).toHaveText('Zeitstatus wird geladen…');
  releaseRead();
  // The dialog preselects the running activity; confirming that is not a
  // switch and stays disabled until something changes (owner rule, 2026-09-17).
  await expect(dialog.getByRole('button', { name: 'Erfassung beenden', exact: true })).toBeEnabled();
  await expect(dialog.getByRole('button', { name: 'Aktivität wechseln', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Fahrt', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Aktivität wechseln', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Aktivität wechseln', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.clockContract.transitions.length)).toBe(1);
  expect(await page.evaluate(() => window.clockContract.transitions[0])).toMatchObject({
    organizationId: CLOCK_ORGANIZATION_ID,
    action: 'switch',
    expectedSessionId: RUNNING_CLOCK_STATE.sessionId,
    expectedVersion: 7,
    selection: { kind: 'travel', allocationKind: 'unallocated', jobId: null, travelRoute: 'unspecified', travelRole: 'unspecified' },
  });
  await expect(dialog.getByRole('button', { name: 'Aktivität wechseln', exact: true })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Erfassung beenden', exact: true })).toBeDisabled();
  await page.evaluate(() => { window.clockContract.resolveTransition?.(); });
  await expect(dialog).toHaveCount(0);
  await expect(page.getByLabel('Zeitstatus', { exact: true })).toHaveText('Bereit: 8');
});

test('clock refresh aborts its obsolete GET and rejects a late response from that read', async ({ page }) => {
  await page.addInitScript((runningState) => {
    window.clockReadCancellation = { signals: [], abortEvents: 0, releaseOldRead: null };
    // The fixture's service boundary captures this fetch and forwards clock GETs.
    window.fetch = Object.assign(async (input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> => {
      const request = new Request(input instanceof Request ? input : new URL(String(input), location.href), init);
      const url = new URL(request.url);
      if (request.method !== 'GET' || url.pathname !== '/api/time-tracking-state'
        || url.searchParams.get('kind') !== 'clock'
        || url.searchParams.get('organizationId') !== runningState.organizationId) {
        throw new Error('Unexpected request in the clock cancellation contract.');
      }
      const observation = window.clockReadCancellation;
      observation.signals.push(request.signal);
      request.signal.addEventListener('abort', () => { observation.abortEvents += 1; }, { once: true });
      if (observation.signals.length === 1) {
        // Deliberately allow late completion despite abort, exercising both safeguards.
        return new Promise<Response>((resolve) => {
          observation.releaseOldRead = () => resolve(Response.json({ success: true, state: runningState }));
        });
      }
      return Response.json({ success: true, state: { ...runningState, sessionVersion: 8 } });
    }, {
      preconnect: () => { throw new Error('Unexpected preconnect in the clock cancellation contract.'); },
    });
  }, RUNNING_CLOCK_STATE);
  await mountClock(page);
  await expect.poll(() => page.evaluate(() => window.clockReadCancellation.signals.length)).toBe(1);
  await expect(page.getByRole('button', { name: 'Zeiterfassung starten', exact: true })).toBeDisabled();
  expect(await page.evaluate(() => window.clockReadCancellation.signals[0]?.aborted)).toBe(false);
  await page.getByRole('button', { name: 'Zeitstatus aktualisieren', exact: true }).click();
  await expect.poll(() => page.evaluate(() => ({
    requests: window.clockReadCancellation.signals.length,
    oldAborted: window.clockReadCancellation.signals[0]?.aborted,
    currentAborted: window.clockReadCancellation.signals[1]?.aborted,
    abortEvents: window.clockReadCancellation.abortEvents,
  }))).toEqual({ requests: 2, oldAborted: true, currentAborted: false, abortEvents: 1 });
  await expect(page.getByLabel('Zeitstatus', { exact: true })).toHaveText('Bereit: 8');
  await expect(page.getByRole('button', { name: 'Laufende Zeiterfassung öffnen', exact: true })).toBeEnabled();
  await page.evaluate(async () => {
    window.clockReadCancellation.releaseOldRead?.();
    // Flush the response's promise chain and React's next paint before checking state.
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
  await expect(page.getByLabel('Zeitstatus', { exact: true })).toHaveText('Bereit: 8');
  expect(await page.evaluate(() => window.clockContract.transitions)).toEqual([]);
});

for (const failure of ['http-error', 'wrong-organization'] as const) {
  test(`clock ${failure} keeps controls disabled and retries through the real dialog`, async ({ page }) => {
    let recover = false;
    await page.route('**/api/time-tracking-state?**', (route) => route.fulfill(recover
      ? { json: { success: true, state: RUNNING_CLOCK_STATE } }
      : failure === 'http-error'
        ? { status: 503, json: { success: false, error: 'time_state_read_failed' } }
        : { json: { success: true, state: { ...RUNNING_CLOCK_STATE, organizationId: '10000000-0000-4000-8000-000000000002' } } }));
    await mountClock(page);
    await expect(page.getByRole('alert').getByText('Der Zeitstatus konnte nicht sicher geladen werden.', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Zeiterfassung starten', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'Direkter Startversuch' }).click();
    await expect.poll(() => page.evaluate(() => window.clockContract.directResult)).toEqual({ success: false, error: 'time_transition_failed' });
    expect(await page.evaluate(() => window.clockContract.transitions)).toEqual([]);
    await page.getByRole('button', { name: 'Aktivitätsdialog prüfen' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('button', { name: 'Starten', exact: true })).toBeDisabled();
    await expect(dialog.getByRole('status')).toHaveText('Der Zeitstatus konnte nicht sicher geladen werden.');
    recover = true;
    await dialog.getByRole('button', { name: 'Erneut laden', exact: true }).click();
    await expect(dialog.getByRole('button', { name: 'Erfassung beenden', exact: true })).toBeEnabled();
    await dialog.getByRole('button', { name: 'Pause', exact: true }).click();
    await expect(dialog.getByRole('button', { name: 'Aktivität wechseln', exact: true })).toBeEnabled();
    expect(await page.evaluate(() => window.clockContract.transitions)).toEqual([]);
  });
}
