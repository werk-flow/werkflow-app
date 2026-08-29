import type { Locator, Page } from '@playwright/test';

/** Returns the newest matching row because the timeline is rendered newest-first. */
export function newestCustomerTimelineRow(page: Page, ...textParts: string[]): Locator {
  let rows = page.locator('[data-testid="customer-timeline"] [data-timeline-key]');
  for (const text of textParts) rows = rows.filter({ hasText: text });
  return rows.first();
}

/** The contextual uploader's hidden file input has no accessible name. */
export function contextualDocumentFileInput(page: Page): Locator {
  return page.locator('input[type="file"]');
}

export function customerContactRow(page: Page, contactName: string): Locator {
  return page.locator('#ansprechpartner').getByRole('listitem').filter({ hasText: contactName });
}

export function customerSiteRow(page: Page, siteNameOrAddress: string): Locator {
  return page.locator('#einsatzorte').getByRole('listitem').filter({ hasText: siteNameOrAddress });
}
