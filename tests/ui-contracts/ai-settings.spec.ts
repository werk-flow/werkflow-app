import { expect, test } from '@playwright/test';
import { answerHeldWrite, expectHeldWrite, openContractFixture } from './open-fixture';

// The admin's WerkFlow KI switch is a micro-toggle: it flips in the first
// frame while the write is open, marked unconfirmed (lib/ui/unconfirmed.ts),
// stays quiet once accepted, and turns back with the reason when refused.
test.beforeEach(async ({ page }) => {
  await openContractFixture(page, 'ai-settings');
});

test('the switch flips at once and stays on after the accepted write', async ({ page }) => {
  const toggle = page.getByRole('checkbox', {
    name: 'WerkFlow KI in dieser Organisation nutzen',
    exact: true,
  });
  await expect(toggle).not.toBeChecked();
  await toggle.click();
  const pending = page.getByRole('status', { name: 'WerkFlow KI wird umgeschaltet', exact: true });
  await expect(toggle).toBeChecked();
  await expect(pending).toHaveAttribute('data-unconfirmed', '');
  await expectHeldWrite(page, 'set-ai-enabled');
  expect(await page.evaluate(() => window.uiContractWrites.calls[0]?.input)).toEqual({ enabled: true });

  await answerHeldWrite(page, null);
  await expect(pending).toHaveCount(0);
  await expect(toggle).toBeChecked();
  await expect(
    page.getByText('Alle Mitglieder können WerkFlow KI nutzen, sobald sie verfügbar ist.'),
  ).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('a refused switch turns back and says why', async ({ page }) => {
  const toggle = page.getByRole('checkbox', {
    name: 'WerkFlow KI in dieser Organisation nutzen',
    exact: true,
  });
  await toggle.click();
  await expect(toggle).toBeChecked();
  await expectHeldWrite(page, 'set-ai-enabled');

  await answerHeldWrite(page, 'update_failed');
  await expect(toggle).not.toBeChecked();
  await expect(page.getByRole('alert')).toHaveText(
    'WerkFlow KI konnte nicht umgeschaltet werden. Versuche es erneut.',
  );
  await expect(toggle).toBeEnabled();
});
