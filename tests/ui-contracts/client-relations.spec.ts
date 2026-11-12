import { expect, test, type Locator, type Page } from '@playwright/test';
import { textInDom } from '../golden/support/steps/shared';
import { answerHeldWrite, expectHeldWrite, openContractFixture } from './open-fixture';

// Archiving a contact or a work site moves the row in the first frame and
// marks only that row. A refusal restores it with the reason; an acceptance
// keeps it archived once the refreshed route props arrive.
test.beforeEach(async ({ page }) => {
  // Runs in real time; the refresh-timeout contract moves it forward.
  await page.clock.install();
  await openContractFixture(page, 'client-relations');
});

async function openRoles(page: Page): Promise<Locator> {
  await page.getByRole('main').getByRole('button', { name: 'Rollen verwalten', exact: true }).click();
  return page.getByRole('dialog', { name: 'Rollen am Einsatzort' });
}

test('a refused contact archive returns the contact with the reason', async ({ page }) => {
  const main = page.getByRole('main');
  const archive = main.getByRole('button', { name: 'Ansprechpartner archivieren', exact: true });
  const restore = main.getByRole('button', { name: 'Ansprechpartner wiederherstellen', exact: true });
  await archive.click();
  await expect(archive).toHaveCount(0);
  await expect(restore).toBeDisabled();
  await expectHeldWrite(page, 'update-client-contact');
  await expect(main.getByRole('alert')).toHaveCount(0);

  await answerHeldWrite(page, 'not_authorized');
  await expect(archive).toBeEnabled();
  await expect(restore).toHaveCount(0);
  await expect(main.getByRole('alert')).toHaveText('Du hast keine Berechtigung für diese Aktion.');
  expect(await page.evaluate(() => window.uiContractClientRelations.contacts[0]?.isActive)).toBe(true);
});

test('an accepted site archive stays archived after the route refresh', async ({ page }) => {
  const main = page.getByRole('main');
  const archive = main.getByRole('button', { name: 'Einsatzort archivieren', exact: true });
  const restore = main.getByRole('button', { name: 'Einsatzort wiederherstellen', exact: true });
  await archive.click();
  await expect(archive).toHaveCount(0);
  await expect(restore).toBeDisabled();
  await expectHeldWrite(page, 'update-client-site');

  await answerHeldWrite(page, null);
  await expect(restore).toBeEnabled();
  await expect(archive).toHaveCount(0);
  await expect(main.getByRole('alert')).toHaveCount(0);
  expect(await page.evaluate(() => window.uiContractServices.navigation)).toContain('refresh');
});

