import { expect, type Locator, type Page } from '@playwright/test';
import { confirmed, expectGone } from './shared';

// ============================================
// P1-07 — Shared attention pattern (/aufgaben)
// ============================================

const ATTENTION_COPY = {
  markAllRead: 'Alle als gelesen markieren',
  qualificationNoticeLink: 'Qualifikation ansehen',
  qualificationExpiresSoon: 'läuft bald ab',
} as const;

/** The attention copy that the approval journey asserts inside one task or notification row. */
export const ATTENTION_ROW_COPY = {
  assignedToMe: 'Mir zugewiesen',
  rejected: 'wurde abgelehnt.',
  cancelled: 'wurde storniert.',
} as const;

export async function openAufgaben(page: Page): Promise<void> {
  await page.goto('/aufgaben');
  await expect(page.locator('[data-testid="aufgaben-content"][data-loaded="true"]')).toBeVisible({
    timeout: 15_000,
  });
}

// Task links carry stable German aria-labels that name their source. Counting
// via the accessible name doubles as the per-viewer deduplication assertion.
function attentionTaskLink(scope: Page | Locator, ariaLabel: string): Locator {
  return confirmed(scope.getByRole('link', { name: ariaLabel, exact: true }));
}

/** The task link of an open customer request (P1-02). */
export function requestTaskLink(scope: Page | Locator, requestNumber: string): Locator {
  return attentionTaskLink(scope, `Anfrage ${requestNumber} öffnen`);
}

/** The task link of a person's pending time approval. */
export function timeApprovalTaskLink(scope: Page | Locator, personName: string): Locator {
  return attentionTaskLink(scope, `Zeitfreigabe von ${personName} öffnen`);
}

/** The task link of a person's pending vacation request (P1-06). */
export function vacationRequestTaskLink(scope: Page | Locator, personName: string): Locator {
  return attentionTaskLink(scope, `Urlaubsantrag von ${personName} öffnen`);
}

/** The task link of an owned customer follow-up (P1-10). */
export function followUpTaskLink(page: Page, title: string, customerName: string): Locator {
  return attentionTaskLink(page, `Nachfassaktion ${title} für ${customerName} öffnen`);
}

const WORK_ARTIFACT_TASKS = { review: 'Prüfung', correction: 'Korrektur' } as const;

/** The task link of an Arbeitsnachweis that waits for review or for correction (P1-15); matched by name. */
export function workArtifactTaskLink(
  page: Page,
  task: keyof typeof WORK_ARTIFACT_TASKS,
  title: string,
): Locator {
  return confirmed(page.getByRole('link', { name: `${WORK_ARTIFACT_TASKS[task]} für ${title} öffnen` }));
}

/** The /aufgaben group of dispatch confirmations (P1-12). */
export function dispatchTaskGroup(page: Page): Locator {
  return page.getByRole('main').getByTestId('attention-dispatch-tasks');
}

/** The task link that confirms the dispatch of this job (P1-12). */
export function dispatchTaskLink(scope: Page | Locator, title: string): Locator {
  return attentionTaskLink(scope, `Einsatz für ${title} bestätigen`);
}

/** The task link of an open dispatch challenge (P1-12). */
export function challengeTaskLink(scope: Page | Locator, personName: string, title: string): Locator {
  return attentionTaskLink(scope, `Rückfrage von ${personName} zu ${title} öffnen`);
}

/** The task link of a due Parkplatz review (P1-12). */
export function parkingReviewTaskLink(scope: Page | Locator, title: string): Locator {
  return attentionTaskLink(scope, `Wiedervorlage für ${title} öffnen`);
}

/** The derived age on a task row, worded as the row words it. */
export function taskOpenSince(row: Locator, days: number): Locator {
  return row.getByText(days === 1 ? 'offen seit 1 Tag' : `offen seit ${days} Tagen`);
}

/** The responsible person as a task row names it: „Zuständig: Bea Büro“. */
export function taskResponsibleText(personName: string): string {
  return `Zuständig: ${personName}`;
}

/** The responsible person on a task row. */
export function taskResponsible(row: Locator, personName: string): Locator {
  return row.getByText(taskResponsibleText(personName));
}

export function attentionNotificationRow(page: Page, sourceId: string): Locator {
  return confirmed(page.locator(`[data-notification-source="${sourceId}"]`));
}

/** Every notification row still marked unread. */
export function unreadNotificationRows(page: Page): Locator {
  // The unread marker is persisted as a data attribute without a semantic role.
  return confirmed(page.locator('[data-unread="true"]'));
}

/** The phase text of a qualification expiry notice that has not expired yet. */
export function qualificationExpiresSoon(row: Locator): Locator {
  return row.getByText(ATTENTION_COPY.qualificationExpiresSoon);
}

/** The deep link from a qualification notice into the person's qualifications. */
export function qualificationNoticeLink(row: Locator): Locator {
  return row.getByRole('link', { name: ATTENTION_COPY.qualificationNoticeLink });
}

/** The decision reason on an own request or a decision notification. */
export function decisionReason(row: Locator, reason: string): Locator {
  return row.getByText(`Grund: ${reason}`);
}

/** The button of one notification row that marks it read. */
export function markNotificationReadButton(row: Locator): Locator {
  return row.getByRole('button', {
    name: /^Benachrichtigung vom .* als gelesen markieren$/,
  });
}

export async function markAttentionNotificationReadViaButton(page: Page, sourceId: string): Promise<void> {
  const row = attentionNotificationRow(page, sourceId);
  const button = markNotificationReadButton(row);
  await button.click();
  await expect(row).toHaveAttribute('data-unread', 'false', {
    timeout: 15_000,
  });
  // The optimistic unread flag changes in the first frame. The action button
  // stays mounted while its Server Action is pending, so disappearance is the
  // durable completion boundary rather than the optimistic echo.
  await expect(button).toHaveCount(0, { timeout: 15_000 });
}

export async function markAllAttentionNotificationsReadViaButton(page: Page): Promise<void> {
  const button = page.getByRole('button', { name: ATTENTION_COPY.markAllRead });
  await button.click();
  await expectGone(unreadNotificationRows(page), {
    timeout: 15_000,
  });
  // Keep the bulk control observable until the persisted write and reconcile
  // read settle; otherwise this helper can return on the optimistic echo.
  await expect(button).toHaveCount(0, { timeout: 15_000 });
}

export type SidebarBadgeTarget = '/aufgaben' | '/zeiterfassung';

/**
 * A sidebar entry's count badge (desktop sidebar only; the mobile drawer is
 * unmounted while closed, so this locator never double-matches). The visible
 * badge has no accessible name because its text is aria-hidden.
 */
export function sidebarBadge(page: Page, href: SidebarBadgeTarget): Locator {
  return page.locator(`aside a[href="${href}"] [data-testid="sidebar-badge"]`);
}

export function aufgabenSidebarBadge(page: Page): Locator {
  return sidebarBadge(page, '/aufgaben');
}
