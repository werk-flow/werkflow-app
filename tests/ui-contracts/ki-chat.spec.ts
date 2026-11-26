import { expect, test, type Page } from '@playwright/test';
import type { TurnEvent } from '@/components/ki/turn-client';
import { openContractFixture } from './open-fixture';

// The WerkFlow KI chat (werk-flow/werkflow-planning#530, brief non-negotiables
// 3, 8 and 10): the message shows in the first frame, only the block still being
// written renders while the answer streams, and the composer keeps each
// thread's draft through a switch and a reload.

const THREAD_A = '00000000-0000-4000-8000-0000000000c1';
const THREAD_B = '00000000-0000-4000-8000-0000000000c2';

declare global {
  interface Window {
    /** The source of every answer block that rendered, in commit order. */
    uiContractKiBlockRenders: string[];
  }
}

/**
 * Records each answer block that renders, through the hook React reports its
 * commits to (the one React DevTools uses). A function component that ran in
 * a commit carries the PerformedWork flag; one that kept its last render was
 * either cloned without it or not visited at all.
 */
function recordBlockRenders(): void {
  window.uiContractKiBlockRenders = [];
  let previous = new WeakSet<object>();
  type Fiber = {
    type?: { name?: string };
    flags: number;
    child: Fiber | null;
    sibling: Fiber | null;
    memoizedProps?: { source?: string };
  };
  Object.assign(window, {
    __REACT_DEVTOOLS_GLOBAL_HOOK__: {
      supportsFiber: true,
      renderers: new Map(),
      inject: () => 1,
      checkDCE: () => undefined,
      onScheduleFiberRoot: () => undefined,
      onCommitFiberUnmount: () => undefined,
      onPostCommitFiberRoot: () => undefined,
      onCommitFiberRoot: (_renderer: number, root: { current: Fiber }) => {
        const visited = new WeakSet<object>();
        const stack: Fiber[] = [root.current];
        for (let fiber = stack.pop(); fiber; fiber = stack.pop()) {
          visited.add(fiber);
          if (fiber.type?.name === 'AnswerBlock' && !previous.has(fiber) && (fiber.flags & 1) === 1)
            window.uiContractKiBlockRenders.push(fiber.memoizedProps?.source ?? '');
          if (fiber.sibling) stack.push(fiber.sibling);
          if (fiber.child) stack.push(fiber.child);
        }
        previous = visited;
      },
    },
  });
}

async function openChat(page: Page): Promise<void> {
  await openContractFixture(page, 'ki-chat');
}

const composer = (page: Page) => page.getByRole('textbox', { name: 'Nachricht an WerkFlow KI' });
const threadLink = (page: Page, name: string) =>
  page.getByRole('complementary', { name: 'Chats' }).getByRole('link', { name, exact: true });
const timeline = (page: Page) => page.getByRole('list', { name: 'Verlauf' });

async function emit(page: Page, event: TurnEvent): Promise<void> {
  await expect.poll(() => page.evaluate(() => window.uiContractKiTurn.emit !== null)).toBe(true);
  await page.evaluate((next) => window.uiContractKiTurn.emit?.(next), event);
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(recordBlockRenders);
});

test('the message shows at once, unconfirmed until saved, and only the block being written renders', async ({
  page,
}) => {
  await openChat(page);
  await composer(page).fill('Welches Material brauche ich?');
  await page.getByRole('button', { name: 'Senden', exact: true }).click();
  const message = timeline(page).getByRole('listitem').filter({ hasText: 'Welches Material brauche ich?' });
  await expect(message).toBeVisible();
  await expect(message).toHaveAttribute('data-unconfirmed', '');
  await expect(composer(page)).toHaveValue('');

  const [call] = await page.evaluate(() => window.uiContractKiTurn.calls);
  await emit(page, {
    type: 'started',
    userItem: { id: 'item-1', sequence: 1 },
    assistantItem: { id: 'item-2', sequence: 2 },
  });
  await expect(message).not.toHaveAttribute('data-unconfirmed');
  expect(new URL(page.url()).searchParams.get('chat')).toBe(call?.threadId);
  await expect(threadLink(page, 'Welches Material brauche ich?')).toHaveAttribute('aria-current', 'page');

  await emit(page, { type: 'text', delta: 'Du brauchst zwei Kugelhähne.\n\n' });
  await expect(timeline(page).getByText('Du brauchst zwei Kugelhähne.', { exact: true })).toBeVisible();
  await emit(page, { type: 'text', delta: 'Dazu eine ' });
  await expect(timeline(page).getByText('Dazu eine', { exact: true })).toBeVisible();
  await page.evaluate(() => {
    window.uiContractKiBlockRenders = [];
  });
  await emit(page, { type: 'text', delta: 'Pumpe.' });
  await expect(timeline(page).getByText('Dazu eine Pumpe.', { exact: true })).toBeVisible();
  // The finished first block kept its render; only the block still being written rendered.
  expect(await page.evaluate(() => window.uiContractKiBlockRenders)).toEqual(['Dazu eine Pumpe.']);

  await emit(page, { type: 'end', status: 'complete' });
  await page.evaluate(() => window.uiContractKiTurn.resolve?.({ kind: 'answered' }));
  await expect(page.getByRole('status')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Senden', exact: true })).toBeVisible();
});

test('the stop button ends the answer on screen and keeps what was written', async ({ page }) => {
  await openChat(page);
  await composer(page).fill('Erklär mir die Wartung.');
  await composer(page).press('Enter');
  await emit(page, {
    type: 'started',
    userItem: { id: 'u', sequence: 1 },
    assistantItem: { id: 'a', sequence: 2 },
  });
  await emit(page, { type: 'text', delta: 'Zuerst prüfst du den Druck.' });
  await page.getByRole('button', { name: 'Antwort anhalten', exact: true }).click();
  await expect(timeline(page).getByText('Du hast die Antwort angehalten.', { exact: true })).toBeVisible();
  await expect(timeline(page).getByText('Zuerst prüfst du den Druck.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Senden', exact: true })).toBeVisible();
});

