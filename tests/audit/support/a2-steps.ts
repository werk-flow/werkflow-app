import type { Locator, Page } from '@playwright/test';
import { confirmed } from '../../golden/support/steps/shared';
import { customerTimeline, customerTimelineEntries } from '../../golden/support/steps/customers';

/** Timeline entry labels of the customer history (customer-timeline-section.tsx). */
const TIMELINE_EVENTS = {
  requestReceived: 'Anfrage eingegangen',
  requestUpdated: 'Anfrage aktualisiert',
  jobCreated: 'Auftrag angelegt',
  projectCreated: 'Projekt angelegt',
  followUpChanged: 'Nachfassaktion geändert',
  preferenceChanged: 'Kontaktvorgabe geändert',
} as const;

/** Returns the newest matching row because the timeline is rendered newest-first. */
export function newestCustomerTimelineRow(
  page: Page,
  event: keyof typeof TIMELINE_EVENTS,
  ...textParts: string[]
): Locator {
  let rows = customerTimelineEntries(customerTimeline(page.getByRole('main'))).filter({
    hasText: TIMELINE_EVENTS[event],
  });
  for (const text of textParts) rows = rows.filter({ hasText: text });
  return rows.first();
}

export function customerContactRow(page: Page, contactName: string): Locator {
  return confirmed(page.locator('#ansprechpartner').getByRole('listitem').filter({ hasText: contactName }));
}

export function customerSiteRow(page: Page, siteNameOrAddress: string): Locator {
  return confirmed(page.locator('#einsatzorte').getByRole('listitem').filter({ hasText: siteNameOrAddress }));
}
