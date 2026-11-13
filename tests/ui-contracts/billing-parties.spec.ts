import { expect, test } from '@playwright/test';
import { openContractFixture } from './open-fixture';

// Two office users opened the same Auftraggeber and Rechnungsempfänger: a
// save from the outdated version is refused, says why, reads the parties
// again and starts the choice from the new version, so it never writes back
// the Auftraggeber the other user replaced (werk-flow/werkflow-planning#327).
test('a save from an outdated version says why and starts the choice from the current one', async ({
  page,
}) => {
  await openContractFixture(page, 'billing-parties');
  await page.getByRole('button', { name: 'Rechnung ändern', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Auftraggeber und Rechnungsempfänger' });
  const auftraggeber = dialog.getByRole('combobox', { name: 'Auftraggeber', exact: true });
  await expect(auftraggeber).toContainText('WEG Lindenstraße 5');

  await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();

  await expect(dialog.getByText(/wurden gerade geändert/)).toBeVisible();
  await expect(auftraggeber).toContainText('Hausverwaltung Birkenhain GmbH');
  await expect(dialog).toBeVisible();

  // Saving the refreshed choice sends the version it now shows, so it saves.
  await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole('alert').filter({ hasText: 'Auftraggeber und Rechnungsempfänger gespeichert.' }),
  ).toBeVisible();
});

test('a newer read landing while the dialog is open never replaces the choice without the notice', async ({
  page,
}) => {
  await openContractFixture(page, 'billing-parties');
  await page.getByRole('button', { name: 'Rechnung ändern', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Auftraggeber und Rechnungsempfänger' });
  const auftraggeber = dialog.getByRole('combobox', { name: 'Auftraggeber', exact: true });
  await expect(auftraggeber).toContainText('WEG Lindenstraße 5');

  await page.evaluate(() => window.dispatchEvent(new Event('contract-billing-newer')));
  // The form keeps what it showed; nothing told the user, so nothing changes under them.
  await expect(auftraggeber).toContainText('WEG Lindenstraße 5');
  await expect(dialog.getByText(/wurden gerade geändert/)).toHaveCount(0);

  // Its save is refused, says why, and only then shows the newer pair.
  await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(dialog.getByText(/wurden gerade geändert/)).toBeVisible();
  await expect(auftraggeber).toContainText('Hausverwaltung Birkenhain GmbH');

  await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole('alert').filter({ hasText: 'Auftraggeber und Rechnungsempfänger gespeichert.' }),
  ).toBeVisible();
});

test('a failed reread after a refused save keeps the choice and offers the read again', async ({ page }) => {
  await openContractFixture(page, 'billing-parties');
  await page.getByRole('button', { name: 'Rechnung ändern', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Auftraggeber und Rechnungsempfänger' });
  const auftraggeber = dialog.getByRole('combobox', { name: 'Auftraggeber', exact: true });
  await page.evaluate(() => window.dispatchEvent(new Event('contract-billing-reread-fails')));

  await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
  // No claim that the current pair is shown: the read failed, the choice stays.
  await expect(dialog.getByRole('alert')).toContainText('konnten nicht geladen werden');
  await expect(dialog.getByText(/Hier stehen jetzt die aktuellen Angaben/)).toHaveCount(0);
  await expect(auftraggeber).toContainText('WEG Lindenstraße 5');

  // The retry runs the same reread; now the newer pair arrives with the notice.
  await dialog.getByRole('button', { name: 'Erneut laden', exact: true }).click();
  await expect(dialog.getByText(/Hier stehen jetzt die aktuellen Angaben/)).toBeVisible();
  await expect(auftraggeber).toContainText('Hausverwaltung Birkenhain GmbH');

  await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(dialog).toHaveCount(0);
});

test('the pickers wait while a retried reread runs, so nothing chosen then is overwritten', async ({
  page,
}) => {
  await openContractFixture(page, 'billing-parties');
  await page.getByRole('button', { name: 'Rechnung ändern', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Auftraggeber und Rechnungsempfänger' });
  const auftraggeber = dialog.getByRole('combobox', { name: 'Auftraggeber', exact: true });
  const recipient = dialog.getByRole('combobox', { name: 'Rechnungsempfänger', exact: true });
  await page.evaluate(() => window.dispatchEvent(new Event('contract-billing-reread-fails')));
  await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('konnten nicht geladen werden');

  // While the retried read runs, the pair it may bring cannot meet an edit.
  await page.evaluate(() => window.dispatchEvent(new Event('contract-billing-reread-hold')));
  await dialog.getByRole('button', { name: 'Erneut laden', exact: true }).click();
  await expect(auftraggeber).toBeDisabled();
  await expect(recipient).toBeDisabled();

  await page.evaluate(() => window.dispatchEvent(new Event('contract-billing-reread-release')));
  await expect(dialog.getByText(/Hier stehen jetzt die aktuellen Angaben/)).toBeVisible();
  await expect(auftraggeber).toContainText('Hausverwaltung Birkenhain GmbH');
  await expect(auftraggeber).toBeEnabled();
  await expect(recipient).toBeEnabled();
});

test('the current-data notice waits until the reread after a refusal has landed', async ({ page }) => {
  await openContractFixture(page, 'billing-parties');
  await page.getByRole('button', { name: 'Rechnung ändern', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Auftraggeber und Rechnungsempfänger' });
  const auftraggeber = dialog.getByRole('combobox', { name: 'Auftraggeber', exact: true });
  await page.evaluate(() => window.dispatchEvent(new Event('contract-billing-reread-hold')));

  await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
  // While the reread runs, the dialog says it loads and claims nothing about the shown pair.
  await expect(dialog.getByRole('status').filter({ hasText: 'werden geladen' })).toBeVisible();
  await expect(dialog.getByText(/Hier stehen jetzt die aktuellen Angaben/)).toHaveCount(0);
  await expect(dialog.getByText(/konnten nicht geladen werden/)).toHaveCount(0);
  await expect(auftraggeber).toContainText('WEG Lindenstraße 5');

  await page.evaluate(() => window.dispatchEvent(new Event('contract-billing-reread-release')));
  await expect(dialog.getByText(/Hier stehen jetzt die aktuellen Angaben/)).toBeVisible();
  await expect(auftraggeber).toContainText('Hausverwaltung Birkenhain GmbH');
  await expect(dialog.getByRole('status').filter({ hasText: 'werden geladen' })).toHaveCount(0);
});

test('after a failed reread, Speichern sends nothing and points to the reread', async ({ page }) => {
  await openContractFixture(page, 'billing-parties');
  await page.getByRole('button', { name: 'Rechnung ändern', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Auftraggeber und Rechnungsempfänger' });
  await page.evaluate(() => window.dispatchEvent(new Event('contract-billing-reread-fails')));
  await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('konnten nicht geladen werden');
  const savesBefore = await page.evaluate(() => window.uiContractBillingSaves);

  // The submit stays enabled, but the outdated version is never sent.
  await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Erneut laden', exact: true })).toBeFocused();
  await expect(dialog.getByRole('alert')).toContainText('konnten nicht geladen werden');
  expect(await page.evaluate(() => window.uiContractBillingSaves)).toBe(savesBefore);
});

test('a running retry keeps the dialog open on Escape, so the kept choice stays', async ({ page }) => {
  await openContractFixture(page, 'billing-parties');
  await page.getByRole('button', { name: 'Rechnung ändern', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Auftraggeber und Rechnungsempfänger' });
  await page.evaluate(() => window.dispatchEvent(new Event('contract-billing-reread-fails')));
  await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('konnten nicht geladen werden');

  await page.evaluate(() => window.dispatchEvent(new Event('contract-billing-reread-hold')));
  await dialog.getByRole('button', { name: 'Erneut laden', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();

  await page.evaluate(() => window.dispatchEvent(new Event('contract-billing-reread-release')));
  await expect(dialog.getByText(/Hier stehen jetzt die aktuellen Angaben/)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});