test('a message refused before its thread exists goes back into the composer with the reason', async ({
  page,
}) => {
  await openChat(page);
  await composer(page).fill('Wie viele Aufträge sind offen?');
  await page.getByRole('button', { name: 'Senden', exact: true }).click();
  await page.evaluate(() =>
    window.uiContractKiTurn.resolve?.({
      kind: 'refused',
      message: 'Das Monatsbudget für WerkFlow KI ist aufgebraucht.',
    }),
  );
  await expect(
    page.getByRole('alert').filter({ hasText: 'Das Monatsbudget für WerkFlow KI ist aufgebraucht.' }),
  ).toBeVisible();
  await expect(composer(page)).toHaveValue('Wie viele Aufträge sind offen?');
  await expect(timeline(page)).toHaveCount(0);
  expect(new URL(page.url()).searchParams.get('chat')).toBeNull();

  // Sent again unchanged, it is the same command in the same new thread.
  await page.getByRole('button', { name: 'Senden', exact: true }).click();
  const calls = await page.evaluate(() => window.uiContractKiTurn.calls);
  expect(calls[1]).toEqual(calls[0]);
});

test('an empty message marks the composer and focuses it', async ({ page }) => {
  await openChat(page);
  await page.getByRole('button', { name: 'Senden', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Schreib zuerst eine Nachricht.' })).toBeVisible();
  await expect(composer(page)).toBeFocused();
  expect(await page.evaluate(() => window.uiContractKiTurn.calls)).toEqual([]);
});

test('the composer stays and keeps each thread its draft through a switch and a reload', async ({ page }) => {
  await openChat(page);
  await threadLink(page, 'Material für die Heizung').click();
  expect(new URL(page.url()).searchParams.get('chat')).toBe(THREAD_A);
  await composer(page).fill('Entwurf für die Heizung');
  await composer(page).evaluate((element) => element.setAttribute('data-contract-mark', ''));
  await threadLink(page, 'Entlüften').click();
  expect(new URL(page.url()).searchParams.get('chat')).toBe(THREAD_B);
  await expect(composer(page)).toHaveValue('');
  await composer(page).fill('Entwurf zum Entlüften');
  await page.goBack();
  expect(new URL(page.url()).searchParams.get('chat')).toBe(THREAD_A);
  await expect(composer(page)).toHaveValue('Entwurf für die Heizung');
  // The same element all along: the composer never mounted again.
  await expect(composer(page)).toHaveAttribute('data-contract-mark', '');

  await openChat(page);
  await threadLink(page, 'Entlüften').click();
  await expect(composer(page)).toHaveValue('Entwurf zum Entlüften');
});

test('a thread that cannot load shows its retry, and the retry opens it', async ({ page }) => {
  await openChat(page);
  await page.evaluate(() => {
    window.uiContractKiReadsFail = true;
  });
  await threadLink(page, 'Entlüften').click();
  const failure = page.getByRole('alert').filter({ hasText: 'Der Chat konnte nicht geladen werden' });
  await expect(failure).toBeVisible();
  await expect(timeline(page)).toHaveCount(0);
  await page.evaluate(() => {
    window.uiContractKiReadsFail = false;
  });
  await failure.getByRole('button', { name: 'Erneut laden' }).click();
  await expect(failure).toHaveCount(0);
  await expect(composer(page)).toBeVisible();
});

test('a refusal keeps what was typed meanwhile, and its reason stays with its own draft', async ({
  page,
}) => {
  await openChat(page);
  await composer(page).fill('Wie viele Aufträge sind offen?');
  await page.getByRole('button', { name: 'Senden', exact: true }).click();
  await composer(page).fill('Und welche davon sind dringend?');
  await page.evaluate(() =>
    window.uiContractKiTurn.resolve?.({
      kind: 'refused',
      message: 'Das Monatsbudget für WerkFlow KI ist aufgebraucht.',
    }),
  );
  await expect(composer(page)).toHaveValue(
    'Wie viele Aufträge sind offen?\n\nUnd welche davon sind dringend?',
  );
  const reason = page
    .getByRole('alert')
    .filter({ hasText: 'Das Monatsbudget für WerkFlow KI ist aufgebraucht.' });
  await expect(reason).toBeVisible();
  await threadLink(page, 'Entlüften').click();
  await expect(reason).toHaveCount(0);
  await page.goBack();
  await expect(reason).toBeVisible();
});
