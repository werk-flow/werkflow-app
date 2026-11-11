import { expect, test } from '@playwright/test';
import { answerHeldWrite, expectHeldWrite, openContractFixture } from './open-fixture';

// Archiving a contact or a work site moves the row in the first frame and
// marks only that row. A refusal restores it with the reason; an acceptance
// keeps it archived once the refreshed route props arrive.
test.beforeEach(async ({ page }) => {
  await openContractFixture(page, 'client-relations');
});

test('a refused contact archive returns the contact with the reason', async ({ page }) => {
  const main = page.getByRole('main');
  const archive = main.getByRole('button', { name: 'Ansprechpartner archivieren', exact: true });
  const restore = main.getByRole('button', { name: 'Ansprechpartner wiederherstellen', exact: true });
  await archive.click();
  await expect(archive).toHaveCount(0);
  await expect(restore).toBeDisabled();
  await expectHeldWrite(page, 'update-client-contact');
  await expect(main.getByRole('alert')).toHaveCount(0);

  await answerHeldWrite(page, 'not_authorized');
  await expect(archive).toBeEnabled();
  await expect(restore).toHaveCount(0);
  await expect(main.getByRole('alert')).toHaveText('Du hast keine Berechtigung für diese Aktion.');
  expect(await page.evaluate(() => window.uiContractClientRelations.contacts[0]?.isActive)).toBe(true);
});

test('an accepted site archive stays archived after the route refresh', async ({ page }) => {
  const main = page.getByRole('main');
  const archive = main.getByRole('button', { name: 'Einsatzort archivieren', exact: true });
  const restore = main.getByRole('button', { name: 'Einsatzort wiederherstellen', exact: true });
  await archive.click();
  await expect(archive).toHaveCount(0);
  await expect(restore).toBeDisabled();
  await expectHeldWrite(page, 'update-client-site');

  await answerHeldWrite(page, null);
  await expect(restore).toBeEnabled();
  await expect(archive).toHaveCount(0);
  await expect(main.getByRole('alert')).toHaveCount(0);
  expect(await page.evaluate(() => window.uiContractServices.navigation)).toContain('refresh');
});

test('a contact email that is not one address marks the field, focuses it and sends nothing', async ({
  page,
}) => {
  const main = page.getByRole('main');
  await main.getByRole('button', { name: 'Ansprechpartner bearbeiten', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const email = dialog.getByLabel('E-Mail', { exact: true });
  const fieldError = dialog.getByText('Bitte gib eine gültige E-Mail-Adresse ein oder lass das Feld leer.');
  const save = dialog.getByRole('button', { name: 'Speichern', exact: true });
  await expect(email).toHaveValue('petra.pohl(at)example.de');

  await save.click();
  await expect(email).toBeFocused();
  await expect(email).toHaveAttribute('aria-invalid', 'true');
  await expect(fieldError).toBeVisible();
  await expect(save).toBeEnabled();
  expect(await page.evaluate(() => window.uiContractWrites.calls)).toEqual([]);

  // A blank email is allowed: clearing the field clears the error and saves.
  await email.fill('');
  await expect(fieldError).toHaveCount(0);
  await save.click();
  await expectHeldWrite(page, 'update-client-contact');
});

test('the role dialog stays open while a role ends and shows the refusal in place', async ({ page }) => {
  const main = page.getByRole('main');
  await main.getByRole('button', { name: 'Rollen verwalten', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Rollen am Einsatzort' });
  // The dialog's own close icon and its footer button share the name.
  const closeButtons = dialog.getByRole('button', { name: 'Schließen', exact: true });
  await dialog.getByRole('button', { name: 'Beenden', exact: true }).click();
  await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expectHeldWrite(page, 'end-client-site-role');

  // Neither Escape nor „Schließen“ drops the running save.
  await expect(dialog).toHaveAttribute('data-pending', 'true');
  for (const close of await closeButtons.all()) await expect(close).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();

  await answerHeldWrite(page, 'role_ends_before_start');
  await expect(dialog).not.toHaveAttribute('data-pending');
  await expect(dialog.getByText('Das Ende darf nicht vor dem Beginn liegen.')).toBeVisible();
  for (const close of await closeButtons.all()) await expect(close).toBeEnabled();
});
