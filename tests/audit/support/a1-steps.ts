import { expect, type Locator, type Page } from '@playwright/test';

import { retryDialogTransaction } from '../../golden/support/steps';

export async function bookMaterialDialog(
  page: Page,
  openButton: Locator,
  heading: string,
  quantity: string,
  submitLabel: string = heading
): Promise<void> {
  const dialog = page.getByRole('dialog').filter({
    has: page.getByRole('heading', { name: heading }),
  });
  await retryDialogTransaction({
    open: () => openButton.click({ timeout: 15_000 }),
    dialog,
    interact: async () => {
      // These suffix selectors distinguish the generated material controls;
      // every action stays bounded because Realtime can unmount the dialog.
      await dialog.locator('input[id$="-quantity"]').fill(quantity, { timeout: 15_000 });
      await dialog.locator('button[id$="-location"]').click({ timeout: 15_000 });
      const listbox = page.getByRole('listbox');
      await expect(listbox).toBeVisible({ timeout: 15_000 });
      await listbox.locator('..').getByRole('textbox').fill('Hauptlager (Golden)', {
        timeout: 15_000,
      });
      await listbox
        .getByRole('button')
        .filter({ hasText: 'Hauptlager (Golden)' })
        .first()
        .click({ timeout: 15_000 });
      await dialog.getByRole('button', { name: submitLabel }).click({ timeout: 15_000 });
    },
  });
}

export async function toggleInstructionItem(
  page: Page,
  button: Locator,
  isCompleted: boolean
): Promise<void> {
  const mutationFinished = page.waitForResponse((response) => {
    const body = response.request().postData();
    return (
      response.request().method() === 'POST' &&
      body?.includes('"itemId"') === true &&
      body.includes(`"isCompleted":${isCompleted}`)
    );
  });
  await button.click();
  await mutationFinished;
}

export function detailActionsButton(page: Page): Locator {
  // The sticky detail header has no landmark of its own; the H1 anchors the
  // same actions trigger on customer, project, and job detail pages.
  return page
    .getByRole('heading', { level: 1 })
    .locator('xpath=ancestor::div[contains(@class, "sticky")][1]')
    .getByRole('button', { name: 'Aktionen öffnen' });
}

export async function setJobStatus(page: Page, status: string): Promise<void> {
  const card = page.getByRole('main').getByTestId('work-lifecycle-card');
  const transition = async (label: string): Promise<void> => {
    await card.getByRole('button', { name: label, exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Änderung speichern' }).click();
    await expect(dialog).toHaveCount(0, { timeout: 20_000 });
  };
  if (status === 'In Bearbeitung') {
    await transition('In Ausführung');
  } else if (status === 'Fertig') {
    await expect(card).toBeVisible({ timeout: 20_000 });
    const startButton = card.getByRole('button', {
      name: 'In Ausführung',
      exact: true,
    });
    const canStart = await startButton
      .waitFor({ state: 'visible', timeout: 2_000 })
      .then(() => true)
      .catch(() => false);
    if (canStart) await transition('In Ausführung');
    await transition('Ausführung abgeschlossen');
  } else {
    throw new Error(`A1 lifecycle helper does not support status "${status}".`);
  }
  await expect(page.getByRole('heading', { name: 'Details' }).locator('..')).toContainText(status);
}

export async function confirmPlanningWarning(
  page: Page,
  reason: string,
  required = true
): Promise<void> {
  const warning = page.getByRole('dialog').filter({
    has: page.getByRole('heading', { name: 'Planungshinweise prüfen' }),
  });
  if (required) {
    await expect(warning).toBeVisible({ timeout: 30_000 });
  } else if (!(await warning.isVisible({ timeout: 2_000 }).catch(() => false))) {
    return;
  }
  await warning.locator('#planning-warning-reason').fill(reason);
  await warning.getByRole('button', { name: 'Mit Begründung speichern' }).click();
  await expect(warning).toHaveCount(0, { timeout: 20_000 });
}

export async function expectSignedWindowOpen(
  page: Page,
  clickDownload: () => Promise<void>
): Promise<void> {
  await page.evaluate(() => {
    document.documentElement.dataset.signedWindowOpenUrl = '';
    const originalOpen = window.open.bind(window);
    window.open = (...args: Parameters<typeof window.open>) => {
      document.documentElement.dataset.signedWindowOpenUrl = String(args[0] ?? '');
      return originalOpen(...args);
    };
  });
  const popupPromise = page.waitForEvent('popup');
  await clickDownload();
  const popup = await popupPromise;
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.signedWindowOpenUrl ?? ''))
    .toMatch(/^https?:\/\/.+X-Amz-(Algorithm|Signature)=/);
  await popup.close().catch(() => undefined);
}

