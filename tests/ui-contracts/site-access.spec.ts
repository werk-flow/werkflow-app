import { expect, test, type Locator, type Page } from '@playwright/test';
import { textInDom } from '../golden/support/steps/shared';
import { answerHeldWrite, expectHeldWrite, openContractFixture } from './open-fixture';

// The access proposal's form and its office review (werk-flow/werkflow-planning#329).
// A decision belongs to the revision its manager reviewed, a lost answer
// keeps the dialog open with its input, and a saved proposal settles on the
// render its action brings along.

async function openReview(page: Page): Promise<Locator> {
  await openContractFixture(page, 'site-access-review');
  await page.getByRole('button', { name: 'Zugangshinweis prüfen', exact: true }).click();
  return page.getByRole('dialog', { name: 'Zugang zu Haus Lindenstraße prüfen' });
}

async function chooseContact(dialog: Locator, name: string): Promise<void> {
  await dialog.getByRole('combobox').click();
  await dialog
    .page()
    .getByRole('option', { name: new RegExp(`^Ersetzt ${name}`) })
    .click();
  await expect(dialog.getByRole('combobox')).toContainText(`Ersetzt ${name}`);
}

async function heldInput(page: Page): Promise<unknown> {
  return page.evaluate(() => window.uiContractWrites.calls.at(-1)?.input);
}

test('a replaced proposal drops the choice and the reason made for the previous revision', async ({
  page,
}) => {
  const dialog = await openReview(page);
  await chooseContact(dialog, 'Herr Alt');
  await dialog.getByRole('button', { name: 'Ablehnen', exact: true }).click();
  const reason = dialog.getByRole('textbox', { name: /Begründung/ });
  await reason.fill('Herr Alt bleibt zuständig.');
  await dialog.getByRole('button', { name: 'Ablehnen', exact: true }).click();
  await expectHeldWrite(page, 'reject-site-access');
  // The worker replaced the proposal meanwhile; the page reads the new revision.
  await answerHeldWrite(page, 'proposal_changed');
  await expect(dialog.getByRole('alert')).toContainText('Der Hinweis wurde gerade geändert.');
  await expect(dialog.getByText('Erika Mustermann', { exact: false })).toBeVisible();
  await expect(reason, 'the reason was written for the previous revision').toHaveValue('');
  await expect(
    dialog.getByText('Bitte gib eine Begründung', { exact: false }),
    'the new revision has not been submitted yet',
  ).toHaveCount(0);

  await dialog.getByRole('button', { name: 'Zurück', exact: true }).click();
  await expect(dialog.getByRole('combobox'), 'the choice was made for the previous revision').toContainText(
    'Bitte wählen',
  );
  // Accepting now asks for a choice instead of sending the old one.
  await dialog.getByRole('button', { name: 'Übernehmen', exact: true }).click();
  await expect(dialog.getByText('Wähle, welchen Zugangskontakt der Hinweis ersetzt.')).toBeVisible();
  expect(await page.evaluate(() => window.uiContractWrites.calls.length)).toBe(1);

  await chooseContact(dialog, 'Frau Birke');
  await expect(
    dialog.getByText('Bisheriger Hinweis zur Person: Hausmeisterin', { exact: true }),
    'the review shows the note the proposed one replaces',
  ).toBeVisible();
  await dialog.getByRole('button', { name: 'Übernehmen', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.uiContractWrites.calls.length)).toBe(2);
  expect(await heldInput(page)).toEqual({
    proposalId: '9b000000-0000-4000-8000-000000000001',
    revision: 2,
    reviewedAccessNotes: 'Schlüssel beim Hausmeister',
    contact: {
      id: '9b000000-0000-4000-8000-000000000051',
      reviewedName: 'Frau Birke',
      reviewedPhone: '030 222',
      reviewedNote: 'Hausmeisterin',
    },
  });
  await answerHeldWrite(page, null);
  await expect(dialog).toHaveCount(0);
});

test('a decision whose answer is lost keeps the review open with the choice', async ({ page }) => {
  const dialog = await openReview(page);
  await chooseContact(dialog, 'Herr Alt');
  const accept = dialog.getByRole('button', { name: 'Übernehmen', exact: true });
  await accept.click();
  await expectHeldWrite(page, 'accept-site-access');
  await answerHeldWrite(page, 'transport');
  await expect(dialog.getByRole('alert')).toHaveText(
    'Die Entscheidung konnte nicht gespeichert werden. Versuche es in einem Moment erneut.',
  );
  await expect(dialog.getByRole('combobox')).toContainText('Ersetzt Herr Alt');
  await expect(accept).toBeEnabled();
});

async function openProposal(page: Page): Promise<Locator> {
  await openContractFixture(page, 'site-access-proposal');
  await page.getByRole('button', { name: 'Zugang korrigieren', exact: true }).click();
  return page.getByRole('dialog', { name: 'Zugang korrigieren' });
}

async function fillProposal(dialog: Locator): Promise<void> {
  await dialog.getByLabel('Wer lässt dich rein?').fill('Erika Musterfrau');
  await dialog.getByLabel('Wie kommst du rein?').fill('Seiteneingang über den Hof');
  await dialog.getByRole('button', { name: 'An Büro senden', exact: true }).click();
  await expectHeldWrite(dialog.page(), 'propose-site-access');
}

test('a proposal whose answer is lost keeps the form open with the input', async ({ page }) => {
  const dialog = await openProposal(page);
  await fillProposal(dialog);
  await answerHeldWrite(page, 'transport');
  await expect(dialog.getByRole('alert')).toHaveText(
    'Dein Hinweis konnte nicht gesendet werden. Versuche es in einem Moment erneut.',
  );
  await expect(dialog.getByLabel('Wer lässt dich rein?')).toHaveValue('Erika Musterfrau');
  await expect(dialog.getByLabel('Wie kommst du rein?')).toHaveValue('Seiteneingang über den Hof');
  await expect(dialog.getByRole('button', { name: 'An Büro senden', exact: true })).toBeEnabled();
});

test('a saved proposal settles on the render its action brought along', async ({ page }) => {
  // Runs in real time; the settle timeout is moved past below.
  await page.clock.install();
  const dialog = await openProposal(page);
  await fillProposal(dialog);
  await answerHeldWrite(page, null);
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('main').getByText('Hinweis beim Büro', { exact: true })).toBeVisible();
  await expect(textInDom(page, 'Dein Hinweis ist beim Büro.')).toHaveCount(1);
  await page.clock.runFor(15_001);
  await expect(
    textInDom(
      page,
      'Die Änderung wurde gespeichert, die Ansicht aber noch nicht aktualisiert. Bitte aktualisiere die Seite.',
    ),
    'the render landed with the answer, before the wait for it began',
  ).toHaveCount(0);
});
