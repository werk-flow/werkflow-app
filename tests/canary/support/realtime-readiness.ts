import { expect, type Page } from '@playwright/test';

/** Provider setup only; the following write keeps its separate two-second deadline. */
export async function waitForDatabaseSubscription(page: Page): Promise<void> {
  await expect(page.locator('html')).toHaveAttribute('data-realtime-postgres-state', 'ready', { timeout: 5_000 });
}
