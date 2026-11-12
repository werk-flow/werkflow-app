import { expect, test, type Locator, type Page } from '@playwright/test';
import { openContractFixture } from './open-fixture';

// werk-flow/werkflow-planning#87: raising a Handwerker/in to Büro opens
// personnel files, sickness reports and everyone's time, yet it applied on one
// click. Every surface that offers it now asks first, with the effect in one
// line; nothing reaches the role change before the confirmation, and a
// downgrade still applies at once.
test.beforeEach(async ({ page }) => {
  await openContractFixture(page, 'member-role');
});

const ESCALATION_TITLE = 'Hanna Handwerk zu Büro machen?';
const ESCALATION_EFFECT =
  'Als Büro sieht Hanna Handwerk Personalakten, Krankmeldungen, die Arbeitszeiten aller Handwerker/innen und die Perioden.';

const roleChanges = (page: Page): Promise<string[]> => page.evaluate(() => window.uiContractRoleChanges);

async function chooseRole(page: Page, menuTrigger: Locator, role: string): Promise<void> {
  await menuTrigger.click();
  await page.getByRole('menuitem', { name: 'Rolle ändern', exact: true }).click();
  await page.getByRole('menuitem', { name: role, exact: true }).click();
}

test('an escalation from the list menu waits for the confirmation and a cancel changes nothing', async ({
  page,
}) => {
  const trigger = page
    .getByRole('region', { name: 'Zeile Hanna Handwerk', exact: true })
    .getByRole('button', { name: 'Aktionen öffnen', exact: true });
  await chooseRole(page, trigger, 'Büro');
  const confirmation = page.getByRole('alertdialog', { name: ESCALATION_TITLE, exact: true });
  await expect(confirmation).toBeVisible();
  await expect(confirmation).toContainText(ESCALATION_EFFECT);
  await expect(confirmation.getByRole('button', { name: 'Abbrechen', exact: true })).toBeFocused();
  expect(await roleChanges(page)).toEqual([]);

  await confirmation.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  await expect(confirmation).toHaveCount(0);
  expect(await roleChanges(page)).toEqual([]);

  await chooseRole(page, trigger, 'Büro');
  await confirmation.getByRole('button', { name: 'Zu Büro machen', exact: true }).click();
  await expect(confirmation).toHaveCount(0);
  expect(await roleChanges(page)).toEqual(['list:contract-hanna:buero']);
});

test('a downgrade from the list menu applies at once', async ({ page }) => {
  const trigger = page
    .getByRole('region', { name: 'Zeile Bea Büro', exact: true })
    .getByRole('button', { name: 'Aktionen öffnen', exact: true });
  await chooseRole(page, trigger, 'Handwerker/in');
  expect(await roleChanges(page)).toEqual(['list:contract-bea:employee']);
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
});

test('an escalation from the detail header menu waits for the confirmation', async ({ page }) => {
  const trigger = page
    .getByRole('region', { name: 'Detailkopf', exact: true })
    .getByRole('button', { name: 'Aktionen', exact: true });
  await chooseRole(page, trigger, 'Büro');
  const confirmation = page.getByRole('alertdialog', { name: ESCALATION_TITLE, exact: true });
  await expect(confirmation).toContainText(ESCALATION_EFFECT);
  expect(await roleChanges(page)).toEqual([]);

  await confirmation.getByRole('button', { name: 'Zu Büro machen', exact: true }).click();
  await expect(confirmation).toHaveCount(0);
  expect(await roleChanges(page)).toEqual(['detail:contract-hanna:buero']);
});

test('an escalation from the profile role field waits for the confirmation', async ({ page }) => {
  const profile = page.getByRole('region', { name: 'Profil', exact: true });
  await profile.getByRole('button', { name: 'Rolle bearbeiten', exact: true }).click();
  await profile.getByRole('group', { name: 'Rolle', exact: true }).getByRole('combobox').click();
  await page.getByRole('option', { name: 'Büro', exact: true }).click();
  await profile.getByRole('button', { name: 'Speichern', exact: true }).click();
  const confirmation = page.getByRole('alertdialog', { name: ESCALATION_TITLE, exact: true });
  await expect(confirmation).toContainText(ESCALATION_EFFECT);
  expect(await roleChanges(page)).toEqual([]);

  await confirmation.getByRole('button', { name: 'Zu Büro machen', exact: true }).click();
  await expect(confirmation).toHaveCount(0);
  await expect.poll(() => roleChanges(page)).toEqual(['profile:contract-hanna:buero']);
});
