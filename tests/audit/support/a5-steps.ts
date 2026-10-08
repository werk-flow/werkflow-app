import type { Locator, Page } from '@playwright/test';
import { confirmed } from '../../golden/support/steps/shared';

const A5_COPY = {
  gapList: 'Offene Qualifikationshinweise',
  noTeamFound: 'Kein Team gefunden',
  decisions: /genehmigen|ablehnen|stornieren/i,
} as const;

export function taskRows(page: Page): Locator {
  // Task links expose their source identity only through this data attribute.
  return confirmed(page.locator('[data-task-source]'));
}

export function taskRowByText(page: Page, text: string): Locator {
  return taskRows(page).filter({ hasText: text });
}

/** Any approve, reject or cancel control on /aufgaben; the page offers none. */
export function aufgabenDecisionButtons(page: Page): Locator {
  return page
    .getByRole('main')
    .getByTestId('aufgaben-content')
    .getByRole('button', { name: A5_COPY.decisions });
}

export function ownRequestRow(page: Page, sourceId: string): Locator {
  // Own-request rows expose the persisted source id only through this marker.
  return confirmed(page.locator(`[data-own-request-source="${sourceId}"]`));
}

export function visibleSearchResult(page: Page, personName: string): Locator {
  // Search results may contain a mirrored option during popover transitions.
  // Keep the original positional choice inside support.
  return page.getByRole('listbox').getByRole('option').filter({ hasText: personName }).first();
}

export function qualificationWarningGapRow(dialog: Locator, capabilityName: string): Locator {
  return confirmed(
    dialog
      .getByRole('list', { name: A5_COPY.gapList })
      .getByRole('listitem', { name: capabilityName, exact: true }),
  );
}

export function visibleStrongestQualificationEntry(dialog: Locator, employeeName: string): Locator {
  // Several independent gaps may name the same contributor. The contract is
  // that at least one rendered warning identifies the strongest entry.
  return confirmed(dialog.getByText(`stärkster Eintrag: ${employeeName}`).filter({ visible: true }).first());
}

export function qualificationCoverageRow(page: Page, capabilityName: string): Locator {
  return confirmed(
    page.locator(`[data-testid="qualification-coverage-row"][data-capability-name="${capabilityName}"]`),
  );
}

export function ownQualificationCard(page: Page, capabilityName: string): Locator {
  return confirmed(
    page.locator(`[data-testid="own-qualification-card"][data-capability-name="${capabilityName}"]`),
  );
}

/** The open picker's listbox. */
export function pickerListbox(page: Page): Locator {
  return page.getByRole('listbox');
}

/** The team picker's empty result. */
export function noTeamFound(page: Page): Locator {
  return pickerListbox(page).getByText(A5_COPY.noTeamFound, { exact: true });
}

/** A team option in the open picker. */
export function teamOption(page: Page, teamName: string): Locator {
  return pickerListbox(page).getByRole('option').filter({ hasText: teamName });
}
