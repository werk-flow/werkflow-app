import { expect, test } from '@playwright/test';
import { answerHeldWrite, expectHeldWrite, openContractFixture } from './open-fixture';

// The company details form starts anew when the active organization changes,
// also when both profiles have the same version: the other organization's
// draft never shows and never saves there (werk-flow/werkflow-planning#378).
// The server refuses a save for an organization no longer active as well
// (lib/testing/fixtures/company-profile-boundaries.ts). Stationery margins
// that each fit but leave the page too little room together mark the sides
// at fault and focus the first, instead of a refusal without a marked field.
test('another organization with the same version shows its own details and saves only them', async ({
  page,
}) => {
  await openContractFixture(page, 'company-profile');
  const companyName = page.getByLabel('Firma mit Rechtsform');
  await expect(companyName).toHaveValue('Haustechnik Sonnenberg GmbH');
  await companyName.fill('Entwurf der ersten Organisation');

  await page.getByRole('button', { name: 'Organisation wechseln' }).click();
  await expect(companyName).toHaveValue('Haustechnik Lindenhof GmbH');

  await page.getByRole('button', { name: 'Angaben speichern' }).click();
  await expectHeldWrite(page, 'save-company-profile');
  const sent = await page.evaluate(() => window.uiContractWrites.calls[0]?.input);
  expect(sent).toMatchObject({
    organizationId: 'contract-organization-b',
    expectedVersion: 3,
    details: { companyName: 'Haustechnik Lindenhof GmbH' },
  });
  await answerHeldWrite(page, null);
});

test('margins too wide together mark both sides of their page, focus the first and send nothing', async ({
  page,
}) => {
  await openContractFixture(page, 'company-profile');
  const right = page.getByLabel('Rechts (mm)');
  const left = page.getByLabel('Links (mm)');
  await right.fill('60');
  await left.fill('70');

  await page.getByRole('button', { name: 'Angaben speichern' }).click();
  const tooWide = 'Links und rechts lassen zusammen zu wenig Platz für das Angebot.';
  await expect(right).toHaveAccessibleDescription(tooWide);
  await expect(left).toHaveAccessibleDescription(tooWide);
  await expect(page.getByLabel('Oben (mm)')).not.toHaveAttribute('aria-invalid', 'true');
  await expect(right).toBeFocused();
  expect(await page.evaluate(() => window.uiContractWrites.calls)).toEqual([]);
});

test('removed stationery returns its hidden margins to the saved ones, so the save still goes through', async ({
  page,
}) => {
  await openContractFixture(page, 'company-profile');
  await page.getByLabel('Rechts (mm)').fill('abc');
  await page.getByRole('button', { name: 'Briefpapier entfernen' }).click();
  await expect(page.getByLabel('Rechts (mm)')).toHaveCount(0);

  await page.getByRole('button', { name: 'Angaben speichern' }).click();
  await expectHeldWrite(page, 'save-company-profile');
  const sent = await page.evaluate(() => window.uiContractWrites.calls[0]?.input);
  expect(sent).toMatchObject({
    details: { firstPageMargins: { topMm: 45, rightMm: 20, bottomMm: 25, leftMm: 25 } },
  });
  await answerHeldWrite(page, null);
});

test('a save that answers after a switch shows no banner on the other organization', async ({ page }) => {
  // A paused clock keeps any banner from dismissing itself before the check.
  await page.clock.install({ time: new Date('2026-11-13T09:00:00Z') });
  await openContractFixture(page, 'company-profile');
  await page.clock.pauseAt(new Date('2026-11-13T09:01:00Z'));
  await page.getByRole('button', { name: 'Angaben speichern' }).click();
  await expectHeldWrite(page, 'save-company-profile');
  await page.getByRole('button', { name: 'Organisation wechseln' }).click();
  await expect(page.getByLabel('Firma mit Rechtsform')).toHaveValue('Haustechnik Lindenhof GmbH');
  await answerHeldWrite(page, null);
  // The other organization's own refused save renders after anything the late
  // answer set, so once its reason shows, a banner of the late answer would too.
  await page.getByRole('button', { name: 'Angaben speichern' }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () => window.uiContractWrites.calls.length > 1 && window.uiContractWrites.answer !== null,
      ),
    )
    .toBe(true);
  await answerHeldWrite(page, 'profile_changed');
  await expect(page.getByRole('main').getByText(/Jemand hat die Angaben inzwischen geändert/)).toBeVisible();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Die Firmenangaben wurden gespeichert.' }),
  ).toHaveCount(0);
});

test('a save that answers on the same organization says it was saved', async ({ page }) => {
  await openContractFixture(page, 'company-profile');
  await page.getByRole('button', { name: 'Angaben speichern' }).click();
  await expectHeldWrite(page, 'save-company-profile');
  await answerHeldWrite(page, null);
  await expect(
    page.getByRole('alert').filter({ hasText: 'Die Firmenangaben wurden gespeichert.' }),
  ).toBeVisible();
});
