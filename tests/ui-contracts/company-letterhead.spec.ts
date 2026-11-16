import { expect, test, type Page, type Route } from '@playwright/test';
import { answerHeldWrite, expectHeldWrite, openContractFixture } from './open-fixture';

// The logo row and the Musterangebot belong to the organization shown
// (werk-flow/werkflow-planning#378). A removal names the file the row showed,
// so the server refuses it once someone else changed that file. A removal
// that answers after a switch to another organization shows neither its
// refusal nor its success there, and the other organization's sample never
// shows the one before, even when neither profile was saved.

/** Answers the first sample render at once and holds every later one; returns the held routes. */
async function answerSamples(page: Page): Promise<Route[]> {
  const held: Route[] = [];
  let renders = 0;
  await page.route('http://localhost/api/musterangebot', async (route) => {
    renders += 1;
    if (renders === 1) await route.fulfill({ contentType: 'application/pdf', body: '%PDF-1.4\n' });
    else held.push(route);
  });
  return held;
}

async function removeLogoThenSwitch(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Entfernen' }).click();
  await expectHeldWrite(page, 'remove-company-file');
  expect(await page.evaluate(() => window.uiContractWrites.calls[0]?.input)).toEqual({
    organizationId: 'contract-organization-a',
    kind: 'logo',
    expectedStoragePath: 'contract-organization-a/briefpapier/contract-logo/logo',
    expectedFollowingStoragePath: null,
    attemptKey: expect.any(String),
  });
  await page.getByRole('button', { name: 'Organisation wechseln' }).click();
  // The other organization has no logo to remove.
  await expect(page.getByRole('button', { name: 'Entfernen' })).toHaveCount(0);
}

test('a refused removal answered after a switch shows no error on the other organization', async ({
  page,
}) => {
  await answerSamples(page);
  await openContractFixture(page, 'company-letterhead');
  await removeLogoThenSwitch(page);
  await answerHeldWrite(page, 'file_changed');
  await expect(page.getByRole('button', { name: 'Organisation wechseln' })).toBeVisible();
  await expect(page.getByRole('main').getByText(/Jemand hat die Datei inzwischen geändert/)).toHaveCount(0);
});

test('a removal accepted after a switch shows no success on the other organization', async ({ page }) => {
  // A paused clock keeps any banner from dismissing itself before the check.
  await page.clock.install({ time: new Date('2026-11-13T09:00:00Z') });
  await answerSamples(page);
  await openContractFixture(page, 'company-letterhead');
  await page.clock.pauseAt(new Date('2026-11-13T09:01:00Z'));
  await removeLogoThenSwitch(page);
  await answerHeldWrite(page, null);
  await expect(page.getByRole('button', { name: 'Organisation wechseln' })).toBeVisible();
  await expect(page.getByRole('alert').filter({ hasText: 'Logo wurde entfernt.' })).toHaveCount(0);
});

test('the other organization renders its own sample instead of showing the one before', async ({ page }) => {
  const held = await answerSamples(page);
  await openContractFixture(page, 'company-letterhead');
  await expect(page.getByRole('main').getByText('Musterangebot.pdf')).toBeVisible();

  await page.getByRole('button', { name: 'Organisation wechseln' }).click();
  await expect(page.getByRole('main').getByText('Musterangebot wird erstellt.')).toBeAttached();
  await expect(page.getByRole('main').getByText('Musterangebot.pdf')).toHaveCount(0);
  await expect.poll(() => held.length).toBe(1);
  await held[0]?.fulfill({ contentType: 'application/pdf', body: '%PDF-1.4\n' });
  await expect(page.getByRole('main').getByText('Musterangebot.pdf')).toBeVisible();
});

test('a removal repeated for the same logo reuses its attempt key, and another logo takes a new one', async ({
  page,
}) => {
  await answerSamples(page);
  await openContractFixture(page, 'company-letterhead');
  const remove = page.getByRole('button', { name: 'Entfernen' });
  const answerNext = async (count: number, refusal: string | null) => {
    await expect
      .poll(() =>
        page.evaluate(
          (expected) =>
            window.uiContractWrites.calls.length === expected && window.uiContractWrites.answer !== null,
          count,
        ),
      )
      .toBe(true);
    await answerHeldWrite(page, refusal);
  };
  // A lost answer looks like a failed removal: the same logo again is the same attempt.
  await remove.click();
  await answerNext(1, 'remove_failed');
  await remove.click();
  await answerNext(2, 'remove_failed');
  // Another session put a new logo in its place: removing that one must not replay the first removal.
  await page.getByRole('button', { name: 'Anderes Logo' }).click();
  await remove.click();
  await answerNext(3, null);
  const sent = await page.evaluate(() =>
    window.uiContractWrites.calls.map((call) =>
      typeof call.input === 'object' &&
      call.input !== null &&
      'attemptKey' in call.input &&
      'expectedStoragePath' in call.input
        ? { key: String(call.input.attemptKey), file: String(call.input.expectedStoragePath) }
        : null,
    ),
  );
  expect(sent[0]?.key).toEqual(expect.any(String));
  expect(sent[1]).toEqual(sent[0]);
  expect(sent[2]?.file).toBe('contract-organization-a/briefpapier/contract-other-logo/logo');
  expect(sent[2]?.key).not.toBe(sent[0]?.key);
});
