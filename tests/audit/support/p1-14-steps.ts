import type { Locator, Page } from '@playwright/test';

export function representativeReadinessState(readinessSection: Locator, state: string): Locator {
  // Readiness repeats the same state badge across dimensions. This assertion
  // intentionally checks one visible representative, not a positional item.
  return readinessSection.getByText(state, { exact: true }).first();
}

export function instructionItemByPrimaryText(page: Page, itemText: string): Locator {
  // Dependency summaries repeat predecessor text inside other instruction
  // rows. Anchor the row from its exact primary label instead of substring
  // matching the entire card.
  return page
    .getByText(itemText, { exact: true })
    .filter({ visible: true })
    .first()
    .locator('xpath=ancestor::*[@data-testid="job-instruction-item"][1]');
}
