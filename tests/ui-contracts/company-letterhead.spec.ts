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
  await answerSamples(page);
  await openContractFixture(page, 'company-letterhead');
  await removeLogoThenSwitch(page);
  await answerHeldWrite(page, null);
  await expect(page.getByRole('button', { name: 'Organisation wechseln' })).toBeVisible();
  await expect(page.getByRole('main').getByText('Logo wurde entfernt.')).toHaveCount(0);
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
