import { expect, test, type Page } from '@playwright/test';
import { visibleText } from '../golden/support/steps/shared';
import { answerHeldWrite, openContractFixture } from './open-fixture';

// „Versand“ of a Servicebericht ("Sending a Servicebericht"): a send whose
// answer was lost is pressed again under the same attempt key, also after
// „Zurück“ and reopening the step, so the database replays it instead of
// sending or recording twice. A changed email or note is a new send, and a
// confirmed one starts the next from a new key.

/** Waits until the dialog issued its `count`th write and the gate holds it open; returns that write's attempt key. */
async function heldAttemptKey(page: Page, count: number): Promise<string> {
  await expect
    .poll(() =>
      page.evaluate(() => ({
        calls: window.uiContractWrites.calls.length,
        open: window.uiContractWrites.answer !== null,
      })),
    )
    .toEqual({ calls: count, open: true });
  const key = await page.evaluate((index) => {
    const input = window.uiContractWrites.calls[index]?.input;
    return input && typeof input === 'object' && 'attemptKey' in input ? String(input.attemptKey) : null;
  }, count - 1);
  expect(key, 'the write named no attempt key').not.toBeNull();
  return String(key);
}

test('an email whose answer was lost is sent again under its key, also after „Zurück“; a changed or confirmed one gets a new key', async ({
  page,
}) => {
  await openContractFixture(page, 'service-report-delivery');
  await page.getByRole('button', { name: 'Versand' }).click();
  const dialog = page.getByRole('dialog');
  const subject = dialog.getByLabel('Betreff');

  await dialog.getByRole('button', { name: 'Per E-Mail senden' }).click();
  await dialog.getByRole('button', { name: 'Senden' }).click();
  const first = await heldAttemptKey(page, 1);
  await answerHeldWrite(page, 'lost_answer');
  await expect(dialog.getByText('Die E-Mail konnte nicht versendet werden.', { exact: false })).toBeVisible();

  await dialog.getByRole('button', { name: 'Zurück' }).click();
  await dialog.getByRole('button', { name: 'Per E-Mail senden' }).click();
  await dialog.getByRole('button', { name: 'Senden' }).click();
  expect(await heldAttemptKey(page, 2), 'the same email after „Zurück“ was sent as a new one').toBe(first);
  await answerHeldWrite(page, 'lost_answer');

  await subject.fill('Servicebericht Lindenhof');
  await dialog.getByRole('button', { name: 'Senden' }).click();
  const changed = await heldAttemptKey(page, 3);
  expect(changed, 'a changed email replayed the earlier one').not.toBe(first);
  await answerHeldWrite(page, null);
  await expect(
    visibleText(page, 'Der Servicebericht ist an hausmeister@lindenhof.example versendet.'),
  ).toBeVisible();

  await dialog.getByRole('button', { name: 'Per E-Mail senden' }).click();
  await expect(subject).toHaveValue(
    'Servicebericht zur Wartung vom 12.11.2037 – Haustechnik Sonnenberg GmbH',
  );
  await dialog.getByRole('button', { name: 'Senden' }).click();
  const next = await heldAttemptKey(page, 4);
  expect([first, changed], 'a new email after a confirmed send replayed an earlier one').not.toContain(next);
});

test('a manual record keeps its note and key across „Zurück“ until it is confirmed, and the note waits for the answer', async ({
  page,
}) => {
  await openContractFixture(page, 'service-report-delivery');
  await page.getByRole('button', { name: 'Versand' }).click();
  const dialog = page.getByRole('dialog');
  const note = dialog.getByLabel('Notiz');
  const record = dialog.getByRole('button', { name: 'Als versendet markieren' });

  await dialog.getByRole('button', { name: 'Als manuell versendet markieren' }).click();
  await note.fill('per Post');
  await record.click();
  const first = await heldAttemptKey(page, 1);
  await expect(note, 'the note changed while its record was pending').toBeDisabled();
  await answerHeldWrite(page, 'lost_answer');
  await expect(dialog.getByText('Der Versand konnte nicht vermerkt werden.', { exact: false })).toBeVisible();
  await expect(note).toBeEnabled();

  await dialog.getByRole('button', { name: 'Zurück' }).click();
  await dialog.getByRole('button', { name: 'Als manuell versendet markieren' }).click();
  await expect(note).toHaveValue('per Post');
  await record.click();
  expect(await heldAttemptKey(page, 2), 'the same record after „Zurück“ was recorded as a new one').toBe(
    first,
  );
  await answerHeldWrite(page, 'lost_answer');

  await note.fill('per Post am 21.11.');
  await record.click();
  const changed = await heldAttemptKey(page, 3);
  expect(changed, 'a different note replayed the earlier record').not.toBe(first);
  await answerHeldWrite(page, null);
  await expect(visibleText(page, 'Der Servicebericht ist als manuell versendet vermerkt.')).toBeVisible();

  await dialog.getByRole('button', { name: 'Als manuell versendet markieren' }).click();
  await expect(note).toHaveValue('');
  await record.click();
  const next = await heldAttemptKey(page, 4);
  expect([first, changed], 'a new record after a confirmed one replayed an earlier one').not.toContain(next);
});
