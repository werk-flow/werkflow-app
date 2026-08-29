import type { Locator, Page } from '@playwright/test';

// FullCalendar exposes the date only as a data attribute, so this raw lookup
// stays in audit support and is narrowed by both date and run-scoped title.
export function planningOccurrenceInDateCell(page: Page, dateIso: string, title: string): Locator {
  return page
    .locator(`.fc-daygrid-day[data-date="${dateIso}"]`)
    .locator('.fc-event-job')
    .filter({ hasText: title });
}

// The dispatch panel and unscheduled rows have stable state hooks but no
// semantic landmark or list role in the current markup.
export function dispatchPanel(page: Page): Locator {
  return page.locator('[data-dispatch-panel]');
}

// A travel warning can appear on both affected occurrence rows. This assertion
// needs one visible copy, not a positional business identity.
export function firstDispatchPanelText(page: Page, text: string | RegExp): Locator {
  return dispatchPanel(page).getByText(text).first();
}

export function unscheduledDispatchRow(page: Page, title: string): Locator {
  return page.locator('[data-dispatch-job]').filter({ hasText: title });
}

// Timed calendar blocks expose drag geometry only through FullCalendar's
// positioned element. The run-scoped title makes this target unique.
export function draggablePlanningBlock(page: Page, title: string): Locator {
  return page.locator(`div.absolute[title="${title}"]`);
}
