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

// A save is accepted but its answer is lost; another session then saves, and
// the page shows that later version. The retry sends the same attempt, which
// answers the first save's version: the page has passed it, so the save
// confirms at once instead of waiting for a further change.
test('a retried content save whose version the page has passed confirms at once', async ({ page }) => {
  await openContractFixture(page, 'offers');
  const editor = page.getByRole('form', { name: 'Titel und Positionen' });
  const save = editor.getByRole('button', { name: 'Speichern', exact: true });
  await editor.getByRole('button', { name: 'Titel hinzufügen', exact: true }).click();
  await editor.getByRole('textbox', { name: 'Titel 1' }).fill('Wartung');

  await save.click();
  await expectHeldWrite(page, 'save-offer-content');
  await answerHeldWrite(page, 'answer_lost');
  await expect(
    editor.getByText('Die Positionen konnten nicht gespeichert werden. Versuche es erneut.'),
  ).toBeVisible();
  await page.evaluate(() => window.uiContractOfferContentRender?.(3, [{ title: 'Heizung', positions: [] }]));

  await save.click();
  await expect.poll(() => page.evaluate(() => window.uiContractWrites.answer !== null)).toBe(true);
  const [first, retry] = await page.evaluate(() => window.uiContractWrites.calls.map((call) => call.input));
  expect(retry).toEqual(first);
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
  const sentence = editor.getByText('Du siehst jetzt die aktuelle Fassung.', { exact: false });
  await expect(sentence).toBeVisible();
  await expect(editor.getByText(/Neu laden/)).toHaveCount(0);
  // A change of the content ends the sentence about the earlier one.
  await editor.getByRole('button', { name: 'Titel hinzufügen', exact: true }).click();
  await expect(sentence).toHaveCount(0);
});

// An article whose stored unit is outside the list becomes a Position without
// a unit: the editor says so at the field, and a save marks the unit, focuses
// it and sends nothing until the office picks one. The save names the article.
test('a Position from an article with an unknown unit asks for a unit before it saves', async ({ page }) => {
  await openContractFixture(page, 'offers');
  const editor = page.getByRole('form', { name: 'Titel und Positionen' });
  const save = editor.getByRole('button', { name: 'Speichern', exact: true });
  await editor.getByRole('button', { name: 'Titel hinzufügen', exact: true }).click();
  await editor.getByRole('textbox', { name: 'Titel 1' }).fill('Material');

  await editor.getByRole('combobox', { name: 'Artikel zu Titel 1 hinzufügen' }).click();
  await expect.poll(() => page.evaluate(() => window.optionContract.requests.length)).toBe(1);
  await page.evaluate(() =>
    window.optionContract.resolve(0, [{ value: 'contract-article', label: 'KB-15 · Kupferbogen 15 mm' }]),
  );
  await page.getByRole('option', { name: 'KB-15 · Kupferbogen 15 mm' }).click();
  await expect(editor.getByRole('textbox', { name: 'Bezeichnung' })).toHaveValue('Kupferbogen 15 mm');
  await expect(editor.getByRole('textbox', { name: 'Einzelpreis netto' })).toHaveValue('4,95');
  await expect(editor.getByText('Aus Artikel KB-15 · Kupferbogen 15 mm')).toBeVisible();
  await expect(editor.getByText('Die Einheit des Artikels ist unbekannt. Wähle eine.')).toBeVisible();

  await save.click();
  await expect(editor.getByText('Wähle eine Einheit.')).toBeVisible();
  const unit = editor.getByRole('combobox', { name: 'Einheit' });
  await expect(unit).toBeFocused();
  expect(await page.evaluate(() => window.uiContractWrites.calls)).toEqual([]);

  await unit.click();
  await page.getByRole('option', { name: 'Stück', exact: true }).click();
  await save.click();
  await expectHeldWrite(page, 'save-offer-content');
  expect(await page.evaluate(() => window.uiContractWrites.calls[0]?.input)).toMatchObject({
    sections: [
      {
        title: 'Material',
        positions: [
          {
            kind: 'free',
            unit: 'piece',
            unitPriceCents: 495,
            source: { kind: 'article', id: 'contract-article' },
          },
        ],
      },
    ],
  });
});

