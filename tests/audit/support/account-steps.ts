import type { Locator, Page } from '@playwright/test';
import { visibleText } from '../../golden/support/steps/shared';

/** The email change wizard on /einstellungen/konto-sicherheit (components/settings/email-change-*.tsx). */
const EMAIL_CHANGE = {
  start: 'E-Mail-Adresse ändern',
  code: 'Bestätigungscode',
  confirmCurrentCode: 'Code bestätigen',
  newAddress: 'Neue E-Mail-Adresse',
  continueToConfirmation: 'Weiter zur Bestätigung',
  confirmNewAddress: 'Neue E-Mail-Adresse bestätigen',
  updated: 'E-Mail-Adresse erfolgreich aktualisiert',
} as const;

type EmailChangeButton = 'start' | 'confirmCurrentCode' | 'continueToConfirmation' | 'confirmNewAddress';

export function emailChangeButton(page: Page, button: EmailChangeButton): Locator {
  return page.getByRole('button', { name: EMAIL_CHANGE[button], exact: true });
}

/** The one-time code field; each wizard step shows exactly one. */
export function emailChangeCodeInput(page: Page): Locator {
  return page.getByRole('textbox', { name: EMAIL_CHANGE.code, exact: true });
}

export function emailChangeNewAddressInput(page: Page): Locator {
  return page.getByRole('textbox', { name: EMAIL_CHANGE.newAddress, exact: true });
}

export function emailChangeSucceeded(page: Page): Locator {
  return visibleText(page, EMAIL_CHANGE.updated, true);
}
