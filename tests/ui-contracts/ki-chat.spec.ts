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
  // Enter while the answer runs starts a new line of the next message; it never stops the answer.
  await composer(page).fill('Und danach?');
  await composer(page).press('Enter');
  await expect(composer(page)).toHaveValue('Und danach?\n');
  await expect(timeline(page).getByText('schreibt …', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Antwort anhalten', exact: true }).click();
  await expect(timeline(page).getByText('Du hast die Antwort angehalten.', { exact: true })).toBeVisible();
  await expect(timeline(page).getByText('Zuerst prüfst du den Druck.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Senden', exact: true })).toBeVisible();
  // The click that stopped the answer never sends the draft typed meanwhile.
  await expect(composer(page)).toHaveValue('Und danach?\n');
  expect(await page.evaluate(() => window.uiContractKiTurn.calls.length)).toBe(1);
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

  // Refused again and edited: other text from the new chat is a new command in a new thread.
  await page.evaluate(() =>
    window.uiContractKiTurn.resolve?.({ kind: 'refused', message: 'Noch einmal abgelehnt.' }),
  );
  await composer(page).fill('Welche Aufträge sind überfällig?');
  await page.getByRole('button', { name: 'Senden', exact: true }).click();
  const edited = await page.evaluate(() => window.uiContractKiTurn.calls[2]);
  expect(edited?.threadId).not.toBe(calls[0]?.threadId);
  expect(edited?.commandId).not.toBe(calls[0]?.commandId);
});

