import type { Locator, Page } from '@playwright/test';

// The billing page's controls (werk-flow/werkflow-planning#252), by their German names.

export const BILLING_COPY = {
  cancel: 'Abo kündigen',
  cancelConfirmation: 'Abo kündigen?',
} as const;

/** The control that opens the cancel confirmation. */
export function cancelSubscriptionButton(page: Page): Locator {
  return page.getByRole('button', { name: BILLING_COPY.cancel, exact: true });
}

export function cancelSubscriptionConfirmation(page: Page): Locator {
  return page.getByRole('alertdialog', { name: BILLING_COPY.cancelConfirmation, exact: true });
}
