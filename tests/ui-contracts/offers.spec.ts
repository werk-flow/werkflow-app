import { expect, test } from '@playwright/test';
import { textInDom, visibleText } from '../golden/support/steps/shared';
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

// A save whose answer was lost: the page renders that save, and the repeated
// press of the unchanged form answers the same version. The page already
// shows it, so the dialog closes with its success at once instead of waiting
// for a further change and reporting a refresh that never comes.
test('a retried header save the page already shows confirms at once', async ({ page }) => {
  await openContractFixture(page, 'offers');
  await page.getByRole('button', { name: 'Bearbeiten', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Angebotskopf bearbeiten' });
  const save = dialog.getByRole('button', { name: 'Speichern', exact: true });

  await dialog.getByRole('textbox', { name: 'Titel' }).fill('Austausch Gas-Brennwerttherme');
  await save.click();
  await expectHeldWrite(page, 'update-offer');
  await answerHeldWrite(page, 'answer_lost');
  await expect(
    dialog.getByText('Das Angebot konnte nicht gespeichert werden. Bitte versuche es erneut.'),
  ).toBeVisible();
  await page.evaluate(() => window.uiContractOfferServerRender?.(2));

  await save.click();
  await expect.poll(() => page.evaluate(() => window.uiContractWrites.answer !== null)).toBe(true);
  const [first, retry] = await page.evaluate(() => window.uiContractWrites.calls.map((call) => call.input));
  expect(retry).toEqual(first);
  await answerHeldWrite(page, null);
  await expect(dialog).toBeHidden();
  await expect(visibleText(page, 'Angebot gespeichert.', true)).toBeVisible();
  await expect(textInDom(page, 'noch nicht aktualisiert')).toHaveCount(0);
});

// „Titel und Positionen“: the submit stays enabled; a press with an unnamed
// Titel marks it, focuses it and sends nothing; the amounts follow the typed
// position; a save shows pending in its first frame and names the content
// version it was filled from; a save another session made meanwhile keeps the
// input and says so.
test('a content save marks a Titel without a name, then sends the whole content against its version', async ({
  page,
}) => {
  await openContractFixture(page, 'offers');
  const editor = page.getByRole('form', { name: 'Titel und Positionen' });
  const save = editor.getByRole('button', { name: 'Speichern', exact: true });
  await editor.getByRole('button', { name: 'Titel hinzufügen', exact: true }).click();
  const title = editor.getByRole('textbox', { name: 'Titel 1' });

  await expect(save).toBeEnabled();
  await save.click();
  await expect(editor.getByText('Gib dem Titel einen Namen.')).toBeVisible();
  await expect(title).toBeFocused();
  expect(await page.evaluate(() => window.uiContractWrites.calls)).toEqual([]);

  await title.fill('Wartung');
  await editor.getByRole('button', { name: 'Position', exact: true }).click();
  await editor.getByRole('textbox', { name: 'Bezeichnung' }).fill('Wartung Gastherme');
  await editor.getByRole('textbox', { name: 'Menge' }).fill('1,5');
  await editor.getByRole('textbox', { name: 'Einzelpreis netto' }).fill('72,50');
  await expect(editor.getByText('Summe Titel 1: 108,75 €')).toBeVisible();
  await expect(editor.getByText('129,41 €')).toBeVisible();

  await save.click();
  await expect(save).toHaveAttribute('aria-busy', 'true');
  await expectHeldWrite(page, 'save-offer-content');
  expect(await page.evaluate(() => window.uiContractWrites.calls[0]?.input)).toMatchObject({
    expectedContentVersion: 1,
    sections: [{ title: 'Wartung', positions: [{ kind: 'free', quantity: '1.5', unitPriceCents: 7250 }] }],
  });
  await answerHeldWrite(page, 'offer_changed');
  await expect(editor.getByText(/Jemand hat die Positionen gerade geändert/)).toBeVisible();
  await expect(title).toHaveValue('Wartung');
  await expect(save).toBeEnabled();
  // The refusal renders the newer content, as its revalidated answer does: „Neu laden“ takes it.
  await page.evaluate(() => window.uiContractOfferContentRender?.(2, [{ title: 'Heizung', positions: [] }]));
  await editor.getByRole('button', { name: 'Neu laden', exact: true }).click();
  await expect(title).toHaveValue('Heizung');
});

// A save confirms only once the page renders the saved content, whether that
// render lands before or after the answer; the editor then shows the content
// as stored and names its version on the next save.
test('a content save confirms with the rendered content, before or after its answer', async ({ page }) => {
  await openContractFixture(page, 'offers');
  const editor = page.getByRole('form', { name: 'Titel und Positionen' });
  const save = editor.getByRole('button', { name: 'Speichern', exact: true });
  await editor.getByRole('button', { name: 'Titel hinzufügen', exact: true }).click();
  const title = editor.getByRole('textbox', { name: 'Titel 1' });

  await title.fill('Wartung');
  await save.click();
  await expectHeldWrite(page, 'save-offer-content');
  await page.evaluate(() => window.uiContractOfferContentRender?.(2, [{ title: 'Wartung', positions: [] }]));
  await answerHeldWrite(page, null);
  await expect(visibleText(page, 'Positionen gespeichert.', true)).toBeVisible();
  await expect(editor.getByText(/inzwischen geändert/)).toHaveCount(0);

  await title.fill('Wartung Heizung');
  await save.click();
  await expect.poll(() => page.evaluate(() => window.uiContractWrites.answer !== null)).toBe(true);
  expect(await page.evaluate(() => window.uiContractWrites.calls[1]?.input)).toMatchObject({
    expectedContentVersion: 2,
  });
  await answerHeldWrite(page, null);
  await expect(save).toHaveAttribute('aria-busy', 'true');
  await page.evaluate(() =>
    window.uiContractOfferContentRender?.(3, [{ title: 'Wartung Heizung', positions: [] }]),
  );
  await expect(save).not.toHaveAttribute('aria-busy', 'true');
  await expect(title).toHaveValue('Wartung Heizung');
  await expect(editor.getByText(/inzwischen geändert/)).toHaveCount(0);
});

// A retry after a lost answer answers the version of the first save; when the
// page already shows a later version of another session, the save is on
// screen already and confirms at once instead of waiting for a further change.
test('a retried content save whose version the page has passed confirms at once', async ({ page }) => {
  await openContractFixture(page, 'offers');
  const editor = page.getByRole('form', { name: 'Titel und Positionen' });
  const save = editor.getByRole('button', { name: 'Speichern', exact: true });
  await editor.getByRole('button', { name: 'Titel hinzufügen', exact: true }).click();
  await editor.getByRole('textbox', { name: 'Titel 1' }).fill('Wartung');
  await page.evaluate(() => window.uiContractOfferContentRender?.(3, [{ title: 'Heizung', positions: [] }]));

  await save.click();
  await expectHeldWrite(page, 'save-offer-content');
  await answerHeldWrite(page, null);
  await expect(visibleText(page, 'Positionen gespeichert.', true)).toBeVisible();
  await expect(save).not.toHaveAttribute('aria-busy', 'true');
});

// Untouched text takes another session's newer content by itself, so a
// refused save of it says so instead of pointing to „Neu laden“.
test('a refused save of untouched content names the newer content it now shows', async ({ page }) => {
  await openContractFixture(page, 'offers');
  const editor = page.getByRole('form', { name: 'Titel und Positionen' });
  await editor.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expectHeldWrite(page, 'save-offer-content');
  await answerHeldWrite(page, 'offer_changed');
  await expect(editor.getByText('Du siehst jetzt die aktuelle Fassung.', { exact: false })).toBeVisible();
  await expect(editor.getByText(/Neu laden/)).toHaveCount(0);
});