export async function readOrganizationCode(page: Page): Promise<string> {
  // The generated code is rendered as bare code text without a semantic label.
  return (
    (
      await page
        .locator('code')
        .filter({ hasText: /[A-Z0-9]{6}/ })
        .textContent()
    )?.trim() ?? ''
  );
}

export function upgradeChoiceLink(page: Page): Locator {
  // The full-card onboarding link has no accessible name in the current markup.
  return page.locator('a[href="/upgrade"]');
}

export function visibleMatchingText(page: Page, text: RegExp): Locator {
  // Responsive views can render the same text twice; only one copy is visible.
  return page.getByText(text).filter({ visible: true }).first();
}

export function clockInConfirmationButton(page: Page): Locator {
  return page
    .getByRole('dialog')
    .filter({ has: page.getByRole('heading', { name: 'Zeiterfassung starten' }) })
    .getByRole('button', { name: 'Starten', exact: true });
}

export function firstDailyTimeSummary(page: Page): Locator {
  // The first summary is the explicit subject of the existing seven-day assertion.
  return page.getByRole('img', { name: /Anwesenheit.*Arbeitszeit.*Pause.*Überstunden/ }).first();
}

export function customerCountLabel(page: Page): Locator {
  // The responsive customer views duplicate this count; read the visible copy.
  return page
    .getByText(/^\d+ Kunden?$/)
    .filter({ visible: true })
    .first();
}

export function visibleJobSearch(page: Page): Locator {
  // Desktop and mobile render the same search; interact with the visible copy.
  return page
    .getByPlaceholder('Suche nach Titel, Nummer, Kunde, Ort...')
    .filter({ visible: true })
    .first();
}

export function jobTypeFilter(filterPanel: Locator): Locator {
  // The type control is the final unlabeled "Alle" filter in this panel.
  return filterPanel.getByRole('combobox').filter({ hasText: 'Alle' }).last();
}

export function visibleSortButton(section: Locator, name: string): Locator {
  // Responsive table headers duplicate sort buttons; only one copy is visible.
  return section.getByRole('button', { name, exact: true }).filter({ visible: true }).first();
}

export function calendarDay(page: Page, date: string): Locator {
  // FullCalendar exposes its date only through data-date.
  return page.locator(`.fc-daygrid-day[data-date="${date}"]`);
}

export function calendarJobEvent(page: Page, title: string): Locator {
  // FullCalendar job events expose no stable role.
  return page.locator('.fc-event-job').filter({ hasText: title });
}

export function calendarDayJobEvent(page: Page, date: string, title: string): Locator {
  return calendarDay(page, date).filter({ hasText: title });
}

export function dayViewJobBlock(page: Page, title: string): Locator {
  // Day-view blocks are positioned divs; title is their only semantic identity.
  return page.locator(`div.absolute[title="${title}"]`).first();
}

export function visibleCalendarTimeBlock(page: Page, title: RegExp): Locator {
  // Responsive calendar layers can duplicate blocks; only one is interactive.
  return page.getByTitle(title).filter({ visible: true }).first();
}

export function parkedJobPill(page: Page, title: string): Locator {
  // The drag source has no role; its data attribute is the component contract.
  return page.locator('[data-parkplatz-pill]').filter({ hasText: title });
}

export function calendarTimeline(page: Page): Locator {
  // The day-view drop target is intentionally exposed through this data hook.
  return page.locator('[data-timeline-scroll]');
}

export function clockOutTimeGroup(dialog: Locator): Locator {
  // The time editor exposes two identically named groups in clock-in/out order.
  return dialog.getByRole('group', { name: 'Uhrzeit' }).nth(1);
}

export function documentUploadInput(page: Page): Locator {
  // The document picker is visually triggered and has no accessible label.
  return page.locator('input[type="file"]:not([webkitdirectory])');
}

export function documentFolderUploadInput(page: Page): Locator {
  // Directory selection is identifiable only through webkitdirectory.
  return page.locator('input[webkitdirectory]');
}

export async function closeDocumentUploadProgressDialog(page: Page): Promise<void> {
  // The upload dialog exposes both its footer action and Radix icon close as
  // "Schließen". The footer action is first in the established DOM order.
  await page.getByRole('dialog').getByRole('button', { name: 'Schließen' }).first().click();
}

export function inventoryLocationCard(page: Page, locationName: string): Locator {
  // Inventory location cards have no landmark or test id.
  return page.locator('div.rounded-lg.border').filter({ hasText: locationName });
}

export function projectMaterialTotal(page: Page, itemName: string): Locator {
  // The final matching material card is the project aggregate, after direct
  // material and inherited job sections in stable product order.
  return page
    .locator('div.rounded-md.border')
    .filter({ has: page.getByText(itemName, { exact: true }) })
    .last();
}
