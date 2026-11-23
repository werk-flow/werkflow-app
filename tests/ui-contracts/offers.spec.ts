import { expect, test } from '@playwright/test';
import { answerHeldWrite, expectHeldWrite, openContractFixture } from './open-fixture';

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

// „Angebotskopf bearbeiten“: the submit stays enabled; a press without title
// marks it, focuses it and sends nothing; a save shows pending in its first
// frame, names the version the dialog opened with, and a save another session
// made meanwhile keeps the dialog open with its input and says so.
test('a header save without title sends nothing, and a refused save keeps the input', async ({ page }) => {
  await openContractFixture(page, 'offers');
  await page.getByRole('button', { name: 'Bearbeiten', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Angebotskopf bearbeiten' });
  const title = dialog.getByRole('textbox', { name: 'Titel' });
  const save = dialog.getByRole('button', { name: 'Speichern', exact: true });

  await title.fill('');
  await expect(save).toBeEnabled();
  await save.click();
  await expect(dialog.getByText('Gib dem Angebot einen Titel.')).toBeVisible();
  await expect(title).toBeFocused();
  expect(await page.evaluate(() => window.uiContractWrites.calls)).toEqual([]);

  await title.fill('Austausch Gas-Brennwerttherme');
  await save.click();
  await expect(save).toHaveAttribute('aria-busy', 'true');
  await expectHeldWrite(page, 'update-offer');
  expect(await page.evaluate(() => window.uiContractWrites.calls[0]?.input)).toMatchObject({
    expectedVersion: 1,
    title: 'Austausch Gas-Brennwerttherme',
    recipientClientId: null,
    ownerUserId: '93000000-0000-4000-8000-000000000001',
  });
  await answerHeldWrite(page, 'offer_changed');
  await expect(dialog.getByText(/Jemand hat das Angebot gerade geändert/)).toBeVisible();
  await expect(title).toHaveValue('Austausch Gas-Brennwerttherme');
  await expect(save).toBeEnabled();
});