// A Leistung becomes a Position with its cost rate; a markup on the cost sets
// the price, a typed price clears the markup, and the office's calculation
// follows. The save sends the Position's own cost beside its price.
test('a Leistung brings its cost, a markup sets the price, and the calculation shows the margin', async ({
  page,
}) => {
  await openContractFixture(page, 'offers');
  const editor = page.getByRole('form', { name: 'Titel und Positionen' });
  await editor.getByRole('button', { name: 'Titel hinzufügen', exact: true }).click();
  await editor.getByRole('textbox', { name: 'Titel 1' }).fill('Montage');

  await editor.getByRole('combobox', { name: 'Leistung zu Titel 1 hinzufügen' }).click();
  await expect.poll(() => page.evaluate(() => window.optionContract.requests.length)).toBe(1);
  await page.evaluate(() =>
    window.optionContract.resolve(0, [{ value: 'contract-leistung', label: 'L-7 · Monteurstunde' }]),
  );
  await page.getByRole('option', { name: 'L-7 · Monteurstunde' }).click();
  const price = editor.getByRole('textbox', { name: 'Einzelpreis netto' });
  const markup = editor.getByRole('textbox', { name: 'Aufschlag %' });
  await expect(price).toHaveValue('72,50');
  await expect(editor.getByRole('textbox', { name: 'Kosten netto' })).toHaveValue('41,80');
  await expect(editor.getByText('Aus Leistung L-7 · Monteurstunde')).toBeVisible();
  await expect(editor.getByText('Kosten 41,80 € · Marge 30,70 € (42,3 %)')).toBeVisible();

  await markup.fill('12,5');
  await expect(price).toHaveValue('47,03');
  const panel = editor.getByRole('region', { name: 'Kalkulation' });
  await expect(editor.getByText('Kosten 41,80 € · Marge 5,23 € (11,1 %)')).toBeVisible();
  await expect(panel.getByRole('group', { name: 'Titel 1 · Montage' })).toContainText('Marge %11,1 %');
  await expect(panel.getByRole('group', { name: 'Angebot gesamt' })).toContainText('Kosten41,80 €');
  await price.fill('50,00');
  await expect(markup).toHaveValue('');

  // A markup that does not read says so at once and leaves the price; it is never saved.
  await markup.fill('abc');
  await expect(editor.getByText('Gib den Aufschlag in Prozent an, zum Beispiel 25 oder 12,5.')).toBeVisible();
  await expect(price).toHaveValue('50,00');
  const cost = editor.getByRole('textbox', { name: 'Kosten netto' });
  await cost.fill('41,8x');
  await editor.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(
    editor.getByText('Gib die Kosten netto an, zum Beispiel 48,20, oder lass das Feld leer.'),
  ).toBeVisible();
  await expect(cost).toBeFocused();
  expect(await page.evaluate(() => window.uiContractWrites.calls)).toEqual([]);

  await cost.fill('41,80');
  await editor.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expectHeldWrite(page, 'save-offer-content');
  expect(await page.evaluate(() => window.uiContractWrites.calls[0]?.input)).toMatchObject({
    sections: [
      {
        title: 'Montage',
        positions: [
          {
            unit: 'hour',
            unitPriceCents: 5000,
            source: { kind: 'leistung', id: 'contract-leistung' },
            cost: { amountCents: 4180, priceQuantity: 1 },
          },
        ],
      },
    ],
  });
});

// An article's price can arrive while a save of the earlier content runs,
// before or after its answer: the save confirms, no other session's change is
// claimed, and the added Position stays to save on the saved version.
for (const order of ['article first', 'answer first'] as const) {
  test(`a Position whose article arrives during a save stays after the save (${order})`, async ({ page }) => {
    await openContractFixture(page, 'offers');
    const editor = page.getByRole('form', { name: 'Titel und Positionen' });
    const save = editor.getByRole('button', { name: 'Speichern', exact: true });
    await editor.getByRole('button', { name: 'Titel hinzufügen', exact: true }).click();
    await editor.getByRole('textbox', { name: 'Titel 1' }).fill('Material');

    await page.evaluate(() => {
      window.uiContractHoldArticleRead = true;
    });
    await editor.getByRole('combobox', { name: 'Artikel zu Titel 1 hinzufügen' }).click();
    await expect.poll(() => page.evaluate(() => window.optionContract.requests.length)).toBe(1);
    await page.evaluate(() =>
      window.optionContract.resolve(0, [{ value: 'contract-article', label: 'KB-15 · Kupferbogen 15 mm' }]),
    );
    await page.getByRole('option', { name: 'KB-15 · Kupferbogen 15 mm' }).click();
    await expect.poll(() => page.evaluate(() => window.uiContractArticleRead !== null)).toBe(true);

    await save.click();
    await expectHeldWrite(page, 'save-offer-content');
    const name = editor.getByRole('textbox', { name: 'Bezeichnung' });
    if (order === 'article first') {
      await page.evaluate(() => window.uiContractArticleRead?.());
      await expect(name).toHaveValue('Kupferbogen 15 mm');
      await answerHeldWrite(page, null);
    } else {
      await answerHeldWrite(page, null);
      await expect.poll(() => page.evaluate(() => window.uiContractWrites.answer)).toBeNull();
      await page.evaluate(() => window.uiContractArticleRead?.());
      await expect(name).toHaveValue('Kupferbogen 15 mm');
    }
    await page.evaluate(() =>
      window.uiContractOfferContentRender?.(2, [{ title: 'Material', positions: [] }]),
    );
    await expect(visibleText(page, 'Positionen gespeichert.', true)).toBeVisible();
    await expect(name).toHaveValue('Kupferbogen 15 mm');
    await expect(editor.getByText(/inzwischen geändert/)).toHaveCount(0);

    await editor.getByRole('combobox', { name: 'Einheit' }).click();
    await page.getByRole('option', { name: 'Stück', exact: true }).click();
    await save.click();
    await expect.poll(() => page.evaluate(() => window.uiContractWrites.answer !== null)).toBe(true);
    expect(await page.evaluate(() => window.uiContractWrites.calls[1]?.input)).toMatchObject({
      expectedContentVersion: 2,
      sections: [{ title: 'Material', positions: [{ source: { kind: 'article', id: 'contract-article' } }] }],
    });
  });
}

