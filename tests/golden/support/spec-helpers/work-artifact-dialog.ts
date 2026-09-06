import type { Locator, Page } from '@playwright/test';

export function workArtifactsSection(page: Page): Locator {
  // PPR can stage duplicate sections in hidden streaming containers outside
  // main. Positive interactions belong to the active semantic page content.
  return page.getByRole('main').getByTestId('work-artifacts-section');
}

export async function closeWorkArtifactDialog(dialog: Locator): Promise<void> {
  // WorkArtifactDialog renders its visible footer action before Radix's icon
  // close, and both controls have the accessible name "Schließen".
  await dialog
    .getByRole('button', { name: 'Schließen', exact: true })
    .first()
    .click();
}

export async function readPopupBodyText(page: Page): Promise<string> {
  // The generated handover preview has no semantic content container. Its
  // complete body text is the product output this privacy assertion audits.
  return page.locator('body').innerText();
}
