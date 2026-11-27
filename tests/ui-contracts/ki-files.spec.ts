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
});