// Another session reorders the Titel while an article's price is read: the
// pick counts as an own change, so the editor offers „Neu laden“ instead of
// taking the new order, and the article lands under the Titel it was picked for.
test('an article lands under its Titel when another session reorders them during the read', async ({
  page,
}) => {
  await openContractFixture(page, 'offers');
  const editor = page.getByRole('form', { name: 'Titel und Positionen' });
  await page.evaluate(() =>
    window.uiContractOfferContentRender?.(2, [
      { title: 'Heizung', positions: [] },
      { title: 'Material', positions: [] },
    ]),
  );
  await expect(editor.getByRole('textbox', { name: 'Titel 2' })).toHaveValue('Material');

  await page.evaluate(() => {
    window.uiContractHoldArticleRead = true;
  });
  await editor.getByRole('combobox', { name: 'Artikel zu Titel 2 hinzufügen' }).click();
  await expect.poll(() => page.evaluate(() => window.optionContract.requests.length)).toBe(1);
  await page.evaluate(() =>
    window.optionContract.resolve(0, [{ value: 'contract-article', label: 'KB-15 · Kupferbogen 15 mm' }]),
  );
  await page.getByRole('option', { name: 'KB-15 · Kupferbogen 15 mm' }).click();
  await expect.poll(() => page.evaluate(() => window.uiContractArticleRead !== null)).toBe(true);
  await page.evaluate(() =>
    window.uiContractOfferContentRender?.(3, [
      { title: 'Material', positions: [] },
      { title: 'Heizung', positions: [] },
    ]),
  );
  await page.evaluate(() => window.uiContractArticleRead?.());

  await expect(editor.getByRole('textbox', { name: 'Bezeichnung' })).toHaveValue('Kupferbogen 15 mm');
  await expect(editor.getByRole('textbox', { name: 'Titel 2' })).toHaveValue('Material');
  const material = editor
    .getByRole('listitem')
    .filter({ has: page.getByRole('textbox', { name: 'Titel 2' }) });
  await expect(material.getByRole('textbox', { name: 'Bezeichnung' })).toHaveValue('Kupferbogen 15 mm');
  await expect(editor.getByText(/inzwischen geändert/)).toBeVisible();
});

// „Neu laden“ discards own changes, a pending article pick too: its price,
// arriving later, adds no Position to the Titel that now holds its place.
test('an article read that ends after „Neu laden“ adds no Position', async ({ page }) => {
  await openContractFixture(page, 'offers');
  const editor = page.getByRole('form', { name: 'Titel und Positionen' });
  await page.evaluate(() =>
    window.uiContractOfferContentRender?.(2, [
      { title: 'Heizung', positions: [] },
      { title: 'Material', positions: [] },
    ]),
  );
  await page.evaluate(() => {
    window.uiContractHoldArticleRead = true;
  });
  await editor.getByRole('combobox', { name: 'Artikel zu Titel 2 hinzufügen' }).click();
  await expect.poll(() => page.evaluate(() => window.optionContract.requests.length)).toBe(1);
  await page.evaluate(() =>
    window.optionContract.resolve(0, [{ value: 'contract-article', label: 'KB-15 · Kupferbogen 15 mm' }]),
  );
  await page.getByRole('option', { name: 'KB-15 · Kupferbogen 15 mm' }).click();
  await expect.poll(() => page.evaluate(() => window.uiContractArticleRead !== null)).toBe(true);
  await page.evaluate(() =>
    window.uiContractOfferContentRender?.(3, [
      { title: 'Material', positions: [] },
      { title: 'Heizung', positions: [] },
    ]),
  );
  await editor.getByRole('button', { name: 'Neu laden', exact: true }).click();
  await expect(editor.getByRole('textbox', { name: 'Titel 2' })).toHaveValue('Heizung');
  await page.evaluate(() => window.uiContractArticleRead?.());

  await expect(editor.getByText('Summe Titel 2: 0,00 €')).toBeVisible();
  await expect(editor.getByRole('textbox', { name: 'Bezeichnung' })).toHaveCount(0);
});
