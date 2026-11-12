import { expect, test, type Page } from '@playwright/test';
import { answerHeldWrite, openContractFixture } from './open-fixture';

// Every press of one opening of „Neue Anfrage erfassen“ sends the same attempt
// key, so a retry after a lost answer returns the request the first press
// captured instead of a second one (werk-flow/werkflow-planning#324). The next
// opening captures another request under a new key.

/** The attempt keys of the saves the dialog issued, once the gate holds the last one open. */
async function heldSaveKeys(page: Page, count: number): Promise<unknown[]> {
  await expect
    .poll(() =>
      page.evaluate(() => ({
        saves: window.uiContractWrites.calls.length,
        open: window.uiContractWrites.answer !== null,
      })),
    )
    .toEqual({ saves: count, open: true });
  return page.evaluate(() =>
    window.uiContractWrites.calls.map((call) =>
      call.input && typeof call.input === 'object' && 'attemptKey' in call.input
        ? call.input.attemptKey
        : null,
    ),
  );
}

test('a retry after a lost answer reuses the attempt key; the next opening gets a new one', async ({
  page,
}) => {
  await openContractFixture(page, 'request-capture');
  const heading = page.getByRole('heading', { name: 'Neue Anfrage erfassen' });
  const save = page.getByRole('button', { name: 'Anfrage erfassen' });

  await page.getByRole('button', { name: 'Anfrage erfassen' }).click();
  await expect(heading).toBeVisible();
  await page.getByLabel('Anliegen').fill('Heizung fällt aus');
  await save.click();
  const [firstKey] = await heldSaveKeys(page, 1);
  expect(firstKey).toEqual(expect.stringMatching(/^[0-9a-f-]{36}$/));

  // The answer never arrives: the dialog stays open with the entered summary.
  await answerHeldWrite(page, 'lost');
  await expect(page.getByRole('dialog').getByText('Ein unerwarteter Fehler ist aufgetreten.')).toBeVisible();
  await expect(page.getByLabel('Anliegen')).toHaveValue('Heizung fällt aus');

  await save.click();
  expect(await heldSaveKeys(page, 2)).toEqual([firstKey, firstKey]);
  await answerHeldWrite(page, null);
  await expect(heading).toBeHidden();
  await expect(page.getByRole('alert').filter({ hasText: 'Anfrage wurde erfasst.' })).toBeVisible();

  await page.getByRole('button', { name: 'Anfrage erfassen' }).click();
  await page.getByLabel('Anliegen').fill('Wartung bestätigen');
  await save.click();
  const keys = await heldSaveKeys(page, 3);
  expect(keys.slice(0, 2)).toEqual([firstKey, firstKey]);
  expect(keys[2]).toEqual(expect.stringMatching(/^[0-9a-f-]{36}$/));
  expect(keys[2]).not.toBe(firstKey);
});
