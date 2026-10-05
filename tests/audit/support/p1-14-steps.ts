import type { Locator, Page } from '@playwright/test';

import {
  lifecycleReadiness,
  readinessStateBadges,
  type ReadinessState,
} from '../../golden/support/steps/work';

export function representativeReadinessState(page: Page, state: ReadinessState): Locator {
  // Readiness repeats the same state badge across dimensions. This assertion
  // intentionally checks one visible representative, not a positional item.
  return readinessStateBadges(lifecycleReadiness(page), state).first();
}
