import { expect, test } from '@playwright/test';
import { visibleText } from '../golden/support/steps/shared';
import { answerHeldWrite, openContractFixture } from './open-fixture';

// „Versenden“ on a sent offer's revisions (components/angebote/offer-revision-delivery.tsx):
// the newest revision takes an email and a retry; a revision a later one
// replaced lists its sends read-only and offers neither, also when only the
// dialog's read knows of the later revision.

test('the newest revision is sent by email and retried; a replaced revision lists its sends and offers no send', async ({
  page,
}) => {
  await openContractFixture(page, 'offer-delivery');
  const main = page.getByRole('region', { name: 'Aktuelle Seite' });

  await main.getByRole('button', { name: 'Versand ansehen' }).click();
  const replaced = page.getByRole('dialog', { name: 'Angebot versenden' });
  await expect(replaced.getByText('Ersetzt durch Revision 2', { exact: false })).toBeVisible();
  await expect(replaced.getByText('E-Mail an verwaltung@lindenhof.example')).toBeVisible();
  await expect(replaced.getByRole('button', { name: 'Per E-Mail senden' })).toHaveCount(0);
  await expect(replaced.getByRole('button', { name: 'Erneut senden' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(replaced).toBeHidden();

  await main.getByRole('button', { name: 'Versenden' }).click();
  const newest = page.getByRole('dialog', { name: 'Angebot versenden' });
  await expect(
    newest.getByText('Revision 2 an Hausverwaltung Lindenhof GmbH', { exact: false }),
  ).toBeVisible();
  await expect(newest.getByRole('button', { name: 'Erneut senden' })).toBeEnabled();
  await expect(newest.getByRole('button', { name: 'Als manuell versendet markieren' })).toHaveCount(0);
  await newest.getByRole('button', { name: 'Per E-Mail senden' }).click();
  await expect(newest.getByLabel('Empfänger')).toHaveValue('einkauf@lindenhof.example');
  const send = newest.getByRole('button', { name: 'Senden' });
  await send.click();
  await expect(send, 'the send shows no pending state while its answer is held').toBeDisabled();
  await expect(newest.getByLabel('Empfänger')).toBeDisabled();
  await answerHeldWrite(page, null);
  await expect(visibleText(page, 'Das Angebot ist an einkauf@lindenhof.example versendet.')).toBeVisible();
});

test('a stale page’s newest revision turns read-only when its read names a later revision', async ({
  page,
}) => {
  await openContractFixture(page, 'offer-delivery');
  await page
    .getByRole('region', { name: 'Veraltete Seite' })
    .getByRole('button', { name: 'Versenden' })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Angebot versenden' });
  await expect(dialog.getByText('Ersetzt durch Revision 5', { exact: false })).toBeVisible();
  await expect(dialog.getByText('E-Mail an verwaltung@lindenhof.example')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Per E-Mail senden' })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Erneut senden' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(
    page.getByRole('region', { name: 'Veraltete Seite' }).getByRole('button', { name: 'Versand ansehen' }),
  ).toBeVisible();
});
