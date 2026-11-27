import { expect, test } from './support/fixtures';
import { kiOrganizationFor } from './support/db/ki';
import { openPage, openRolePage } from './support/streamed-content';
import {
  KI_REPLAY,
  askKi,
  kiComposer,
  kiFirstContact,
  kiLastMessage,
  kiMessages,
  kiSidebarLink,
  kiThreadLink,
  sendKi,
} from './support/steps/ki';

// E5 — WerkFlow KI (@E5): the chat page of werk-flow/werkflow-planning#530 in
// the checkout's released KI organization. The local test server has no model
// key, so every answer replays a recorded synthetic stream (lib/ai/replay.ts).
// lib/ui/ai-markdown.test.tsx owns the renderer corpus,
// lib/ui/ai-thread-reads.test.ts the reads' boundaries,
// tests/ui-contracts/ki-chat.spec.ts the frozen blocks and the composer, and
// lib/ai/live/ the live channel's follow logic and transfer budget.

test.describe('E5 WerkFlow KI @E5', () => {
  test('Admin fragt im neuen Chat, sieht die Antwort entstehen und findet den Chat nach dem Neuladen wieder', async ({
    browser,
    world,
  }) => {
    const ki = await kiOrganizationFor(world);
    const { context, page } = await openRolePage({
      browser,
      world,
      role: 'admin',
      account: { user: ki.users.admin, organizationId: ki.organizationId },
    });
    try {
      await test.step('Die Seitenleiste führt zum Chat, der sagt, dass er eine KI ist', async () => {
        await page.goto('/dashboard');
        await kiSidebarLink(page).click();
        await expect(kiFirstContact(page)).toBeVisible();
      });

      const question = KI_REPLAY.question;
      await test.step('Die Frage legt einen Chat an, und die Antwort erscheint darunter', async () => {
        const answer = await askKi(page, question);
        await expect(answer).toHaveText(KI_REPLAY.answer);
        await expect(kiThreadLink(page, question)).toHaveAttribute('aria-current', 'page');
        expect(new URL(page.url()).searchParams.get('chat')).toMatch(/^[0-9a-f-]{36}$/);
      });

      await test.step('Nach dem Neuladen steht der Chat mit Frage und Antwort da, der Entwurf auch', async () => {
        await kiComposer(page).fill('Und wie oft im Jahr?');
        await page.reload();
        await expect(kiMessages(page)).toHaveText([question, KI_REPLAY.answer]);
        await expect(kiComposer(page)).toHaveValue('Und wie oft im Jahr?');
      });

      await test.step('Eine Antwort, die Daten nach außen schicken will, lädt nichts und verlinkt nur in die App (B21)', async () => {
        const outside: string[] = [];
        page.on('request', (request) => {
          if (new URL(request.url()).hostname.endsWith(KI_REPLAY.outsideHost)) outside.push(request.url());
        });
        const answer = await askKi(page, KI_REPLAY.exfiltration);
        await expect(answer).toContainText(KI_REPLAY.outsideHost);
        await expect(answer.locator('img')).toHaveCount(0);
        await expect(answer.getByRole('link')).toHaveCount(1);
        await expect(answer.getByRole('link')).toHaveAttribute('href', KI_REPLAY.appLink);
        expect(outside).toEqual([]);
      });
    } finally {
      await context.close();
    }
  });

  test('Ein zweites Fenster sieht die Antwort entstehen, und ein Neuladen mitten in der Antwort setzt sie fort', async ({
    browser,
    world,
  }) => {
    const ki = await kiOrganizationFor(world);
    const { context, page } = await openRolePage({
      browser,
      world,
      role: 'admin',
      account: { user: ki.users.admin, organizationId: ki.organizationId },
    });
    try {
      await page.goto('/ki');
      await askKi(page, KI_REPLAY.question);
      const second = await openPage(context);
      await second.goto(page.url());
      await expect(kiMessages(second)).toHaveCount(2);

      await test.step('Das zweite Fenster folgt der Antwort, die das erste angestoßen hat', async () => {
        await sendKi(page, KI_REPLAY.slow);
        await expect(kiLastMessage(second)).toContainText(KI_REPLAY.slowStep(2));
        await expect(kiLastMessage(second)).toHaveAttribute('aria-busy', 'true');
      });

      await test.step('Nach dem Neuladen mitten in der Antwort schreibt sie weiter, bis sie fertig ist', async () => {
        await page.reload();
        await expect(kiLastMessage(page)).toHaveAttribute('aria-busy', 'true');
        await expect(kiLastMessage(page)).toContainText(KI_REPLAY.slowStep(1));
        for (const shown of [page, second]) {
          await expect(kiLastMessage(shown)).toContainText(KI_REPLAY.slowStep(KI_REPLAY.slowSteps));
          await expect(kiLastMessage(shown)).not.toHaveAttribute('aria-busy', 'true');
        }
      });
    } finally {
      await context.close();
    }
  });

  test('Büro und Mitarbeiter finden den Chat in der Seitenleiste ihres Betriebs', async ({
    browser,
    world,
  }) => {
    const ki = await kiOrganizationFor(world);
    for (const role of ['buero', 'employee'] as const) {
      const { context, page } = await openRolePage({
        browser,
        world,
        role,
        account: { user: ki.users[role], organizationId: ki.organizationId },
      });
      try {
        await page.goto('/dashboard');
        await kiSidebarLink(page).click();
        await expect(kiFirstContact(page)).toBeVisible();
      } finally {
        await context.close();
      }
    }
  });
});
