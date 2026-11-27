import { expect, test, type Page } from '@playwright/test';
import type { TurnEvent } from '@/components/ki/turn-client';
import { KI_LIVE_PROTOCOL } from '@/lib/ai/live/events';
import type { AiQuestionRow, AiThreadWindow, AiTodoRow, AiToolRow } from '@/lib/ai/thread-types';
import { openContractFixture } from './open-fixture';

// The rows of the agent's work in a WerkFlow KI thread (werk-flow/werkflow-planning#533):
// a tool call shows while it runs, collapsed, and reads its input and result
// only once it is opened (brief non-negotiable 5); a question's answer is the
// person's next message; a to-do list ticks off in place. The fixture is the
// chat's own (tests/ui-contracts/ki-chat-boundaries.tsx).

const THREAD_A = '00000000-0000-4000-8000-0000000000c1';
const TOOL = 'Kunden und Einsatzorte finden';

const timeline = (page: Page) => page.getByRole('list', { name: 'Verlauf' });
const composer = (page: Page) => page.getByRole('textbox', { name: 'Nachricht an WerkFlow KI' });
const detailReads = (page: Page) => page.evaluate(() => window.uiContractKiDetailReads.length);

/** Where in the timeline the first entry with `text` stands. */
async function placeOf(page: Page, text: string): Promise<number> {
  const entries = await timeline(page).getByRole('listitem').allInnerTexts();
  return entries.findIndex((entry) => entry.includes(text));
}

async function emit(page: Page, event: TurnEvent): Promise<void> {
  await expect.poll(() => page.evaluate(() => window.uiContractKiTurn.emit !== null)).toBe(true);
  await page.evaluate((next) => window.uiContractKiTurn.emit?.(next), event);
}

const toolRow = (command: string, revision: 1 | 2, patch: Partial<AiToolRow> = {}): AiToolRow => ({
  key: `${command}:tool:1`,
  sequence: 3,
  role: 'tool',
  status: revision === 1 ? 'streaming' : 'complete',
  revision,
  label: TOOL,
  control: 'read',
  outcome: revision === 1 ? null : 'ok',
  hasDetail: revision === 2,
  ...patch,
});

const question = (command: string): AiQuestionRow => ({
  key: `${command}:tool:1`,
  sequence: 3,
  role: 'question',
  status: 'complete',
  revision: 1,
  question: 'Welchen Kunden meinst du?',
  options: ['Müller Haustechnik', 'Müller Bau'],
});

const todo = (command: string, revision: number, firstDone: boolean): AiTodoRow => ({
  key: `${command}:plan`,
  sequence: 4,
  role: 'todo',
  status: 'complete',
  revision,
  steps: [
    { text: 'Kunden suchen', done: firstDone },
    { text: 'Antwort schreiben', done: false },
  ],
});

/** Sends a message and saves it; returns its command, which every key of the turn starts with. */
async function sendMessage(page: Page, text: string): Promise<string> {
  await openContractFixture(page, 'ki-chat');
  await composer(page).fill(text);
  await composer(page).press('Enter');
  await emit(page, {
    type: 'started',
    userItem: { id: 'u', sequence: 1 },
    assistantItem: { id: 'a', sequence: 2 },
  });
  const [call] = await page.evaluate(() => window.uiContractKiTurn.calls);
  return call?.commandId ?? '';
}

test('a tool row shows while it runs, stays collapsed, and reads its result only once opened', async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.uiContractKiToolDetails = {};
  });
  const command = await sendMessage(page, 'Welche Kunden heißen Müller?');
  await emit(page, { type: 'row', row: toolRow(command, 1) });
  const row = timeline(page).getByRole('listitem').filter({ hasText: TOOL });
  await expect(row).toContainText('läuft …');
  await expect(row).toHaveAttribute('aria-busy', 'true');

  await page.evaluate((key) => {
    window.uiContractKiToolDetails[key] = {
      input: { suche: 'Müller' },
      result: {
        kunden: [
          {
            kundeId: '34000000-0000-4000-8000-000000000001',
            name: { source: 'record_text', text: 'Müller Haustechnik' },
            kundennummer: { source: 'record_text', text: 'K-1001' },
            link: '/kunden/34000000-0000-4000-8000-000000000001',
          },
        ],
        gesamt: 3,
      },
    };
  }, `${command}:tool:1`);
  await emit(page, { type: 'row', row: toolRow(command, 2) });
  await emit(page, { type: 'text', delta: 'Ich habe drei Kunden gefunden.' });
  const opener = row.getByRole('button', { name: TOOL });
  await expect(opener).toHaveAttribute('aria-expanded', 'false');
  await expect(row).not.toContainText('läuft …');
  // The row stands above the answer it led to.
  await expect(timeline(page).getByText('Ich habe drei Kunden gefunden.', { exact: true })).toBeVisible();
  expect(await placeOf(page, TOOL)).toBeLessThan(await placeOf(page, 'Ich habe drei Kunden gefunden.'));
  expect(await detailReads(page), 'a collapsed row reads no result').toBe(0);

  await opener.click();
  await expect(opener).toHaveAttribute('aria-expanded', 'true');
  await expect(row.getByText('suche: Müller', { exact: true })).toBeVisible();
  await expect(row.getByText('Müller Haustechnik · K-1001', { exact: true })).toBeVisible();
  await expect(row.getByRole('link', { name: 'Öffnen' })).toHaveAttribute(
    'href',
    '/kunden/34000000-0000-4000-8000-000000000001',
  );
  await expect(row.getByText('3 Treffer insgesamt', { exact: true })).toBeVisible();
  expect(await detailReads(page)).toBe(1);
  await opener.click();
  await expect(row.getByText('suche: Müller', { exact: true })).toHaveCount(0);
});

