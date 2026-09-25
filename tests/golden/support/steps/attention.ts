import { expect, type Locator, type Page } from "@playwright/test";

// ============================================
// P1-07 — Shared attention pattern (/aufgaben)
// ============================================

export async function openAufgaben(page: Page): Promise<void> {
  await page.goto("/aufgaben");
  await expect(
    page.locator('[data-testid="aufgaben-content"][data-loaded="true"]'),
  ).toBeVisible({
    timeout: 15_000,
  });
}

// Task links carry stable German aria-labels (`Urlaubsantrag von X öffnen`,
// `Zeitfreigabe von X öffnen`, `Anfrage <Nummer> öffnen`). Counting via the
// accessible name doubles as the per-viewer deduplication assertion.
export function attentionTaskLink(page: Page, ariaLabel: string): Locator {
  return page.getByRole("link", { name: ariaLabel, exact: true });
}

export function attentionNotificationRow(
  page: Page,
  sourceId: string,
): Locator {
  return page.locator(`[data-notification-source="${sourceId}"]`);
}

export async function markAttentionNotificationReadViaButton(
  page: Page,
  sourceId: string,
): Promise<void> {
  const row = attentionNotificationRow(page, sourceId);
  const button = row.getByRole("button", {
    name: /^Benachrichtigung vom .* als gelesen markieren$/,
  });
  await button.click();
  await expect(row).toHaveAttribute("data-unread", "false", {
    timeout: 15_000,
  });
  // The optimistic unread flag changes in the first frame. The action button
  // stays mounted while its Server Action is pending, so disappearance is the
  // durable completion boundary rather than the optimistic echo.
  await expect(button).toHaveCount(0, { timeout: 15_000 });
}

export async function markAllAttentionNotificationsReadViaButton(
  page: Page,
): Promise<void> {
  const button = page.getByRole("button", { name: "Alle als gelesen markieren" });
  await button.click();
  await expect(page.locator('[data-unread="true"]')).toHaveCount(0, {
    timeout: 15_000,
  });
  // Keep the bulk control observable until the persisted write and reconcile
  // read settle; otherwise this helper can return on the optimistic echo.
  await expect(button).toHaveCount(0, { timeout: 15_000 });
}

// The sidebar badge on the Aufgaben entry (desktop sidebar only; the mobile
// drawer is unmounted while closed, so this locator never double-matches).
export function aufgabenSidebarBadge(page: Page): Locator {
  return page.locator(
    'aside a[href="/aufgaben"] [data-testid="sidebar-badge"]',
  );
}
