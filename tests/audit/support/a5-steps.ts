import type { Locator, Page } from '@playwright/test';

export type SidebarBadgeTarget = '/aufgaben' | '/zeiterfassung';

export function sidebarBadge(page: Page, href: SidebarBadgeTarget): Locator {
  // The visible badge has no accessible name because its text is aria-hidden.
  return page.locator(`aside a[href="${href}"] [data-testid="sidebar-badge"]`);
}

export function taskRows(page: Page): Locator {
  // Task links expose their source identity only through this data attribute.
  return page.locator('[data-task-source]');
}

export function taskRowByText(page: Page, text: string): Locator {
  return taskRows(page).filter({ hasText: text });
}

export function unreadRows(page: Page): Locator {
  // The unread marker is persisted as a data attribute without a semantic role.
  return page.locator('[data-unread="true"]');
}

export function ownRequestRow(page: Page, sourceId: string): Locator {
  // Own-request rows expose the persisted source id only through this marker.
  return page.locator(`[data-own-request-source="${sourceId}"]`);
}

export function notificationRow(page: Page, sourceId: string): Locator {
  // Notification rows expose the persisted source id only through this marker.
  return page.locator(`[data-notification-source="${sourceId}"]`);
}

export function visibleSearchResult(page: Page, personName: string): Locator {
  // Search results may contain a mirrored option during popover transitions.
  // Keep the original positional choice inside support.
  return page.getByRole('listbox').getByRole('button').filter({ hasText: personName }).first();
}

export function qualificationWarningGapRow(dialog: Locator, capabilityName: string): Locator {
  // The warning rows have no role or marker. The deepest matching div is the
  // original stable container for the status paired with this capability.
  return dialog.getByText(capabilityName, { exact: true }).locator('xpath=ancestor::div[1]');
}

export function visibleStrongestQualificationEntry(
  dialog: Locator,
  employeeName: string
): Locator {
  // Several independent gaps may name the same contributor. The contract is
  // that at least one rendered warning identifies the strongest entry.
  return dialog
    .getByText(`stärkster Eintrag: ${employeeName}`)
    .filter({ visible: true })
    .first();
}

export function qualificationCoverageRow(page: Page, capabilityName: string): Locator {
  return page.locator(
    `[data-testid="qualification-coverage-row"][data-capability-name="${capabilityName}"]`
  );
}

export function calendarDayCell(page: Page, dateIso: string): Locator {
  // FullCalendar day cells expose their date only through data-date.
  return page.locator(`.fc-daygrid-day[data-date="${dateIso}"]`);
}

export function ownQualificationCard(page: Page, capabilityName: string): Locator {
  return page.locator(
    `[data-testid="own-qualification-card"][data-capability-name="${capabilityName}"]`
  );
}
