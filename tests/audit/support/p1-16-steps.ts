import type { Locator } from '@playwright/test';

import { readinessStateBadges, type ReadinessState } from '../../golden/support/steps/work';

export function representativeFieldWorkPackState(fieldWorkPack: Locator, state: ReadinessState): Locator {
  // Several readiness dimensions may honestly share one state. This contract
  // proves that the pack visibly renders at least one representative badge.
  return readinessStateBadges(fieldWorkPack, state).filter({ visible: true }).first();
}
