import type { Locator, Page } from '@playwright/test';

// The month grid keys one day's items by data-month-day; the run-scoped title narrows the visit.
export function planningOccurrenceInDateCell(page: Page, dateIso: string, title: string): Locator {
  return page
    .locator(`[data-month-day="${dateIso}"]`)
    .locator('[data-calendar-card]')
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

// The day view renders one card per visit; the run-scoped title makes it unique.
export function draggablePlanningBlock(page: Page, title: string): Locator {
  return page.locator('[data-day-view] [data-calendar-card]').filter({ hasText: title });
}
