import { expect, test, type Page } from '@playwright/test';
import { answerHeldWrite, openContractFixture } from './open-fixture';

// Creating a customer shows its likely duplicates before it saves: a draft
// without a match saves on the first press; a draft with one lists it with
// its reasons and „Öffnen“ and saves only on a second, deliberate press. A
// changed identifying field is a new draft and is checked again
// (werk-flow/werkflow-planning#323).
test.beforeEach(async ({ page }) => {
  await openContractFixture(page, 'customer-create');
  await page.getByRole('button', { name: 'Kunde hinzufügen' }).click();
  await expect(page.getByRole('heading', { name: 'Neuen Kunden anlegen' })).toBeVisible();
});

/** Waits until the dialog has issued these saves, in order, and the gate holds the last open. */
async function expectSaves(page: Page, saves: readonly (readonly [string, unknown])[]): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(() => ({
        calls: window.uiContractWrites.calls.map((call) => [call.kind, call.input]),
        open: window.uiContractWrites.answer !== null,
      })),
    )
    .toEqual({ calls: saves, open: true });
}

const draft = { name: 'Erika Musterfrau', clientType: 'privat', phone: '030 4440123' };

test('a draft without a match saves on the first press', async ({ page }) => {
  await page.getByLabel('Name').fill(draft.name);
  await page.getByLabel('Telefon').fill(draft.phone);
  await page.getByRole('button', { name: 'Kunde erstellen' }).click();
  await expectSaves(page, [['createClient', draft]]);
  await expect(page.getByRole('button', { name: 'Wird erstellt…' })).toBeVisible();

  await answerHeldWrite(page, null);
  await expect(page.getByRole('heading', { name: 'Neuen Kunden anlegen' })).toBeHidden();
  await expect(page.getByRole('alert').filter({ hasText: 'Kunde erfolgreich erstellt!' })).toBeVisible();
  expect(await page.evaluate(() => window.uiContractWrites.calls.length)).toBe(1);
});

test('a draft with a match lists it with its reasons and saves only on the second press', async ({
  page,
}) => {
  await page.getByLabel('Name').fill(draft.name);
  await page.getByLabel('Telefon').fill('030 999999');
  await page.getByRole('button', { name: 'Kunde erstellen' }).click();
  await expectSaves(page, [['createClient', { ...draft, phone: '030 999999' }]]);
  await answerHeldWrite(page, 'possible_duplicates');

  const matches = page.getByRole('status').filter({ hasText: 'Vielleicht schon Kunde' });
  await expect(matches).toContainText('Erika Musterfrau');
  await expect(matches).toContainText('Gleich: Telefon, Name und PLZ');
  await expect(matches.getByRole('link', { name: 'Erika Musterfrau in neuem Tab öffnen' })).toHaveAttribute(
    'href',
    '/kunden/10000000-0000-4000-8000-000000000021',
  );
  await expect(page.getByRole('heading', { name: 'Neuen Kunden anlegen' })).toBeVisible();

  // A changed phone is another draft: its matches are unknown until it is checked.
  await page.getByLabel('Telefon').fill(draft.phone);
  await expect(matches).toBeHidden();
  await page.getByRole('button', { name: 'Kunde erstellen' }).click();
  await expectSaves(page, [
    ['createClient', { ...draft, phone: '030 999999' }],
    ['createClient', draft],
  ]);
  await answerHeldWrite(page, 'possible_duplicates');
  await expect(matches).toBeVisible();

  // The deliberate second press creates the customer anyway.
  await page.getByRole('button', { name: 'Trotzdem neu anlegen' }).click();
  await expectSaves(page, [
    ['createClient', { ...draft, phone: '030 999999' }],
    ['createClient', draft],
    ['createClient:despite-matches', draft],
  ]);
  await expect(page.getByRole('heading', { name: 'Neuen Kunden anlegen' })).toBeHidden();
  await answerHeldWrite(page, null);
  await expect(page.getByRole('alert').filter({ hasText: 'Kunde erfolgreich erstellt!' })).toBeVisible();
});
