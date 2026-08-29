import type { Locator } from '@playwright/test';

export function representativeFieldWorkPackState(
  fieldWorkPack: Locator,
  state: string
): Locator {
  // Several readiness dimensions may honestly share one state. This contract
  // proves that the pack visibly renders at least one representative badge.
  return fieldWorkPack.getByText(state, { exact: true }).filter({ visible: true }).first();
}
