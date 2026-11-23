import { expect, test, type Page } from '@playwright/test';
import { answerHeldWrite, expectHeldWrite, openContractFixture } from './open-fixture';

// The admin's WerkFlow KI switch is a micro-toggle: it flips in the first
// frame while the write is open, marked unconfirmed (lib/ui/unconfirmed.ts),
// stays pending and locked until the refreshed props carry the new value,
// stays quiet once confirmed, and turns back with the reason when refused.
test.beforeEach(async ({ page }) => {
  await openContractFixture(page, 'ai-settings');
});

async function releaseRefresh(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => window.uiContractAiReleaseRefresh !== null)).toBe(true);
  await page.evaluate(() => window.uiContractAiReleaseRefresh?.());
}

test('the switch flips at once and stays locked until the refreshed props confirm it', async ({ page }) => {
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
  expect(await page.evaluate(() => window.uiContractWrites.calls[0]?.input)).toEqual({
    organizationId: '00000000-0000-4000-8000-0000000000a1',
    enabled: true,
  });

  // Accepted, but the refreshed props have not landed: still pending, still locked.
  await answerHeldWrite(page, null);
  await expect(pending).toBeVisible();
  await expect(toggle).toBeDisabled();
  await expect(toggle).toBeChecked();

  await releaseRefresh(page);
  await expect(pending).toHaveCount(0);
  await expect(toggle).toBeEnabled();
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
