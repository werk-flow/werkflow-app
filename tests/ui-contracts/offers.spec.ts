import { expect, test } from '@playwright/test';
import { openContractFixture } from './open-fixture';

// „Angebot anlegen“ (docs/features/commercial-and-finance.md): the submit
// stays enabled; a press without title or customer marks the missing fields,
// focuses the first of them and sends nothing.
test('a create without title or customer marks both fields, focuses the first and sends nothing', async ({
  page,
}) => {
  await openContractFixture(page, 'offers');
  await page.getByRole('button', { name: 'Neues Angebot', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Angebot anlegen' });
  const title = dialog.getByRole('textbox', { name: 'Titel' });
  const create = dialog.getByRole('button', { name: 'Angebot anlegen', exact: true });

  await expect(create).toBeEnabled();
  await create.click();
  await expect(dialog.getByText('Gib dem Angebot einen Titel.')).toBeVisible();
  await expect(dialog.getByText('Wähle den Kunden.')).toBeVisible();
  await expect(title).toBeFocused();

  await title.fill('Austausch Gastherme');
  await create.click();
  await expect(dialog.getByText('Gib dem Angebot einen Titel.')).toHaveCount(0);
  await expect(dialog.getByRole('combobox', { name: 'Kunde' })).toBeFocused();
  expect(await page.evaluate(() => window.uiContractOfferCreates)).toBe(0);
});
