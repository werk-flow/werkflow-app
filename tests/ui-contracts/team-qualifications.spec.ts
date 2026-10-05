import { expect, test } from '@playwright/test';
import { answerHeldWrite, expectHeldWrite, openContractFixture } from './open-fixture';

// A new team and a confirmed qualification show in the first frame while the
// write is open. A refused team leaves with the reason at the form; an
// accepted confirmation stays once the refreshed workspace arrives.
test.beforeEach(async ({ page }) => {
  await openContractFixture(page, 'team-qualifications');
});

test('a refused team leaves the list and shows the reason at the form', async ({ page }) => {
  const teams = page.getByRole('region', { name: 'Teams', exact: true });
  const create = teams.getByRole('button', { name: 'Team anlegen', exact: true });
  await teams.getByRole('textbox', { name: 'Name', exact: true }).fill('Kundendienst Nord');
  await create.click();
  const savingTeam = teams
    .getByRole('status', { name: 'Team wird gespeichert', exact: true })
    .filter({ hasText: 'Kundendienst Nord' });
  await expect(savingTeam).toBeVisible();
  await expect(create).toBeDisabled();
  await expectHeldWrite(page, 'create-team');
  await expect(teams.getByRole('alert')).toHaveCount(0);

  await answerHeldWrite(page, 'duplicate_name');
  await expect(savingTeam).toHaveCount(0);
  await expect(teams.getByRole('alert')).toHaveText('Ein aktives Team mit diesem Namen besteht bereits.');
  await expect(teams.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue('Kundendienst Nord');
  await expect(create).toBeEnabled();
});

test('a confirmed qualification shows at once and stays after the accepted write', async ({ page }) => {
  const record = page
    .getByRole('region', { name: 'Qualifikationen', exact: true })
    .getByTestId('employee-capability-row');
  await expect(record).toContainText('nicht bestätigt');
  await record.getByRole('button', { name: 'Bestätigen', exact: true }).click();
  await expect(record).toContainText('intern bestätigt');
  await expect(record.getByRole('status', { name: 'Wird gespeichert', exact: true })).toBeVisible();
  await expect(record.getByRole('button', { name: 'Bestätigung aufheben', exact: true })).toBeDisabled();
  await expectHeldWrite(page, 'update-employee-capability');
  await expect(page.getByRole('alert')).toHaveCount(0);

  await answerHeldWrite(page, null);
  await expect(page.getByRole('alert')).toContainText('Die Bestätigung wurde geändert.');
  await expect(record.getByRole('status', { name: 'Wird gespeichert', exact: true })).toHaveCount(0);
  await expect(record).toContainText('intern bestätigt');
  await expect(record.getByRole('button', { name: 'Bestätigung aufheben', exact: true })).toBeEnabled();
});
