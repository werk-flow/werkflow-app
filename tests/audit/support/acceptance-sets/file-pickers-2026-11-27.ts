import type { Locator } from '@playwright/test';
import { acceptanceSet, type OpenSet } from '../acceptance-sets';

/**
 * werk-flow/werkflow-planning#309 of 2026-11-27: the two personnel uploads
 * choose their file through a German button that shows the chosen file's
 * name, never the browser's „Choose File No file chosen“.
 */
async function chosenFile(scope: Locator): Promise<void> {
  const page = scope.page();
  const chooser = page.waitForEvent('filechooser');
  await scope.getByRole('button', { name: /^Datei (?:Datei|Nachweis) auswählen$/ }).click();
  await (
    await chooser
  ).setFiles({
    name: 'Arbeitsvertrag-2026.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4'),
  });
}

function filePickerCaptures(): OpenSet {
  const both = { widths: [1280, 375], schemes: ['light', 'dark'], act: chosenFile } as const;
  return {
    id: 'file-pickers-2026-11-27',
    captures: [
      {
        id: 'admin-mitarbeiter-userId-dialog-people-lifecycle-document',
        role: 'admin',
        route: '/mitarbeiter/[userId]',
        view: { kind: 'dialog', opener: 'people.lifecycle-document' },
        ...both,
      },
      {
        id: 'employee-aufgaben-dialog-field-evidence-upload',
        role: 'employee',
        route: '/aufgaben',
        view: { kind: 'dialog', opener: 'field.evidence-upload' },
        ...both,
      },
    ],
    standalone: [],
  };
}

acceptanceSet(filePickerCaptures());
