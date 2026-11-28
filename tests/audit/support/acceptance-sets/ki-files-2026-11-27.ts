import { expect, type Locator } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { kiOrganizationFor, seedKiThread, type KiRole } from '../../../golden/support/db/ki';
import type { TestWorld } from '../../../golden/support/world';
import { acceptanceSet, type OpenSet } from '../acceptance-sets';

/**
 * werk-flow/werkflow-planning#534 of 2026-11-27: files in a WerkFlow KI
 * thread, in the run's KI organization. A PDF uploaded into the draft, a file
 * the composer refuses with its German reason, and a thread whose message
 * carries a Lieferschein and whose answer comes with a file WerkFlow KI made,
 * marked „KI-Entwurf“.
 */
const account = (role: KiRole) => async (world: TestWorld) => {
  const ki = await kiOrganizationFor(world);
  return { user: ki.users[role], organizationId: ki.organizationId };
};

async function choose(
  scope: Locator,
  file: { name: string; mimeType: string; buffer: Buffer },
): Promise<void> {
  const page = scope.page();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Datei anhängen', exact: true }).click();
  await (await chooser).setFiles(file);
}

async function uploadedPdf(scope: Locator): Promise<void> {
  const pdf = await PDFDocument.create();
  for (let page = 0; page < 3; page += 1) pdf.addPage();
  await choose(scope, {
    name: 'Lieferschein 4711.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(await pdf.save()),
  });
  await expect(
    scope.page().getByRole('list', { name: 'Angehängte Dateien' }).getByText('3 Seiten', { exact: false }),
  ).toBeVisible();
  await scope
    .page()
    .getByRole('textbox', { name: 'Nachricht an WerkFlow KI' })
    .fill('Lies bitte den Lieferschein.');
}

async function refusedFile(scope: Locator): Promise<void> {
  await choose(scope, { name: 'Aufmaß.heic', mimeType: 'image/heic', buffer: Buffer.from('heic') });
  await expect(scope.page().getByText('„Aufmaß.heic“: Nur PDF, JPG, PNG und WebP gehen.')).toBeVisible();
}

async function threadWithFiles(world: TestWorld): Promise<{ route: string }> {
  const ki = await kiOrganizationFor(world);
  const threadId = await seedKiThread(ki, 'employee', [
    {
      role: 'file',
      file: {
        fileId: 'f0000000-0000-4000-8000-000000000001',
        name: 'Lieferschein 4711.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 184_320,
        pages: 2,
        origin: 'upload',
      },
    },
    { role: 'user', text: 'Was steht auf dem Lieferschein?' },
    {
      role: 'assistant',
      text: 'Dateien lesen kann ich noch nicht. Sobald ich es kann, prüfe ich die Positionen mit dir.',
    },
    {
      role: 'file',
      file: {
        fileId: 'f0000000-0000-4000-8000-000000000002',
        name: 'Positionen Lieferschein 4711.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 20_480,
        pages: 1,
        origin: 'agent',
      },
    },
  ]);
  return { route: `/ki?chat=${threadId}` };
}

function kiFilesCaptures(): OpenSet {
  const both = { widths: [1280, 375], schemes: ['light', 'dark'] } as const;
  const page = { kind: 'page' } as const;
  return {
    id: 'ki-files-2026-11-27',
    captures: [
      {
        id: 'admin-ki-datei-hochgeladen',
        role: 'admin',
        route: '/ki',
        view: page,
        account: account('admin'),
        act: uploadedPdf,
        ...both,
      },
      {
        id: 'buero-ki-datei-abgelehnt',
        role: 'buero',
        route: '/ki',
        view: page,
        account: account('buero'),
        act: refusedFile,
        ...both,
      },
      {
        id: 'employee-ki-dateikarten',
        role: 'employee',
        route: '/ki',
        view: page,
        account: account('employee'),
        destination: threadWithFiles,
        ...both,
      },
    ],
    standalone: [],
  };
}

acceptanceSet(kiFilesCaptures());
