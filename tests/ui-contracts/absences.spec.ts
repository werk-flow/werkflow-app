import { expect, test } from '@playwright/test';
import { openContractFixture } from './open-fixture';

// Recording an absence tells the office which planned work it takes the
// person away from, with each visit's dispatch state and a link to its day on
// the Plantafel; a failed read says so and retries. A person picker marks who
// is away on the chosen day from the calendar's capacity days, and says when
// the day lies outside the window it holds (walkthrough finding 43); so does
// „Einplanen am …“ for a parked job.

test('the saved sickness lists the affected visits with their dispatch state and Plantafel links', async ({
  page,
}) => {
  await openContractFixture(page, 'sickness-record');
  await page.getByRole('button', { name: 'Krankmeldung öffnen' }).click();
  const dialog = page.getByRole('dialog', { name: 'Krankmeldung erfassen' });
  await dialog.getByRole('button', { name: 'Krankmeldung erfassen' }).click();

  const affected = dialog.getByRole('region', { name: 'Betroffene Termine' });
  // In calendar order, each with the absent person's dispatch state.
  await expect(affected.getByRole('listitem')).toHaveText([
    /Heizungswartung Familie Berger.*Einsatz gesendet/,
    /Badsanierung Projekt Lindenstraße.*Einsatz nicht gesendet/,
  ]);
  await expect(affected.getByRole('link', { name: '30.10.2026, 08:00 Uhr' })).toHaveAttribute(
    'href',
    '/kalender?date=2026-10-30',
  );
  // The open-ended report names how far the list looks ahead.
  await expect(affected).toContainText('Diese Termine sind geplant bis 12.11.2026.');
  expect(await page.evaluate(() => window.uiContractAbsence.reads[0]?.endDate)).toBeNull();

  // The saved report stays until the office closes it.
  expect(await page.evaluate(() => window.uiContractAbsence.closed)).toBeNull();
  await dialog.getByRole('button', { name: 'Fertig' }).click();
  expect(await page.evaluate(() => window.uiContractAbsence.closed)).toBe(true);
});

test('a failed read of the affected visits says the report is saved and retries', async ({ page }) => {
  await openContractFixture(page, 'sickness-record');
  await page.getByRole('button', { name: 'Krankmeldung öffnen' }).click();
  await page.evaluate(() => {
    window.uiContractAbsence.affected = null;
  });
  const dialog = page.getByRole('dialog', { name: 'Krankmeldung erfassen' });
  await dialog.getByRole('button', { name: 'Krankmeldung erfassen' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Die Abwesenheit ist gespeichert.');

  await page.evaluate(() => {
    window.uiContractAbsence.affected = { through: '2026-11-12', visits: [] };
  });
  await dialog.getByRole('button', { name: 'Erneut laden' }).click();
  await expect(dialog.getByText('Keine geplanten Termine betroffen bis 12.11.2026.')).toBeVisible();
});

test('the person picker marks who is away on the day, and names a day outside the window', async ({
  page,
}) => {
  await page.clock.install({ time: new Date('2026-10-29T10:00:00Z') });
  await openContractFixture(page, 'absence-picker');
  await page.getByRole('combobox', { name: 'Mitarbeiter' }).click();
  await page.clock.runFor(1);
  await expect.poll(() => page.evaluate(() => window.planningOptionContract.requests.length)).toBe(1);
  await page.evaluate(() =>
    window.planningOptionContract.resolve(0, [
      {
        value: '00000000-0000-4000-8000-000000000021',
        label: 'Daniel Krüger',
        description: 'P-7',
        userId: null,
      },
      {
        value: '00000000-0000-4000-8000-000000000022',
        label: 'Lena Brandt',
        description: 'P-8',
        userId: null,
      },
    ]),
  );
  await expect(page.getByRole('option', { name: /Daniel Krüger/ })).toContainText('Abwesend · P-7');
  await expect(page.getByRole('option', { name: /Lena Brandt/ })).not.toContainText('Abwesend');
  const form = page.getByRole('main');
  await expect(form.getByText('Für diesen Tag sind keine Abwesenheiten geladen.')).toHaveCount(0);

  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Anderen Tag wählen' }).click();
  await expect(form.getByText('Für diesen Tag sind keine Abwesenheiten geladen.')).toBeVisible();
});

test('„Einplanen am …“ marks who is away on the chosen day, and names a day outside the window', async ({
  page,
}) => {
  await openContractFixture(page, 'schedule-parked-picker');
  await page.getByRole('button', { name: 'Einplanen am …' }).click();
  const dialog = page.getByRole('dialog', { name: 'Auftrag einplanen' });
  const date = dialog.getByRole('group', { name: 'Datum' });
  const person = dialog.getByRole('combobox', { name: 'Mitarbeiter' });
  const notLoaded = dialog.getByText('Für diesen Tag sind keine Abwesenheiten geladen.');
  const chooseDate = async (digits: string) => {
    await date.click();
    await date.press('ArrowLeft');
    await date.press('ArrowLeft');
    await date.pressSequentially(digits);
  };

  // Without a date the picker marks nobody and says nothing.
  await person.click();
  await expect(page.getByRole('option', { name: /Daniel Krüger/ })).not.toContainText('Abwesend');
  await page.keyboard.press('Escape');
  await expect(notLoaded).toHaveCount(0);

  await chooseDate('30102026');
  await person.click();
  await expect(page.getByRole('option', { name: /Daniel Krüger/ })).toContainText('Abwesend');
  await expect(page.getByRole('option', { name: /Lena Brandt/ })).not.toContainText('Abwesend');
  await page.keyboard.press('Escape');
  await expect(notLoaded).toHaveCount(0);

  await chooseDate('20112026');
  await expect(notLoaded).toBeVisible();
  await person.click();
  await expect(page.getByRole('option', { name: /Daniel Krüger/ })).not.toContainText('Abwesend');
});
