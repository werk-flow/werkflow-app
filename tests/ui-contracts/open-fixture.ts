import { expect, type Page } from '@playwright/test';
import { assertWorkspaceTestLock } from '@/lib/testing/runner/workspace-test-lock';

/** Opens the isolated fixture page and mounts one named contract fixture from the bundle. */
export async function openContractFixture(page: Page, fixture: Window['uiContractFixture']): Promise<void> {
  assertWorkspaceTestLock();
  const bundle = process.env.WERKFLOW_UI_CONTRACT_BUNDLE;
  if (!bundle) throw new Error('Run through bun tests/ui-contracts/run.ts.');
  await page.route('http://localhost/ui-contracts**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><html lang="de"><body><div id="root"></div></body></html>',
    }),
  );
  await page.goto('http://localhost/ui-contracts');
  await page.evaluate((name) => {
    window.uiContractFixture = name;
  }, fixture);
  await page.addScriptTag({ path: bundle });
  await expect(page.getByRole('heading', { name: 'Komponentenverträge' })).toBeVisible();
}

/** Waits until the surface has issued its write and the gate holds it open. */
export async function expectHeldWrite(page: Page, kind: string): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(() => ({
        kinds: window.uiContractWrites.calls.map((call) => call.kind),
        open: window.uiContractWrites.answer !== null,
      })),
    )
    .toEqual({ kinds: [kind], open: true });
}

/** Answers the held write: `null` accepts it, a string refuses it with that error code. */
export async function answerHeldWrite(page: Page, refusal: string | null): Promise<void> {
  await page.evaluate((code) => {
    const answer = window.uiContractWrites.answer;
    if (!answer) throw new Error('No write is held open.');
    answer(code);
  }, refusal);
}