test('a contact email that is not one address marks the field, focuses it and sends nothing', async ({
  page,
}) => {
  const main = page.getByRole('main');
  await main.getByRole('button', { name: 'Ansprechpartner bearbeiten', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const email = dialog.getByLabel('E-Mail', { exact: true });
  const fieldError = dialog.getByText('Bitte gib eine gültige E-Mail-Adresse ein oder lass das Feld leer.');
  const save = dialog.getByRole('button', { name: 'Speichern', exact: true });
  await expect(email).toHaveValue('petra.pohl(at)example.de');

  await save.click();
  await expect(email).toBeFocused();
  await expect(email).toHaveAttribute('aria-invalid', 'true');
  await expect(fieldError).toBeVisible();
  await expect(save).toBeEnabled();
  expect(await page.evaluate(() => window.uiContractWrites.calls)).toEqual([]);

  // A blank email is allowed: clearing the field clears the error and saves.
  await email.fill('');
  await expect(fieldError).toHaveCount(0);
  await save.click();
  await expectHeldWrite(page, 'update-client-contact');
});

test('the role dialog stays open while a role ends and shows the refusal in place', async ({ page }) => {
  const dialog = await openRoles(page);
  // The dialog's own close icon and its footer button share the name.
  const closeButtons = dialog.getByRole('button', { name: 'Schließen', exact: true });
  await dialog
    .getByRole('region', { name: 'Hausverwaltung' })
    .getByRole('button', { name: 'Beenden', exact: true })
    .click();
  await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expectHeldWrite(page, 'end-client-site-role');

  // Neither Escape nor „Schließen“ drops the running save.
  await expect(dialog).toHaveAttribute('data-pending', 'true');
  for (const close of await closeButtons.all()) await expect(close).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();

  await answerHeldWrite(page, 'role_ends_before_start');
  await expect(dialog).not.toHaveAttribute('data-pending');
  await expect(dialog.getByText('Das Ende darf nicht vor dem Beginn liegen.')).toBeVisible();
  for (const close of await closeButtons.all()) await expect(close).toBeEnabled();
});

test('after a scheduled owner handover each action changes the role it sits on', async ({ page }) => {
  const dialog = await openRoles(page);
  const owners = dialog.getByRole('region', { name: 'Eigentümer' });
  const current = owners.getByRole('listitem').filter({ hasText: 'Erika Musterfrau' });
  const coming = owners.getByRole('listitem').filter({ hasText: 'Max Mustermann' });
  // The current owner already ends; only the coming owner, who has no end, can change or end.
  await expect(current.getByRole('button')).toHaveCount(0);
  await expect(owners.getByRole('button', { name: 'Eintragen', exact: true })).toHaveCount(0);
  await coming.getByRole('button', { name: 'Beenden', exact: true }).click();
  await expect(dialog.getByText('Eigentümer Max Mustermann beenden', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expectHeldWrite(page, 'end-client-site-role');
  // A role that has not begun ends no earlier than its first day.
  expect(await page.evaluate(() => window.uiContractWrites.calls[0]?.input)).toEqual({
    roleId: 'contract-owner-next',
    endsOn: '2099-01-01',
  });
  await answerHeldWrite(page, 'not_authorized');
});

test('a work site shows a role that only begins later with its first day', async ({ page }) => {
  const summary = page.getByRole('main').getByText('Rechnungsempfänger:', { exact: false });
  await expect(summary).toHaveText('Rechnungsempfänger: Hausverwaltung Lindenhof GmbH ab 01.01.2099');
});

test('a saved role whose refresh does not arrive keeps the warning and the open edit', async ({ page }) => {
  const dialog = await openRoles(page);
  await dialog
    .getByRole('region', { name: 'Hausverwaltung' })
    .getByRole('button', { name: 'Beenden', exact: true })
    .click();
  await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expectHeldWrite(page, 'end-client-site-role');
  // Accepted, but the next read returns the same roles: the list never changes.
  await answerHeldWrite(page, null);
  await page.clock.runFor(15_001);
  await expect(
    textInDom(
      page,
      'Die Änderung wurde gespeichert, die Ansicht aber noch nicht aktualisiert. Bitte aktualisiere die Seite.',
    ),
  ).toHaveCount(1);
  await expect(textInDom(page, 'Rolle gespeichert.')).toHaveCount(0);
  await expect(
    dialog.getByText('Hausverwaltung Hausverwaltung Lindenhof GmbH beenden', { exact: true }),
  ).toBeVisible();
});

test('roles that could not be read show the failure with a retry and offer no entry', async ({ page }) => {
  const dialog = await openRoles(page);
  await dialog
    .getByRole('region', { name: 'Hausverwaltung' })
    .getByRole('button', { name: 'Beenden', exact: true })
    .click();
  await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expectHeldWrite(page, 'end-client-site-role');
  await page.evaluate(() => {
    window.uiContractClientSiteRoles = null;
  });
  await answerHeldWrite(page, null);
  await expect(dialog.getByText('Die Rollen konnten nicht geladen werden.')).toBeVisible();
  for (const name of ['Eintragen', 'Wechseln', 'Beenden', 'Speichern'])
    await expect(dialog.getByRole('button', { name, exact: true })).toHaveCount(0);

  // The retry reads the route again; a read that answers brings the roles back.
  await page.evaluate(() => {
    window.uiContractClientSiteRoles = [
      {
        id: 'contract-role',
        siteId: 'contract-site',
        siteName: 'Heizungskeller Nordflügel',
        siteAddress: 'Lindenstraße 4, 10115 Berlin',
        siteSourceNumber: null,
        siteIsActive: true,
        siteClientId: 'contract-client',
        siteClientName: 'WEG Lindenstraße 4',
        holderClientId: 'contract-manager',
        holderName: 'Hausverwaltung Lindenhof GmbH',
        holderArchived: false,
        role: 'hausverwaltung',
        startsOn: '2020-01-01',
        endsOn: null,
      },
    ];
  });
  await dialog.getByRole('button', { name: 'Erneut laden', exact: true }).click();
  await expect(dialog.getByText('Die Rollen konnten nicht geladen werden.')).toHaveCount(0);
  await expect(dialog.getByRole('region', { name: 'Hausverwaltung' })).toBeVisible();
});