test('a refused tool call shows why, and a row whose turn ended unfinished shows it broke off', async ({
  page,
}) => {
  const command = await sendMessage(page, 'Zeig mir die Kunden.');
  await emit(page, {
    type: 'row',
    row: toolRow(command, 2, { outcome: 'refused', status: 'failed', hasDetail: false }),
  });
  await emit(page, {
    type: 'row',
    row: toolRow(command, 1, { key: `${command}:tool:2`, sequence: 4, label: 'Aufträge finden' }),
  });
  const refused = timeline(page).getByRole('listitem').filter({ hasText: TOOL });
  await expect(refused).toContainText('Nicht erlaubt');
  await expect(refused.getByRole('button')).toHaveCount(0);
  const stalled = timeline(page).getByRole('listitem').filter({ hasText: 'Aufträge finden' });
  await expect(stalled).toContainText('läuft …');
  await emit(page, {
    type: 'end',
    status: 'failed',
    message: 'Die Antwort wurde unterbrochen. Versuch es noch einmal.',
  });
  await page.evaluate(() => window.uiContractKiTurn.resolve?.({ kind: 'answered' }));
  await expect(stalled).toContainText('Abgebrochen');
});

test('a question waits for one tap, which sends the answer as the next message and marks it', async ({
  page,
}) => {
  const command = await sendMessage(page, 'Was steht bei Müller an?');
  await emit(page, { type: 'row', row: question(command) });
  const options = timeline(page).getByRole('group', { name: 'Antworten' });
  // While the turn that asked still runs, nothing can be answered yet.
  await expect(options.getByRole('button', { name: 'Müller Bau' })).toBeDisabled();
  await emit(page, { type: 'end', status: 'complete' });
  await page.evaluate(() => window.uiContractKiTurn.resolve?.({ kind: 'answered' }));
  await expect(options.getByRole('button', { name: 'Müller Bau' })).toBeEnabled();

  await options.getByRole('button', { name: 'Müller Bau' }).click();
  // The answer shows as the person's message in the first frame, and the turn is a new command.
  await expect(
    timeline(page)
      .getByRole('listitem')
      .filter({ hasText: /^Müller Bau$/ }),
  ).toBeVisible();
  const calls = await page.evaluate(() => window.uiContractKiTurn.calls);
  expect(calls.map((call) => call.text)).toEqual(['Was steht bei Müller an?', 'Müller Bau']);
  expect(calls[1]?.threadId).toBe(calls[0]?.threadId);
  expect(calls[1]?.commandId).not.toBe(calls[0]?.commandId);
  await emit(page, {
    type: 'started',
    userItem: { id: 'u2', sequence: 4 },
    assistantItem: { id: 'a2', sequence: 5 },
  });
  await expect(options.getByRole('button', { name: 'Müller Bau' })).toHaveAttribute('aria-pressed', 'true');
  await expect(options.getByRole('button', { name: 'Müller Haustechnik' })).toBeDisabled();
});

test('a to-do list ticks off in place, and a saved thread opens with its rows', async ({ page }) => {
  const command = await sendMessage(page, 'Prüf die Kunden.');
  await emit(page, { type: 'row', row: todo(command, 1, false) });
  const plan = timeline(page).getByRole('list', { name: 'Plan' });
  await expect(plan.getByRole('listitem')).toHaveText(['Kunden suchen, offen', 'Antwort schreiben, offen']);
  // A live copy of the list arrives too: the higher revision stays, an older one changes nothing.
  await emit(page, { type: 'row', row: todo(command, 2, true) });
  await expect(plan.getByRole('listitem')).toHaveText([
    'Kunden suchen, erledigt',
    'Antwort schreiben, offen',
  ]);
  await expect.poll(() => page.evaluate(() => window.uiContractKiLive.emit !== null)).toBe(true);
  await page.evaluate((live) => window.uiContractKiLive.emit?.(live), {
    v: KI_LIVE_PROTOCOL,
    type: 'row' as const,
    command,
    row: todo(command, 1, false),
  });
  await expect(plan.getByRole('listitem')).toHaveText([
    'Kunden suchen, erledigt',
    'Antwort schreiben, offen',
  ]);
  await expect(plan).toHaveCount(1);

  const saved: AiThreadWindow = {
    messages: [
      {
        key: 's:user',
        sequence: 1,
        role: 'user',
        status: 'complete',
        text: 'Wer ist Müller?',
        failure: null,
      },
      { ...toolRow('s', 2), sequence: 2 },
      {
        key: 's:assistant',
        sequence: 3,
        role: 'assistant',
        status: 'complete',
        text: 'Zwei Kunden.',
        failure: null,
      },
    ],
    hasOlder: false,
  };
  await page.evaluate(
    ([id, value]) => {
      window.uiContractKiWindows[id] = value;
    },
    [THREAD_A, saved] as const,
  );
  await page
    .getByRole('complementary', { name: 'Chats' })
    .getByRole('link', { name: 'Material für die Heizung' })
    .click();
  await expect(timeline(page).getByRole('button', { name: TOOL })).toHaveAttribute('aria-expanded', 'false');
  expect(await placeOf(page, TOOL)).toBeLessThan(await placeOf(page, 'Zwei Kunden.'));
  expect(await placeOf(page, 'Wer ist Müller?')).toBeLessThan(await placeOf(page, TOOL));
  expect(await detailReads(page), 'a thread opens without its rows’ results').toBe(0);
});