test('a message refused as a command conflict goes again as a new command in its thread', async ({
  page,
}) => {
  await openChat(page);
  await threadLink(page, 'Material für die Heizung').click();
  await composer(page).fill('Wie viel Rohr?');
  await page.getByRole('button', { name: 'Senden', exact: true }).click();
  await page.evaluate(() =>
    window.uiContractKiTurn.resolve?.({ kind: 'refused', message: 'Schick sie noch einmal.', spent: true }),
  );
  await expect(composer(page)).toHaveValue('Wie viel Rohr?');

  // The refused command can never run, so sending the message again unchanged must not repeat it.
  await page.getByRole('button', { name: 'Senden', exact: true }).click();
  const calls = await page.evaluate(() => window.uiContractKiTurn.calls);
  expect(calls[1]?.threadId).toBe(THREAD_A);
  expect(calls[1]?.commandId, 'a spent command must not be sent again').not.toBe(calls[0]?.commandId);
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
    window.uiContractKiReadsFail = 'background_read_failed';
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

test('a thread the person can no longer open leaves the screen with what it showed', async ({ page }) => {
  await openChat(page);
  await threadLink(page, 'Material für die Heizung').click();
  await composer(page).fill('Wie viel Rohr?');
  await composer(page).press('Enter');
  await emit(page, {
    type: 'started',
    userItem: { id: 'u', sequence: 5 },
    assistantItem: { id: 'a', sequence: 6 },
  });
  await emit(page, { type: 'end', status: 'complete' });
  await page.evaluate(() => window.uiContractKiTurn.resolve?.({ kind: 'answered' }));
  await expect(timeline(page).getByText('Wie viel Rohr?', { exact: true })).toBeVisible();
  await threadLink(page, 'Entlüften').click();
  await page.evaluate(() => {
    window.uiContractKiReadsFail = 'not_found';
  });
  // Back to a thread of another organization, or one that is gone: nothing of it stays on screen.
  await page.goBack();
  await expect(timeline(page)).toHaveCount(0);
  await expect(page.getByRole('listitem').filter({ hasText: 'Wie viel Rohr?' })).toHaveCount(0);
  expect(new URL(page.url()).searchParams.get('chat')).toBeNull();
  // Its title, which can quote the first message, leaves the list too.
  await expect(threadLink(page, 'Material für die Heizung')).toHaveCount(0);
});

// A refused new chat reads its thread, which answers that it does not exist yet. A retry of the
// same text reuses that thread, so the answer of the earlier read must not touch the live turn.
for (const order of ['before', 'after'] as const) {
  test(`a denied read that answers ${order} the retried turn starts leaves the live thread alone`, async ({
    page,
  }) => {
    await openChat(page);
    await page.evaluate(() => {
      window.uiContractKiHeldReads = [];
    });
    await composer(page).fill('Wie viele Aufträge sind offen?');
    await page.getByRole('button', { name: 'Senden', exact: true }).click();
    await page.evaluate(() =>
      window.uiContractKiTurn.resolve?.({ kind: 'refused', message: 'Gerade ist viel los.' }),
    );
    await expect.poll(() => page.evaluate(() => window.uiContractKiHeldReads?.length)).toBe(1);
    await page.getByRole('button', { name: 'Senden', exact: true }).click();
    const [first, retry] = await page.evaluate(() => window.uiContractKiTurn.calls);
    expect(retry).toEqual(first);
    const release = () => page.evaluate(() => window.uiContractKiHeldReads?.shift()?.release());
    const started = () =>
      emit(page, {
        type: 'started',
        userItem: { id: 'u', sequence: 1 },
        assistantItem: { id: 'a', sequence: 2 },
      });
    if (order === 'before') {
      await release();
      await started();
    } else {
      await started();
      await release();
    }
    await emit(page, { type: 'text', delta: 'Es sind sieben.' });
    await expect(timeline(page).getByText('Es sind sieben.', { exact: true })).toBeVisible();
    await expect(timeline(page).getByText('Wie viele Aufträge sind offen?', { exact: true })).toBeVisible();
    expect(new URL(page.url()).searchParams.get('chat')).toBe(first?.threadId);
    await expect(threadLink(page, 'Wie viele Aufträge sind offen?')).toHaveAttribute('aria-current', 'page');
  });
}

// The composer clears at Send, so until the message is saved its text lives only in the turn. A page
// that goes before then, by a reload or by leaving the chat, gets it back in its draft.
test('a message whose page went before it was saved comes back into its draft as the same command', async ({
  page,
}) => {
  await openChat(page);
  await composer(page).fill('Wie viele Aufträge sind offen?');
  await page.getByRole('button', { name: 'Senden', exact: true }).click();
  await expect(composer(page)).toHaveValue('');
  const [sent] = await page.evaluate(() => window.uiContractKiTurn.calls);

  await openChat(page);
  await expect(composer(page)).toHaveValue('Wie viele Aufträge sind offen?');
  // Sent again unchanged, it is the same command: the route answers it once, even if it had saved it.
  await page.getByRole('button', { name: 'Senden', exact: true }).click();
  expect(await page.evaluate(() => window.uiContractKiTurn.calls)).toEqual([sent]);

  // Once the message is saved, nothing comes back.
  await emit(page, {
    type: 'started',
    userItem: { id: 'u', sequence: 1 },
    assistantItem: { id: 'a', sequence: 2 },
  });
  await openChat(page);
  await expect(composer(page)).toHaveValue('');
});

test('what is typed while a new chat waits to be saved stays in the composer once it is saved', async ({
  page,
}) => {
  await openChat(page);
  await composer(page).fill('Wie viele Aufträge sind offen?');
  await page.getByRole('button', { name: 'Senden', exact: true }).click();
  await composer(page).fill('Und welche davon sind dringend?');
  await emit(page, {
    type: 'started',
    userItem: { id: 'u', sequence: 1 },
    assistantItem: { id: 'a', sequence: 2 },
  });
  await expect(threadLink(page, 'Wie viele Aufträge sind offen?')).toHaveAttribute('aria-current', 'page');
  await expect(composer(page)).toHaveValue('Und welche davon sind dringend?');
  // The follow-up moved with the thread: the new chat holds nothing of it.
  await page.getByRole('button', { name: 'Neuer Chat', exact: true }).click();
  await expect(composer(page)).toHaveValue('');
});

const savedMessage = (key: string, sequence: number, role: 'user' | 'assistant', text: string) => ({
  key,
  sequence,
  role,
  status: 'complete' as const,
  text,
  failure: null,
});

test('older messages page in before the oldest one shown, after a live turn too', async ({ page }) => {
  await openChat(page);
  const saved = {
    messages: [
      savedMessage('k:user', 10, 'user', 'Wie viel Rohr?'),
      savedMessage('k:assistant', 11, 'assistant', 'Zwei Meter.'),
    ],
    hasOlder: true,
  };
  await page.evaluate(
    ([id, value]) => {
      window.uiContractKiWindows[id] = value;
    },
    [THREAD_A, saved] as const,
  );
  await threadLink(page, 'Material für die Heizung').click();
  await expect(timeline(page).getByText('Zwei Meter.', { exact: true })).toBeVisible();
  await composer(page).fill('Und Fittinge?');
  await page.getByRole('button', { name: 'Senden', exact: true }).click();
  await emit(page, {
    type: 'started',
    userItem: { id: 'u', sequence: 12 },
    assistantItem: { id: 'a', sequence: 13 },
  });
  await emit(page, { type: 'text', delta: 'Vier Stück.' });
  await emit(page, { type: 'end', status: 'complete' });
  await page.evaluate(() => window.uiContractKiTurn.resolve?.({ kind: 'answered' }));
  // The thread is read again and now holds the turn as the server saved it.
  const [turn] = await page.evaluate(() => window.uiContractKiTurn.calls);
  const reread = {
    ...saved,
    messages: [
      ...saved.messages,
      savedMessage(`${turn?.commandId}:user`, 12, 'user', 'Und Fittinge?'),
      savedMessage(`${turn?.commandId}:assistant`, 13, 'assistant', 'Vier Stück.'),
    ],
  };
  await page.evaluate(
    ([id, value]) => {
      window.uiContractKiWindows[id] = value;
    },
    [THREAD_A, reread] as const,
  );
  await threadLink(page, 'Entlüften').click();
  await page.goBack();
  await expect(page.getByRole('button', { name: 'Frühere Nachrichten laden' })).toBeVisible();
  await page.evaluate(() => {
    window.uiContractKiReadInputs = [];
  });
  await page.getByRole('button', { name: 'Frühere Nachrichten laden' }).click();
  await expect
    .poll(() => page.evaluate(() => window.uiContractKiReadInputs))
    .toEqual([expect.objectContaining({ threadId: THREAD_A, beforeSequence: 10 })]);
});

test('a read of the latest messages that answers after a newer one changes nothing', async ({ page }) => {
  await openChat(page);
  const writing = (text: string) => ({
    messages: [
      savedMessage('k:user', 1, 'user', 'Wie viel Rohr?'),
      { ...savedMessage('k:assistant', 2, 'assistant', text), status: 'streaming' as const },
    ],
    hasOlder: false,
  });
  const answerWith = (value: ReturnType<typeof writing>) =>
    page.evaluate(
      ([id, next]) => {
        window.uiContractKiWindows[id] = next;
      },
      [THREAD_A, value] as const,
    );
  await page.evaluate(() => {
    window.uiContractKiHeldReads = [];
  });
  await answerWith(writing('Zwei'));
  await threadLink(page, 'Material für die Heizung').click();
  await threadLink(page, 'Entlüften').click();
  await answerWith(writing('Zwei Meter Rohr.'));
  await page.goBack();
  await expect.poll(() => page.evaluate(() => window.uiContractKiHeldReads?.length)).toBe(3);
  // The newer read of the thread answers first, then the earlier one.
  const release = (index: number) =>
    page.evaluate((at) => window.uiContractKiHeldReads?.[at]?.release(), index);
  await release(2);
  await expect(timeline(page).getByText('Zwei Meter Rohr.', { exact: true })).toBeVisible();
  await release(0);
  // The late answer has reached the page once two frames have passed.
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  );
  await expect(timeline(page).getByText('Zwei', { exact: true })).toHaveCount(0);
  await expect(timeline(page).getByText('Zwei Meter Rohr.', { exact: true })).toBeVisible();
});
