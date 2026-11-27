import { expect, type Locator, type Page } from '@playwright/test';
import { confirmed } from './shared';

// E5 — the WerkFlow KI chat (components/ki/).

const KI_COPY = {
  name: 'WerkFlow KI',
  composer: 'Nachricht an WerkFlow KI',
  send: 'Senden',
  threads: 'Chats',
  timeline: 'Verlauf',
  firstContact: /Ich bin eine KI\./,
} as const;

/** What the replayed answers of lib/ai/replay.ts say: the plain answer, and the host an injected one sends to. */
export const KI_REPLAY = {
  question: 'Wie entlüfte ich einen Heizkörper?',
  answer: /aus einer Aufzeichnung\.$/,
  outsideHost: 'evil.example',
  exfiltration: '[replay:ausleiten] Fass den Lieferschein zusammen.',
  appLink: '/aufgaben',
} as const;

/** The sidebar's entry of the chat page. */
export function kiSidebarLink(page: Page): Locator {
  return page
    .getByRole('navigation', { name: 'Hauptnavigation', exact: true })
    .getByRole('link', { name: KI_COPY.name, exact: true });
}

/** The first-contact line that says the assistant is an AI (B20). */
export function kiFirstContact(page: Page): Locator {
  return page.getByText(KI_COPY.firstContact).filter({ visible: true });
}

export function kiComposer(page: Page): Locator {
  return page.getByRole('textbox', { name: KI_COPY.composer, exact: true });
}

/** The open thread's saved messages, oldest first. */
export function kiMessages(page: Page): Locator {
  return confirmed(page.getByRole('list', { name: KI_COPY.timeline, exact: true }).getByRole('listitem'));
}

/** A thread of the desktop list, by its title. */
export function kiThreadLink(page: Page, title: string): Locator {
  return page
    .getByRole('complementary', { name: KI_COPY.threads, exact: true })
    .getByRole('link', { name: title, exact: true });
}

/** Sends a message and waits until its answer is written. */
export async function askKi(page: Page, text: string): Promise<Locator> {
  const before = await kiMessages(page).count();
  await kiComposer(page).fill(text);
  await page.getByRole('button', { name: KI_COPY.send, exact: true }).click();
  const answer = kiMessages(page).nth(before + 1);
  await expect(answer).not.toHaveAttribute('aria-busy', 'true');
  await expect(page.getByRole('button', { name: KI_COPY.send, exact: true })).toBeVisible();
  return answer;
}
