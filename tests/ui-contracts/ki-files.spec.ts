import { expect, test, type Page } from '@playwright/test';
import type { TurnEvent } from '@/components/ki/turn-client';
import type { AiThreadWindow } from '@/lib/ai/thread-types';
import { openContractFixture } from './open-fixture';

// Files in a WerkFlow KI thread (werk-flow/werkflow-planning#534): a chosen
// file shows in its first frame and uploads at once, a refused one says why in
// German, the message takes its files, and a file in the thread is a card whose
// name is plain text and whose bytes load only through a signed address (B11).

const THREAD_A = '00000000-0000-4000-8000-0000000000c1';
const FILE_ID = '00000000-0000-4000-8000-0000000000f1';

const composer = (page: Page) => page.getByRole('textbox', { name: 'Nachricht an WerkFlow KI' });
const attached = (page: Page) => page.getByRole('list', { name: 'Angehängte Dateien' });
const timeline = (page: Page) => page.getByRole('list', { name: 'Verlauf' });

async function choose(
  page: Page,
  files: { name: string; mimeType: string; buffer: Buffer }[],
): Promise<void> {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Datei anhängen' }).click();
  await (await chooser).setFiles(files);
}

const pdf = (name: string) => ({ name, mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7') });

/** Answers the oldest held upload as registered. */
async function finishUpload(page: Page, fileId: string, pages: number): Promise<void> {
  await expect.poll(() => page.evaluate(() => window.uiContractKiUploads.length)).toBeGreaterThan(0);
  await page.evaluate(
    ({ id, count }) => {
      const held = window.uiContractKiUploads.shift();
      held?.answer({
        success: true,
        file: { fileId: id, name: held.name, mimeType: 'application/pdf', sizeBytes: 2048, pages: count },
      });
    },
    { id: fileId, count: pages },
  );
}

async function emit(page: Page, event: TurnEvent): Promise<void> {
  await expect.poll(() => page.evaluate(() => window.uiContractKiTurn.emit !== null)).toBe(true);
  await page.evaluate((next) => window.uiContractKiTurn.emit?.(next), event);
}

test('a chosen file shows at once, a refused one says why, and the message takes its files', async ({
  page,
}) => {
  await openContractFixture(page, 'ki-chat');
  await page.getByRole('complementary', { name: 'Chats' }).getByRole('link', { name: 'Entlüften' }).click();

  await choose(page, [
    pdf('Lieferschein 4711.pdf'),
    { name: 'notiz.txt', mimeType: 'text/plain', buffer: Buffer.from('x') },
  ]);
  const uploading = attached(page).getByRole('listitem').filter({ hasText: 'Lieferschein 4711.pdf' });
  await expect(uploading.getByRole('status')).toHaveText('wird hochgeladen …');
  await expect(
    page.getByRole('main').getByText('„notiz.txt“: Nur PDF, JPG, PNG und WebP gehen.'),
  ).toBeVisible();
  expect(await page.evaluate(() => window.uiContractKiUploads.map((upload) => upload.name))).toEqual([
    'Lieferschein 4711.pdf',
  ]);

  // Sending while a file is on its way sends nothing and says to wait.
  await composer(page).fill('Lies bitte den Lieferschein.');
  await page.getByRole('button', { name: 'Senden', exact: true }).click();
  await expect(
    page.getByRole('main').getByText('Warte, bis alle Dateien hochgeladen sind', { exact: false }),
  ).toBeVisible();
  expect(await page.evaluate(() => window.uiContractKiTurn.calls)).toEqual([]);

  await finishUpload(page, FILE_ID, 3);
  await expect(attached(page).getByText('PDF · 2,0 KB · 3 Seiten')).toBeVisible();
  await page.getByRole('button', { name: 'Senden', exact: true }).click();

  // The file and the message show at once, unconfirmed; the composer is empty again.
  const [call] = await page.evaluate(() => window.uiContractKiTurn.calls);
  expect(call?.fileIds).toEqual([FILE_ID]);
  await expect(attached(page)).toHaveCount(0);
  const card = timeline(page).getByRole('listitem').filter({ hasText: 'Lieferschein 4711.pdf' });
  await expect(card).toHaveAttribute('data-unconfirmed', '');
  await expect(card.getByRole('button', { name: 'Lieferschein 4711.pdf öffnen' })).toHaveCount(0);

  await emit(page, {
    type: 'started',
    userItem: { id: 'u', sequence: 4 },
    assistantItem: { id: 'a', sequence: 5 },
    files: [{ fileId: FILE_ID, sequence: 3 }],
  });
  await expect(card).not.toHaveAttribute('data-unconfirmed');
  await expect(card.getByRole('button', { name: 'Lieferschein 4711.pdf öffnen' })).toBeVisible();

  // A refused message takes its files back into the draft.
  await page.evaluate(() => window.uiContractKiTurn.resolve?.({ kind: 'answered' }));
  await choose(page, [pdf('Rechnung.pdf')]);
  await finishUpload(page, '00000000-0000-4000-8000-0000000000f2', 1);
  await composer(page).fill('Und diese?');
  await page.getByRole('button', { name: 'Senden', exact: true }).click();
  await page.evaluate(() => window.uiContractKiTurn.resolve?.({ kind: 'refused', message: 'Gerade nicht.' }));
  await expect(attached(page).getByText('Rechnung.pdf')).toBeVisible();
  await expect(composer(page)).toHaveValue('Und diese?');

  // A removal the server refused brings the file back with its reason; removing it again retries.
  await page.evaluate(() => {
    window.uiContractKiDiscardFails = true;
  });
  await attached(page).getByRole('button', { name: 'Rechnung.pdf entfernen' }).click();
  await expect(
    page.getByRole('main').getByText('„Rechnung.pdf“ konnte nicht entfernt werden. Versuch es noch einmal.'),
  ).toBeVisible();
  await expect(attached(page).getByText('Rechnung.pdf')).toBeVisible();

  // Removing a file takes it out at once and tells the server.
  await attached(page).getByRole('button', { name: 'Rechnung.pdf entfernen' }).click();
  await expect(attached(page)).toHaveCount(0);
  expect(await page.evaluate(() => window.uiContractKiDiscards)).toEqual([
    '00000000-0000-4000-8000-0000000000f2',
    '00000000-0000-4000-8000-0000000000f2',
  ]);
});

test('a file in the thread is a card: its name stays text, a made file is a KI-Entwurf, and it opens through a signed address', async ({
  page,
}) => {
  // B21: a name that carries Markdown and HTML, as a poisoned file would, renders as the text it is.
  const name = '![x](https://evil.example/x.png) <img src=x onerror=alert(1)> [Klick](https://evil.example)';
  const thread: AiThreadWindow = {
    hasOlder: false,
    messages: [
      {
        key: 'made',
        sequence: 1,
        role: 'file',
        status: 'complete',
        text: '',
        failure: null,
        file: {
          fileId: FILE_ID,
          name,
          mimeType: 'application/pdf',
          sizeBytes: 1024,
          pages: 1,
          origin: 'agent',
        },
      },
    ],
  };
  await openContractFixture(page, 'ki-chat');
  await page.evaluate(
    ({ thread: id, read }) => {
      window.uiContractKiWindows[id] = read;
    },
    { thread: THREAD_A, read: thread },
  );
  await page
    .getByRole('complementary', { name: 'Chats' })
    .getByRole('link', { name: 'Material für die Heizung' })
    .click();
  const card = timeline(page).getByRole('listitem');
  await expect(card.getByText(name, { exact: true })).toBeVisible();
  await expect(card.getByText('KI-Entwurf')).toBeVisible();
  await expect(timeline(page).getByRole('img')).toHaveCount(0);
  await expect(timeline(page).getByRole('link')).toHaveCount(0);

  // The signed address answers in the new tab, as object storage would.
  await page
    .context()
    .route('http://localhost/ki-datei/**', (route) =>
      route.fulfill({ contentType: 'text/html', body: '<p>Datei</p>' }),
    );
  const popup = page.waitForEvent('popup');
  await card.getByRole('button', { name: `${name} öffnen` }).click();
  await expect.poll(async () => new URL((await popup).url()).pathname).toBe(`/ki-datei/${FILE_ID}`);
});

test('the files of a message whose page went before it was saved come back, and an upload after sign-out stays out', async ({
  page,
}) => {
  await openContractFixture(page, 'ki-chat');
  await choose(page, [pdf('Lieferschein 4711.pdf')]);
  await finishUpload(page, FILE_ID, 2);
  await composer(page).fill('Lies bitte den Lieferschein.');
  await page.getByRole('button', { name: 'Senden', exact: true }).click();
  await expect(attached(page)).toHaveCount(0);

  // The page goes before the message is saved: text and file come back together, as the same command.
  await openContractFixture(page, 'ki-chat');
  await expect(composer(page)).toHaveValue('Lies bitte den Lieferschein.');
  await expect(attached(page).getByText('Lieferschein 4711.pdf')).toBeVisible();

  // An upload that lands after a sign-out cleared the drafts writes no file name back into the tab.
  await choose(page, [pdf('Rechnung.pdf')]);
  await page.evaluate(() => window.uiContractKiClearDrafts());
  await finishUpload(page, '00000000-0000-4000-8000-0000000000f3', 1);
  await expect(attached(page).getByRole('status')).toHaveCount(0);
  await expect(attached(page)).toHaveCount(0);
  expect(await page.evaluate(() => JSON.stringify(sessionStorage))).not.toContain('Rechnung.pdf');
});

test('a refused message keeps its command and its files with its draft through a reload, so an unchanged resend is the same command', async ({
  page,
}) => {
  await openContractFixture(page, 'ki-chat');
  await choose(page, [pdf('Lieferschein 4711.pdf')]);
  await finishUpload(page, FILE_ID, 2);
  await composer(page).fill('Lies bitte den Lieferschein.');
  await page.getByRole('button', { name: 'Senden', exact: true }).click();
  const [sent] = await page.evaluate(() => window.uiContractKiTurn.calls);
  expect(sent?.fileIds).toEqual([FILE_ID]);
  await page.evaluate(() => window.uiContractKiTurn.resolve?.({ kind: 'refused', message: 'Gerade nicht.' }));
  await expect(attached(page).getByText('Lieferschein 4711.pdf')).toBeVisible();

  // After a reload the draft holds both: start_ai_turn_with_files refuses a command whose files changed.
  await openContractFixture(page, 'ki-chat');
  await expect(composer(page)).toHaveValue('Lies bitte den Lieferschein.');
  await expect(attached(page).getByText('Lieferschein 4711.pdf')).toBeVisible();
  await page.getByRole('button', { name: 'Senden', exact: true }).click();
  expect(await page.evaluate(() => window.uiContractKiTurn.calls)).toEqual([sent]);

  // Sent again with other files, it is another command: the server binds a saved command to its files.
  await page.evaluate(() => window.uiContractKiTurn.resolve?.({ kind: 'refused', message: 'Gerade nicht.' }));
  await attached(page).getByRole('button', { name: 'Lieferschein 4711.pdf entfernen' }).click();
  await expect(attached(page)).toHaveCount(0);
  await expect(composer(page)).toHaveValue('Lies bitte den Lieferschein.');
  await page.getByRole('button', { name: 'Senden', exact: true }).click();
  const [, changed] = await page.evaluate(() => window.uiContractKiTurn.calls);
  expect(changed?.fileIds).toEqual([]);
  expect(changed?.commandId).not.toBe(sent?.commandId);
});

const THREAD_B = '00000000-0000-4000-8000-0000000000c2';
const KEPT = '00000000-0000-4000-8000-0000000000d1';
const REMOVED = '00000000-0000-4000-8000-0000000000d2';

/** A saved file item of the command, as the thread read answers it. */
function fileItem(
  commandId: string,
  fileId: string,
  name: string,
  sequence: number,
): AiThreadWindow['messages'][number] {
  return {
    key: `${commandId}:file:${fileId}`,
    sequence,
    role: 'file',
    status: 'complete',
    text: '',
    failure: null,
    file: { fileId, name, mimeType: 'application/pdf', sizeBytes: 2048, pages: 1, origin: 'upload' },
  };
}

/** Chooses two PDFs, the kept one first, sends them with `text`, and returns the call. */
async function sendTwoFiles(page: Page, text: string) {
  await choose(page, [pdf('Aufmaß.pdf')]);
  await finishUpload(page, KEPT, 1);
  await choose(page, [pdf('Skizze.pdf')]);
  await finishUpload(page, REMOVED, 1);
  await composer(page).fill(text);
  await page.getByRole('button', { name: 'Senden', exact: true }).click();
  const [call] = await page.evaluate(() => window.uiContractKiTurn.calls);
  expect(call?.fileIds).toEqual([KEPT, REMOVED]);
  return call;
}

test('a changed resend after a refusal carries the file it still shows, and each file shows once', async ({
  page,
}) => {
  await openContractFixture(page, 'ki-chat');
  await page.getByRole('complementary', { name: 'Chats' }).getByRole('link', { name: 'Entlüften' }).click();
  const text = 'Lies bitte das Aufmaß.';
  const first = await sendTwoFiles(page, text);
  if (!first) throw new Error('The message was not sent.');

  // Another answer runs: the route saved the message with both files and refused it.
  const refused = { commandId: first.commandId, text };
  await page.evaluate(
    ({ thread, read }) => {
      window.uiContractKiWindows[thread] = read;
    },
    {
      thread: THREAD_B,
      read: {
        hasOlder: false,
        messages: [
          fileItem(refused.commandId, KEPT, 'Aufmaß.pdf', 1),
          fileItem(refused.commandId, REMOVED, 'Skizze.pdf', 2),
          {
            key: `${refused.commandId}:user`,
            sequence: 3,
            role: 'user',
            status: 'complete',
            text,
            failure: null,
          },
        ],
      } satisfies AiThreadWindow,
    },
  );
  await page.evaluate(
    (message) => window.uiContractKiTurn.resolve?.({ kind: 'refused', message }),
    'Eine andere Antwort wird gerade noch geschrieben.',
  );
  await expect(attached(page).getByRole('listitem')).toHaveCount(2);

  // The person takes one file out and sends again: a new command that carries the other.
  await attached(page).getByRole('button', { name: 'Skizze.pdf entfernen' }).click();
  await expect(attached(page).getByRole('listitem')).toHaveCount(1);
  await page.getByRole('button', { name: 'Senden', exact: true }).click();
  const [, resent] = await page.evaluate(() => window.uiContractKiTurn.calls);
  expect(resent?.threadId).toBe(THREAD_B);
  expect(resent?.fileIds).toEqual([KEPT]);
  expect(resent?.commandId).not.toBe(refused.commandId);
  const cards = (name: string) => timeline(page).getByRole('listitem').filter({ hasText: name });
  await expect(cards('Aufmaß.pdf')).toHaveCount(1);
  await expect(cards('Skizze.pdf')).toHaveCount(1);

  // The server moved the kept file to the new message and kept the earlier item; the page shows the file once.
  const command = resent?.commandId ?? '';
  await page.evaluate(
    ({ thread, read }) => {
      window.uiContractKiWindows[thread] = read;
    },
    {
      thread: THREAD_B,
      read: {
        hasOlder: false,
        messages: [
          fileItem(refused.commandId, KEPT, 'Aufmaß.pdf', 1),
          fileItem(refused.commandId, REMOVED, 'Skizze.pdf', 2),
          {
            key: `${refused.commandId}:user`,
            sequence: 3,
            role: 'user',
            status: 'complete',
            text,
            failure: null,
          },
          fileItem(command, KEPT, 'Aufmaß.pdf', 4),
          { key: `${command}:user`, sequence: 5, role: 'user', status: 'complete', text, failure: null },
          {
            key: `${command}:assistant`,
            sequence: 6,
            role: 'assistant',
            status: 'complete',
            text: 'Gelesen.',
            failure: null,
          },
        ],
      } satisfies AiThreadWindow,
    },
  );
  await emit(page, {
    type: 'started',
    userItem: { id: 'u', sequence: 5 },
    assistantItem: { id: 'a', sequence: 6 },
    files: [{ fileId: KEPT, sequence: 4 }],
  });
  await page.evaluate(() => window.uiContractKiTurn.resolve?.({ kind: 'answered' }));
  await expect(timeline(page).getByText('Gelesen.')).toBeVisible();
  await expect(cards('Aufmaß.pdf')).toHaveCount(1);
  await expect(cards('Skizze.pdf')).toHaveCount(1);
});

test('a changed resend from a new chat goes to the thread its refused message was saved in', async ({
  page,
}) => {
  await openContractFixture(page, 'ki-chat');
  const first = await sendTwoFiles(page, 'Welche Teile fehlen?');
  await page.evaluate(() => window.uiContractKiTurn.resolve?.({ kind: 'refused', message: 'Gerade nicht.' }));
  await attached(page).getByRole('button', { name: 'Skizze.pdf entfernen' }).click();
  await expect(attached(page).getByRole('listitem')).toHaveCount(1);
  await page.getByRole('button', { name: 'Senden', exact: true }).click();
  const [, resent] = await page.evaluate(() => window.uiContractKiTurn.calls);
  expect(resent?.threadId).toBe(first?.threadId);
  expect(resent?.fileIds).toEqual([KEPT]);
  expect(resent?.commandId).not.toBe(first?.commandId);
});

test('after a reload, a changed resend from the new chat shows the refused message it joins', async ({
  page,
}) => {
  await openContractFixture(page, 'ki-chat');
  const text = 'Welche Teile fehlen?';
  const first = await sendTwoFiles(page, text);
  if (!first) throw new Error('The message was not sent.');
  await page.evaluate(() => window.uiContractKiTurn.resolve?.({ kind: 'refused', message: 'Gerade nicht.' }));

  // The route saved the refused message with both files in a new thread; the page reloads.
  await openContractFixture(page, 'ki-chat');
  await page.evaluate(
    ({ thread, read }) => {
      window.uiContractKiWindows[thread] = read;
    },
    {
      thread: first.threadId,
      read: {
        hasOlder: false,
        messages: [
          fileItem(first.commandId, KEPT, 'Aufmaß.pdf', 1),
          fileItem(first.commandId, REMOVED, 'Skizze.pdf', 2),
          {
            key: `${first.commandId}:user`,
            sequence: 3,
            role: 'user',
            status: 'complete',
            text,
            failure: null,
          },
        ],
      } satisfies AiThreadWindow,
    },
  );
  await attached(page).getByRole('button', { name: 'Skizze.pdf entfernen' }).click();
  await composer(page).fill('Welche Teile fehlen fürs Aufmaß?');
  await page.getByRole('button', { name: 'Senden', exact: true }).click();
  const [resent] = await page.evaluate(() => window.uiContractKiTurn.calls);
  expect(resent?.threadId).toBe(first.threadId);

  // The answer completes before any live event: the refused message and the file it kept still show.
  await emit(page, {
    type: 'started',
    userItem: { id: 'u', sequence: 5 },
    assistantItem: { id: 'a', sequence: 6 },
    files: [{ fileId: KEPT, sequence: 4 }],
  });
  await emit(page, { type: 'end', status: 'complete' });
  await page.evaluate(() => window.uiContractKiTurn.resolve?.({ kind: 'answered' }));
  await expect(timeline(page).getByText(text, { exact: true })).toBeVisible();
  await expect(timeline(page).getByRole('listitem').filter({ hasText: 'Skizze.pdf' })).toHaveCount(1);
  await expect(timeline(page).getByRole('listitem').filter({ hasText: 'Aufmaß.pdf' })).toHaveCount(1);
});

test('a removed file keeps its place until the server removed it, and an upload on its way can be cancelled', async ({
  page,
}) => {
  const ids = [1, 2, 3, 4, 5].map((n) => `00000000-0000-4000-8000-00000000010${n}`);
  await openContractFixture(page, 'ki-chat');
  await composer(page).fill('Fünf Lieferscheine');
  for (const [index, id] of ids.entries()) {
    await choose(page, [pdf(`Lieferschein ${index + 1}.pdf`)]);
    await finishUpload(page, id, 1);
  }
  await expect(attached(page).getByRole('listitem')).toHaveCount(5);

  // A removal the server has not answered keeps its file's place, since a refused one comes back.
  await page.evaluate(() => {
    window.uiContractKiHeldDiscards = [];
  });
  await attached(page).getByRole('button', { name: 'Lieferschein 5.pdf entfernen' }).click();
  await expect(attached(page).getByRole('listitem')).toHaveCount(4);
  await choose(page, [pdf('Rechnung.pdf')]);
  await expect(
    page.getByRole('main').getByText('„Rechnung.pdf“: Eine Nachricht nimmt höchstens 5 Dateien mit.'),
  ).toBeVisible();
  expect(await page.evaluate(() => window.uiContractKiUploads.length)).toBe(0);
  await page.evaluate(() => window.uiContractKiHeldDiscards?.shift()?.(true));
  await choose(page, [pdf('Rechnung.pdf')]);
  await expect(attached(page).getByRole('status')).toHaveText('wird hochgeladen …');

  // An upload on its way, a stalled one too, can be cancelled: the text and the other files stay.
  await attached(page).getByRole('button', { name: 'Hochladen von Rechnung.pdf abbrechen' }).click();
  await expect(attached(page).getByRole('status')).toHaveCount(0);
  await expect(attached(page).getByRole('listitem')).toHaveCount(4);
  await expect(composer(page)).toHaveValue('Fünf Lieferscheine');
  expect(await page.evaluate(() => window.uiContractKiUploads[0]?.cancelled())).toBe(true);

  // A registration that lands after the cancel is discarded and never joins the draft.
  const late = '00000000-0000-4000-8000-0000000000f7';
  await finishUpload(page, late, 1);
  await expect.poll(() => page.evaluate(() => window.uiContractKiDiscards)).toContain(late);
  await expect(attached(page).getByRole('listitem')).toHaveCount(4);
  await page.getByRole('button', { name: 'Senden', exact: true }).click();
  const [call] = await page.evaluate(() => window.uiContractKiTurn.calls);
  expect(call?.fileIds).toEqual(ids.slice(0, 4));
});

test('a removed file keeps its place through a navigation away and back, so a failed removal never makes six', async ({
  page,
}) => {
  const ids = [1, 2, 3, 4, 5].map((n) => `00000000-0000-4000-8000-00000000020${n}`);
  await openContractFixture(page, 'ki-chat');
  await composer(page).fill('Fünf Lieferscheine');
  for (const [index, id] of ids.entries()) {
    await choose(page, [pdf(`Lieferschein ${index + 1}.pdf`)]);
    await finishUpload(page, id, 1);
  }
  await page.evaluate(() => {
    window.uiContractKiHeldDiscards = [];
  });
  await attached(page).getByRole('button', { name: 'Lieferschein 5.pdf entfernen' }).click();
  await expect(attached(page).getByRole('listitem')).toHaveCount(4);

  // The chat leaves the page and comes back while the server has not answered the removal.
  await page.evaluate(() => window.uiContractKiShowChat(false));
  await expect(composer(page)).toHaveCount(0);
  await page.evaluate(() => window.uiContractKiShowChat(true));
  await expect(attached(page).getByRole('listitem')).toHaveCount(4);

  await choose(page, [pdf('Rechnung.pdf')]);
  await expect(
    page.getByRole('main').getByText('„Rechnung.pdf“: Eine Nachricht nimmt höchstens 5 Dateien mit.'),
  ).toBeVisible();
  expect(await page.evaluate(() => window.uiContractKiUploads.length)).toBe(0);

  // The removal fails: the file comes back into its place with why, and the draft holds five.
  await page.evaluate(() => window.uiContractKiHeldDiscards?.shift()?.(false));
  await expect(attached(page).getByText('Lieferschein 5.pdf')).toBeVisible();
  await expect(attached(page).getByRole('listitem')).toHaveCount(5);
  await expect(
    page
      .getByRole('main')
      .getByText('„Lieferschein 5.pdf“ konnte nicht entfernt werden. Versuch es noch einmal.'),
  ).toBeVisible();
});

test('a removal still pending when a sign-out clears the drafts keeps no place in the next draft', async ({
  page,
}) => {
  const ids = [1, 2, 3, 4, 5, 6].map((n) => `00000000-0000-4000-8000-00000000030${n}`);
  await openContractFixture(page, 'ki-chat');
  await choose(page, [pdf('Alt.pdf')]);
  await finishUpload(page, ids[0] ?? '', 1);
  await page.evaluate(() => {
    window.uiContractKiHeldDiscards = [];
  });
  await attached(page).getByRole('button', { name: 'Alt.pdf entfernen' }).click();
  await expect(attached(page)).toHaveCount(0);

  // The sign-out cleared the drafts and failed, so the page stays: five new files fit.
  await page.evaluate(() => window.uiContractKiClearDrafts());
  for (const [index, id] of ids.slice(1).entries()) {
    await choose(page, [pdf(`Neu ${index + 1}.pdf`)]);
    await finishUpload(page, id, 1);
  }
  await expect(attached(page).getByRole('listitem')).toHaveCount(5);
  await expect(page.getByRole('main').getByText('höchstens 5 Dateien', { exact: false })).toHaveCount(0);
});

test('a removal refused before a new chat is saved brings its file and its reason into the saved thread', async ({
  page,
}) => {
  await openContractFixture(page, 'ki-chat');
  await choose(page, [pdf('Notiz.pdf')]);
  await finishUpload(page, FILE_ID, 1);
  await page.evaluate(() => {
    window.uiContractKiHeldDiscards = [];
  });
  await attached(page).getByRole('button', { name: 'Notiz.pdf entfernen' }).click();
  await composer(page).fill('Welche Teile fehlen?');
  await page.getByRole('button', { name: 'Senden', exact: true }).click();
  await page.evaluate(() => window.uiContractKiHeldDiscards?.shift()?.(false));
  const reason = page
    .getByRole('main')
    .getByText('„Notiz.pdf“ konnte nicht entfernt werden. Versuch es noch einmal.');
  await expect(reason).toBeVisible();

  // The new chat is saved: file and reason move to its thread, and the next new chat holds neither.
  await emit(page, {
    type: 'started',
    userItem: { id: 'u', sequence: 1 },
    assistantItem: { id: 'a', sequence: 2 },
  });
  await expect(attached(page).getByText('Notiz.pdf')).toBeVisible();
  await expect(reason).toBeVisible();
  await page.getByRole('button', { name: 'Neuer Chat', exact: true }).click();
  await expect(attached(page)).toHaveCount(0);
  await expect(reason).toHaveCount(0);
});

test('a new chat takes its files along once saved, and a refusal after sign-out writes nothing back', async ({
  page,
}) => {
  await openContractFixture(page, 'ki-chat');
  await composer(page).fill('Welche Teile fehlen?');
  await page.getByRole('button', { name: 'Senden', exact: true }).click();
  // Chosen while the new chat waits to be saved, a stored file and one still on its way move with it.
  await choose(page, [pdf('Aufmaß.pdf')]);
  await finishUpload(page, FILE_ID, 1);
  await choose(page, [pdf('Skizze.pdf')]);
  await emit(page, {
    type: 'started',
    userItem: { id: 'u', sequence: 1 },
    assistantItem: { id: 'a', sequence: 2 },
  });
  await expect(attached(page).getByText('Aufmaß.pdf')).toBeVisible();
  await expect(attached(page).getByRole('status')).toHaveText('wird hochgeladen …');
  await finishUpload(page, '00000000-0000-4000-8000-0000000000f5', 1);
  await expect(attached(page).getByText('Skizze.pdf')).toBeVisible();
  await page.getByRole('button', { name: 'Neuer Chat', exact: true }).click();
  await expect(attached(page)).toHaveCount(0);
  await page.evaluate(() => window.uiContractKiTurn.resolve?.({ kind: 'answered' }));

  // A removal still on its way when a new chat is saved, and then refused, brings the file back in that thread.
  await page.evaluate(() => {
    window.uiContractKiHeldDiscards = [];
  });
  await choose(page, [pdf('Notiz.pdf')]);
  await finishUpload(page, '00000000-0000-4000-8000-0000000000f6', 1);
  await attached(page).getByRole('button', { name: 'Notiz.pdf entfernen' }).click();
  await composer(page).fill('Noch eine Frage');
  await page.getByRole('button', { name: 'Senden', exact: true }).click();
  await emit(page, {
    type: 'started',
    userItem: { id: 'u2', sequence: 1 },
    assistantItem: { id: 'a2', sequence: 2 },
  });
  await page.evaluate(() => window.uiContractKiHeldDiscards?.shift()?.(false));
  await expect(attached(page).getByText('Notiz.pdf')).toBeVisible();
  await page.evaluate(() => {
    window.uiContractKiHeldDiscards = null;
  });
  await page.getByRole('button', { name: 'Neuer Chat', exact: true }).click();
  await expect(attached(page)).toHaveCount(0);
  await page.evaluate(() => window.uiContractKiTurn.resolve?.({ kind: 'answered' }));

  // A message refused after a sign-out cleared the drafts puts neither its text nor its files back.
  await choose(page, [pdf('Rechnung.pdf')]);
  await finishUpload(page, '00000000-0000-4000-8000-0000000000f4', 1);
  await composer(page).fill('Und die Rechnung?');
  await page.getByRole('button', { name: 'Senden', exact: true }).click();
  await page.evaluate(() => window.uiContractKiClearDrafts());
  await page.evaluate(() => window.uiContractKiTurn.resolve?.({ kind: 'refused', message: 'Gerade nicht.' }));
  await expect(composer(page)).toHaveValue('');
  const stored = await page.evaluate(() => JSON.stringify(sessionStorage));
  expect(stored).not.toContain('Rechnung.pdf');
  expect(stored).not.toContain('Und die Rechnung?');

  // The sign-out failed and the page stayed: the next message goes as a new turn.
  const before = await page.evaluate(() => window.uiContractKiTurn.calls.length);
  await composer(page).fill('Noch einmal');
  await page.getByRole('button', { name: 'Senden', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.uiContractKiTurn.calls.length)).toBe(before + 1);
  await expect(composer(page)).toHaveValue('');
});
