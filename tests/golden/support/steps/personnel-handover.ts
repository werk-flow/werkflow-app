import type { Locator, Page } from '@playwright/test';
import { personnelLifecycle } from './personnel';

// The handover of a person's open work in the personnel process
// (components/mitarbeiter/personnel-lifecycle-handover.tsx).
const HANDOVER_COPY = {
  trigger: 'Arbeit übergeben',
  dialog: 'Offene Arbeit übergeben',
} as const;

/** The personnel process's action that opens the handover. */
export function handoverTrigger(page: Page): Locator {
  return personnelLifecycle(page).getByRole('button', { name: HANDOVER_COPY.trigger, exact: true });
}

export function handoverDialog(page: Page): Locator {
  return page.getByRole('dialog', { name: HANDOVER_COPY.dialog, exact: true });
}
