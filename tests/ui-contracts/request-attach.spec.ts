import { expect, test } from '@playwright/test';
import { answerHeldWrite, expectHeldWrite, openContractFixture } from './open-fixture';

// „Hinzufügen“ attaches the request for good, so it only ever submits work
// the user can see: a selection the search hides stays pinned on top of the
// list as „Deine Auswahl“ (werk-flow/werkflow-planning#328).
test('a selection the search hides stays visible and is the work that is attached', async ({ page }) => {
  await openContractFixture(page, 'request-attach');
  await page.getByRole('button', { name: 'Zu Arbeit hinzufügen', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const heating = dialog.getByRole('radio', { name: /Heizungswartung Lindenhof 1/ });
  const bathroom = dialog.getByRole('radio', { name: /Badsanierung Lindenhof 7/ });
  const search = dialog.getByRole('textbox', { name: 'Offene Arbeit durchsuchen' });
  const pinnedLabel = dialog.getByText('Deine Auswahl', { exact: true });

  await heating.click();
  await expect(heating).toHaveAttribute('aria-checked', 'true');
  await expect(pinnedLabel).toHaveCount(0);

  // A search that matches other work keeps the selection pinned above it.
  await search.fill('Bad');
  await expect(bathroom).toHaveAttribute('aria-checked', 'false');
  await expect(pinnedLabel).toBeVisible();
  await expect(heating).toBeVisible();
  await expect(heating).toHaveAttribute('aria-checked', 'true');

  // A search without a match still shows the selection next to its empty state.
  await search.fill('Keller');
  await expect(dialog.getByText('Keine offene Arbeit gefunden')).toBeVisible();
  await expect(bathroom).toHaveCount(0);
  await expect(heating).toBeVisible();
  await expect(heating).toHaveAttribute('aria-checked', 'true');

  await dialog.getByRole('button', { name: 'Hinzufügen', exact: true }).click();
  await expectHeldWrite(page, 'attachRequestToWork');
  const [write] = await page.evaluate(() => window.uiContractWrites.calls);
  expect(write?.input).toMatchObject({
    requestId: 'contract-request',
    work: { kind: 'job', id: 'contract-job-heizung' },
  });

  await answerHeldWrite(page, null);
  await expect(dialog).toBeHidden();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Anfrage wurde zu Auftrag A-51 hinzugefügt.' }),
  ).toBeVisible();
});
