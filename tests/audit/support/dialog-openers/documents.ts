import { open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Locator } from '@playwright/test';
import { DOCUMENT_MAX_FILE_SIZE_BYTES } from '../../../../lib/documents/types';
import type { DialogOpenerId } from '../../../../lib/testing/selection/dialog-inventory';
import { seedStoredImageDocument } from '../../../golden/support/db/documents';
import {
  contextualDocumentActionItem,
  contextualDocumentActionsButton,
  documentAlertLayer,
  documentDialogLayer,
  documentFileActionItem,
  documentFileActionsButton,
  documentLibraryCreateMenu,
  documentLibraryNewFolderItem,
  documentLibraryUploadFilesItem,
  documentsRegion,
  documentsRegionAttachButton,
  documentViewerLayer,
} from '../../../golden/support/steps/documents';
import type { TestWorld } from '../../../golden/support/world';
import type { DialogOpener } from '../dialog-opener';
import { prepareLayoutDetails } from '../layout-fixtures';
import { surfaceFixture, type SurfaceContext } from '../surface-fixtures';

type LibraryFileAction = Parameters<typeof documentFileActionItem>[1];

// The layer and focus lookups get no world, so the name is constant; each
// audit world is its own organization, which keeps it unique.
const AUDIT_DOCUMENT_NAME = 'Foto Heizungsraum Technikraum.png';

/**
 * One stored PNG at the library root, linked to the layout job: the library
 * lists it, the job's „Dokumente & Bilder“ frame lists it and the viewer
 * renders it as an image.
 */
async function seedAuditDocument(world: TestWorld): Promise<void> {
  const details = await prepareLayoutDetails(world);
  await surfaceFixture(world, 'documents.image', () =>
    seedStoredImageDocument({
      orgId: world.orgId,
      actorId: world.users.admin.id,
      displayName: AUDIT_DOCUMENT_NAME,
      jobId: details.jobId,
    }),
  );
}

/** Opens the file's action menu in the library and returns the item that opens the dialog. */
async function libraryFileAction(
  { page, world }: SurfaceContext,
  action: LibraryFileAction,
): Promise<Locator> {
  await seedAuditDocument(world);
  await page.reload();
  await documentFileActionsButton(page, AUDIT_DOCUMENT_NAME).click();
  return documentFileActionItem(page, action);
}

function libraryFileActionsButton({ page }: SurfaceContext): Locator {
  return documentFileActionsButton(page, AUDIT_DOCUMENT_NAME);
}

/** Opens the document row's menu in the job's „Dokumente & Bilder“ frame. */
async function contextualRowAction(
  { page, world }: SurfaceContext,
  action: Parameters<typeof contextualDocumentActionItem>[1],
): Promise<Locator> {
  await seedAuditDocument(world);
  await page.reload();
  await contextualRowActionsButton({ page }).click();
  return contextualDocumentActionItem(page, action);
}

function contextualRowActionsButton({ page }: Pick<SurfaceContext, 'page'>): Locator {
  return contextualDocumentActionsButton(documentsRegion(page.getByRole('main')), AUDIT_DOCUMENT_NAME);
}

/**
 * A sparse file one byte over the upload limit. The upload dialog refuses it
 * in the browser before any request, so the dialog stays open and nothing is
 * saved; a file within the limit would upload and close the dialog by itself.
 */
async function oversizedUploadFile(world: TestWorld): Promise<string> {
  const path = join(tmpdir(), `Aufmass-Gesamtplan-${world.runId}.pdf`);
  const handle = await open(path, 'w');
  try {
    await handle.truncate(DOCUMENT_MAX_FILE_SIZE_BYTES + 1);
  } finally {
    await handle.close();
  }
  return path;
}

export const DOCUMENTS_OPENERS = {
  'documents.attach': {
    trigger: async ({ page, world }) => {
      await seedAuditDocument(world);
      await page.reload();
      return documentsRegionAttachButton(documentsRegion(page.getByRole('main')));
    },
    layer: (page) => documentDialogLayer(page, 'attach'),
  },
  'documents.contextual-delete': {
    trigger: (context) => contextualRowAction(context, 'trash'),
    layer: (page) => documentAlertLayer(page, 'contextualTrash'),
    returnFocus: contextualRowActionsButton,
  },
  'documents.contextual-rename': {
    trigger: (context) => contextualRowAction(context, 'rename'),
    layer: (page) => documentDialogLayer(page, 'rename'),
    returnFocus: contextualRowActionsButton,
  },
  'documents.confirm': {
    // „Löschen“ asks before the file moves to the trash; the audit never confirms.
    trigger: (context) => libraryFileAction(context, 'delete'),
    layer: (page) => documentAlertLayer(page, 'trash'),
    returnFocus: libraryFileActionsButton,
  },
  'documents.create-folder': {
    trigger: async ({ page }) => {
      await documentLibraryCreateMenu(page).click();
      return documentLibraryNewFolderItem(page);
    },
    layer: (page) => documentDialogLayer(page, 'createFolder'),
    returnFocus: ({ page }) => documentLibraryCreateMenu(page),
  },
  'documents.details': {
    trigger: (context) => libraryFileAction(context, 'details'),
    layer: (page) => documentDialogLayer(page, 'details'),
    returnFocus: libraryFileActionsButton,
  },
  'documents.link': {
    trigger: (context) => libraryFileAction(context, 'manageLinks'),
    layer: (page) => documentDialogLayer(page, 'manageLinks'),
    returnFocus: libraryFileActionsButton,
  },
  'documents.move': {
    trigger: (context) => libraryFileAction(context, 'move'),
    layer: (page) => documentDialogLayer(page, 'move'),
    returnFocus: libraryFileActionsButton,
  },
  'documents.rename': {
    trigger: (context) => libraryFileAction(context, 'rename'),
    layer: (page) => documentDialogLayer(page, 'rename'),
    returnFocus: libraryFileActionsButton,
  },
  'documents.upload': {
    trigger: async ({ page, world }) => {
      const file = await oversizedUploadFile(world);
      // „Dateien hochladen“ clicks the hidden file input; the chooser receives the file.
      page.once('filechooser', (chooser) => void chooser.setFiles(file));
      await documentLibraryCreateMenu(page).click();
      return documentLibraryUploadFilesItem(page);
    },
    layer: (page) => documentDialogLayer(page, 'upload'),
    returnFocus: ({ page }) => documentLibraryCreateMenu(page),
  },
  'documents.viewer': {
    trigger: (context) => libraryFileAction(context, 'open'),
    layer: (page) => documentViewerLayer(page, AUDIT_DOCUMENT_NAME),
    returnFocus: libraryFileActionsButton,
  },
} satisfies Partial<Record<DialogOpenerId, DialogOpener>>;
