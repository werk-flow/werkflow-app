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
});
