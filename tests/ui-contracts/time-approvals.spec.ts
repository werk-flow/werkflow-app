import { expect, test } from '@playwright/test';
import { answerHeldWrite, expectHeldWrite, openContractFixture } from './open-fixture';

// The time-entry, change-request and correction approval cards leave with the
// click. Until the server answers, nothing claims success; a refusal brings
// the card back with the reason, an acceptance confirms only after the write.
test.beforeEach(async ({ page }) => {
  await openContractFixture(page, 'time-approvals');
});

test('a time-entry card leaves at once and confirms only after the server accepted it', async ({ page }) => {
  const approve = page.getByTitle('Genehmigen - Eintrag bleibt erhalten', { exact: true });
  await expect(approve).toBeVisible();
  await approve.click();
  await expect(approve).toHaveCount(0);
  await expectHeldWrite(page, 'review-entries');
  await expect(page.getByRole('alert')).toHaveCount(0);

  await answerHeldWrite(page, null);
  await expect(page.getByRole('alert')).toContainText('Der Zeiteintrag wurde genehmigt.');
  // The follow-up read no longer carries the reviewed session.
  await expect(approve).toHaveCount(0);
  expect(await page.evaluate(() => window.uiContractTimeApprovals.sessions)).toEqual([]);
});

test('a refused time-entry review comes back and says that nothing changed', async ({ page }) => {
  const approve = page.getByTitle('Genehmigen - Eintrag bleibt erhalten', { exact: true });
  await expect(approve).toBeVisible();
  await approve.click();
  await expect(approve).toHaveCount(0);
  await expectHeldWrite(page, 'review-entries');

  await answerHeldWrite(page, 'entry_not_pending');
  await expect(approve).toBeVisible();
  await expect(page.getByRole('alert')).toHaveText(
    'Ein Eintrag wurde bereits bearbeitet. Die Ansicht wurde aktualisiert. Es wurde nichts geändert.',
  );
  expect(await page.evaluate(() => window.uiContractTimeApprovals.sessions)).toHaveLength(1);
});

test('a refused change request comes back with the reason and never confirms', async ({ page }) => {
  const approve = page.getByTitle('Genehmigen - Änderung wird bestätigt', { exact: true });
  await expect(approve).toBeVisible();
  await approve.click();
  await expect(approve).toHaveCount(0);
  await expectHeldWrite(page, 'review-change-request');
  await expect(page.getByRole('alert')).toHaveCount(0);

  await answerHeldWrite(page, 'request_already_reviewed');
  await expect(approve).toBeVisible();
  await expect(page.getByRole('alert')).toHaveText('Der Antrag wurde bereits bearbeitet.');
  expect(await page.evaluate(() => window.uiContractTimeApprovals.changeRequests)).toHaveLength(1);
});

test('a refused correction comes back with the reason and never confirms', async ({ page }) => {
  const corrections = page.getByRole('region', { name: 'Zeitkorrekturen prüfen', exact: true });
  const release = corrections.getByRole('button', { name: 'Freigeben', exact: true });
  await expect(release).toBeVisible();
  await release.click();
  await expect(release).toHaveCount(0);
  await expectHeldWrite(page, 'review-time-correction');
  await expect(page.getByRole('alert')).toHaveCount(0);

  await answerHeldWrite(page, 'stale_revision');
  await expect(release).toBeEnabled();
  await expect(page.getByRole('alert')).toHaveText('Die Entscheidung konnte nicht gespeichert werden.');
  expect(await page.evaluate(() => window.uiContractTimeApprovals.corrections)).toHaveLength(1);
});
