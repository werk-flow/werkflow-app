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
