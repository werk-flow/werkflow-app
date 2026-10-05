import { expect, type Locator, type Page } from '@playwright/test';
import {
  DOCUMENT_CATEGORY_LABELS,
  type DocumentCategory,
  type DocumentLibraryLinkFilter,
} from '../../../../lib/documents/types';
import {
  SHARED_COPY,
  escapeRegExp,
  expectVisibleAfterSave,
  listPager,
  textInDom,
  visibleText,
} from './shared';

/**
 * The documents area: the library under /dokumente, its dialogs and the
 * contextual „Dokumente & Bilder“ frame on job, project and request pages.
 * Category names come from DOCUMENT_CATEGORY_LABELS; the rest of the copy
 * lives in client components and is held once here.
 */
const LIBRARY = {
  title: 'Dokumente',
  createMenu: 'Hochladen oder Erstellen',
  uploadFiles: 'Dateien hochladen',
  newFolder: 'Neuer Ordner',
  search: 'Dokumente suchen…',
  filterToggle: 'Filter',
  linkFilter: 'Verknüpfung filtern',
  categoryFilter: 'Kategorie filtern',
  trash: 'Papierkorb',
  foldersView: 'Dokumente',
} as const;

/** Link filter options of the library (document-library-filter-panel.tsx). */
const LINK_FILTER_LABELS: Record<DocumentLibraryLinkFilter, string> = {
  all: 'Alle Verknüpfungen',
  jobs: 'Aufträge',
  projects: 'Projekte',
  clients: 'Kunden',
  employees: 'Mitarbeiter',
  unlinked: 'Nicht verknüpft',
};

const FILE_ACTION_LABELS = {
  details: 'Details',
  manageLinks: 'Verknüpfungen verwalten',
  copy: 'Kopieren',
  move: 'Verschieben',
  delete: SHARED_COPY.action.delete,
  restore: 'Wiederherstellen',
  deletePermanently: 'Endgültig löschen',
} as const;

type DocumentFileAction = keyof typeof FILE_ACTION_LABELS;

const DIALOG_TITLES = {
  upload: 'Dateien hochladen',
  createFolder: 'Ordner erstellen',
  manageLinks: 'Verknüpfungen verwalten',
  copy: 'Kopieren nach',
  move: 'Verschieben nach',
  details: 'Dateidetails',
} as const;

type DocumentDialog = keyof typeof DIALOG_TITLES;

const CONFIRM_LABELS = {
  delete: 'Datei löschen',
  deletePermanently: 'Endgültig löschen',
} as const;

const DESTINATION_SUBMIT_LABELS = {
  copy: 'Hierhin kopieren',
  move: 'Hierhin verschieben',
} as const;

/** Audit event labels of the details dialog (getAuditEventLabel). */
const AUDIT_EVENT_LABELS = {
  uploaded: 'Hochgeladen',
  category_changed: 'Kategorie geändert',
  version_uploaded: 'Neue Version hochgeladen',
} as const;

/** Success messages of document actions. */
const DOCUMENT_MESSAGES = {
  versionUploaded: 'Neue Version wurde hochgeladen.',
  restored: 'Datei wurde wiederhergestellt.',
  permanentlyDeleted: 'Datei wurde endgültig gelöscht.',
} as const;

const DETAILS = {
  category: 'Kategorie der Datei',
  newVersion: 'Neue Version',
  currentVersion: 'Aktuelle Version',
} as const;

const VIEWER = {
  newTab: 'Neuer Tab',
  download: 'Herunterladen',
} as const;

const UPLOAD = {
  totalProgress: 'Gesamtfortschritt des Uploads',
} as const;

/** Link targets of the „Verknüpfungen verwalten“ dialog; the job tab is open first. */
const LINK_TARGETS = {
  job: { tab: null, search: SHARED_COPY.picker.searchJob },
  project: { tab: /Projekte/, search: SHARED_COPY.picker.searchProject },
  client: { tab: /Kunden/, search: SHARED_COPY.picker.searchCustomer },
  employee: { tab: /Mitarbeiter/, search: SHARED_COPY.assignment.searchEmployee },
} as const;

type DocumentLinkTarget = keyof typeof LINK_TARGETS;

/** The folder the audit folder-upload fixture creates (tests/audit/fixtures/folder-upload). */
export const FOLDER_UPLOAD_FIXTURE_NAME = 'folder-upload';

/** The contextual „Dokumente & Bilder“ frame; its loading skeleton is a status, not this region. */
export function documentsRegion(scope: Page | Locator): Locator {
  return scope.getByRole('region', { name: SHARED_COPY.region.documents, exact: true });
}

/** The file input of the contextual frame's upload toolbar. */
export function documentsRegionUploadInput(region: Locator): Locator {
  return region.getByTestId('document-upload-input');
}

/** Every file input on the page, for the check that a role can upload nothing. */
export function documentFileInputs(page: Page): Locator {
  return page.locator('input[type="file"]');
}

/** The library's file picker; it is visually triggered and has no accessible label. */
export function documentUploadInput(page: Page): Locator {
  return page.locator('input[type="file"]:not([webkitdirectory])');
}

/** The library's folder picker; directory selection is identifiable only through webkitdirectory. */
export function documentFolderUploadInput(page: Page): Locator {
  return page.locator('input[webkitdirectory]');
}

/** The library's page title. */
export const DOCUMENT_LIBRARY_TITLE = LIBRARY.title;

/** The library's page heading. */
export function documentLibraryHeading(page: Page): Locator {
  return page.getByRole('heading', { level: 1, name: LIBRARY.title, exact: true });
}

/** The heading of the document viewer dialog for a file. */
export function documentViewerHeading(page: Page, fileName: string): Locator {
  return page.getByRole('dialog').getByRole('heading', {
    name: new RegExp(escapeRegExp(fileName)),
  });
}

/**
 * Closes the upload progress dialog if it is still open. The dialog exposes
 * its footer action and the icon close both as „Schließen“; the footer action
 * is first in DOM order. A fully successful upload closes the dialog by itself
 * 650 ms after completion, so the click may lose its target; the dialog must be
 * gone either way.
 */
export async function closeDocumentUploadProgressDialog(page: Page): Promise<void> {
  const dialog = page.getByRole('dialog').filter({
    has: page.getByRole('button', { name: SHARED_COPY.action.close }),
  });
  await dialog
    .getByRole('button', { name: SHARED_COPY.action.close })
    .first()
    .click({ timeout: 2_000 })
    .catch(() => undefined);
  await expect(dialog).toHaveCount(0, { timeout: 15_000 });
}

export function documentLibraryCreateMenu(page: Page): Locator {
  return page.getByRole('button', { name: LIBRARY.createMenu });
}

export function documentLibraryUploadFilesItem(page: Page): Locator {
  return page.getByRole('menuitem', { name: LIBRARY.uploadFiles });
}

export function documentLibraryNewFolderItem(page: Page): Locator {
  return page.getByRole('menuitem', { name: LIBRARY.newFolder });
}

export function documentLibrarySearch(page: Page): Locator {
  return page.getByPlaceholder(LIBRARY.search);
}

export function documentLibraryFilterToggle(page: Page): Locator {
  return page.getByRole('button', { name: LIBRARY.filterToggle });
}

export function documentLibraryTrashButton(page: Page): Locator {
  return page.getByRole('button', { name: LIBRARY.trash });
}

/** The view tab that returns from „Alle Dateien“ to the folder view. */
export function documentLibraryFoldersViewLink(page: Page): Locator {
  return page.getByRole('main').getByRole('link', { name: LIBRARY.foldersView, exact: true });
}

/** Chooses a link filter in the open filter panel. */
export async function chooseDocumentLinkFilter(page: Page, filter: DocumentLibraryLinkFilter): Promise<void> {
  await page.getByRole('combobox', { name: LIBRARY.linkFilter }).click();
  await page.getByRole('option', { name: LINK_FILTER_LABELS[filter], exact: true }).click();
}

/** Chooses a category filter in the open filter panel. */
export async function chooseDocumentCategoryFilter(page: Page, category: DocumentCategory): Promise<void> {
  await page.getByRole('combobox', { name: LIBRARY.categoryFilter }).click();
  await page.getByRole('option', { name: DOCUMENT_CATEGORY_LABELS[category], exact: true }).click();
}

function documentFileActionsButton(page: Page, fileName: string): Locator {
  return page.getByRole('button', { name: `Dateiaktionen für ${fileName} öffnen` });
}

/** Opens the file's action menu and chooses the action. */
export async function chooseDocumentFileAction(
  page: Page,
  fileName: string,
  action: DocumentFileAction,
): Promise<void> {
  await documentFileActionsButton(page, fileName).click();
  await page.getByRole('menuitem', { name: FILE_ACTION_LABELS[action] }).click();
}

/** Confirms the delete or permanent-delete alert dialog. */
export async function confirmDocumentDeletion(page: Page, kind: keyof typeof CONFIRM_LABELS): Promise<void> {
  await page.getByRole('alertdialog').getByRole('button', { name: CONFIRM_LABELS[kind] }).click();
}

export function documentDialog(page: Page, dialog: DocumentDialog): Locator {
  return page.getByRole('dialog').filter({
    has: page.getByRole('heading', { name: DIALOG_TITLES[dialog] }),
  });
}

/** The viewer dialog of one file; its heading is the file name. */
export function documentViewer(page: Page, fileName: string): Locator {
  return page.getByRole('dialog').filter({
    has: page.getByRole('heading', { name: fileName }),
  });
}

export function documentViewerImage(viewer: Locator, fileName: string): Locator {
  return viewer.getByRole('img', { name: fileName });
}

/** The embedded PDF frame; its title is the file name. */
export function documentViewerPdfFrame(viewer: Locator, fileName: string): Locator {
  return viewer.getByTitle(fileName);
}

/** The first visible occurrence of a file or folder name; responsive views render names twice. */
export function visibleDocumentName(scope: Page | Locator, name: string): Locator {
  return visibleText(scope, name);
}

/** Every DOM occurrence of a file name, hidden responsive copies included; for absence checks. */
export function documentNameInDom(page: Page, name: string): Locator {
  return textInDom(page, name);
}

const WORK_FOLDER_COPY = {
  openJob: 'Zum Auftrag',
  expandJob: 'Auftrag aufklappen',
} as const;

/** The pagination of the library's work folders; the pager is named „Dokumente“. */
export function documentLibraryPager(page: Page): Locator {
  return listPager(page, LIBRARY.title);
}

/** The library's folder row of one job, by its exact title. */
export function documentWorkRow(page: Page, jobTitle: string): Locator {
  return page
    .getByRole('main')
    .getByRole('row')
    .filter({ has: page.getByText(jobTitle, { exact: true }) });
}

export function documentWorkRowJobLink(row: Locator): Locator {
  return row.getByRole('link', { name: WORK_FOLDER_COPY.openJob, exact: true });
}

export function documentWorkRowExpandButton(row: Locator): Locator {
  return row.getByRole('button', { name: WORK_FOLDER_COPY.expandJob, exact: true });
}

/** The table rows of the library's „Alle Dateien“ view that show the file. */
export function documentTableRows(page: Page, fileName: string): Locator {
  return page.getByRole('row').filter({ hasText: fileName });
}

/** The button that opens a file in the contextual frame; its name starts with the file name. */
export function documentOpenButton(page: Page, fileName: string): Locator {
  return page.getByRole('button', { name: new RegExp(escapeRegExp(fileName)) });
}

/** Waits for the file name within the live envelope, then once after a reload. */
export async function expectDocumentVisibleAfterSave(page: Page, fileName: string): Promise<void> {
  await expectVisibleAfterSave(page, fileName);
}

export function documentViewerNewTabLink(viewer: Locator): Locator {
  return viewer.getByRole('link', { name: VIEWER.newTab });
}

export function documentViewerDownloadButton(viewer: Locator): Locator {
  return viewer.getByRole('button', { name: VIEWER.download });
}

/** Creates a folder through the open „Ordner erstellen“ dialog. */
export async function createDocumentFolder(page: Page, folderName: string): Promise<void> {
  const dialog = documentDialog(page, 'createFolder');
  await dialog.getByPlaceholder('Ordnername').fill(folderName);
  await dialog.getByRole('button', { name: SHARED_COPY.action.create }).click();
  await expect(dialog).toHaveCount(0, { timeout: 15_000 });
}

/** Picks one record in the link dialog: switches to the target's tab, searches, chooses the match. */
export async function pickDocumentLinkTarget(
  linkDialog: Locator,
  target: DocumentLinkTarget,
  query: string,
  optionText: string,
): Promise<void> {
  const { tab, search } = LINK_TARGETS[target];
  if (tab) await linkDialog.getByRole('button', { name: tab }).click();
  await linkDialog.getByPlaceholder(search).fill(query);
  await linkDialog.getByRole('button').filter({ hasText: optionText }).click();
}

/** Chooses the destination folder in the copy or move dialog and submits it. */
export async function submitDocumentDestination(
  page: Page,
  mode: 'copy' | 'move',
  folderName: string,
): Promise<void> {
  const dialog = documentDialog(page, mode);
  await dialog.getByRole('button', { name: folderName }).click();
  await dialog.getByRole('button', { name: DESTINATION_SUBMIT_LABELS[mode] }).click();
  await expect(dialog).toHaveCount(0, { timeout: 20_000 });
}

export function documentCategorySelect(details: Locator): Locator {
  return details.getByRole('combobox', { name: DETAILS.category });
}

export function documentNewVersionButton(details: Locator): Locator {
  return details.getByRole('button', { name: DETAILS.newVersion });
}

/** The hidden file input behind „Neue Version“ in the details dialog. */
export function documentNewVersionInput(details: Locator): Locator {
  return details.locator('input[type="file"]');
}

export function documentCurrentVersion(details: Locator, versionNumber: number): Locator {
  return details.getByText(`${DETAILS.currentVersion} ${versionNumber}`);
}

export function documentAuditEvent(details: Locator, event: keyof typeof AUDIT_EVENT_LABELS): Locator {
  return details.getByText(AUDIT_EVENT_LABELS[event], { exact: true });
}

export function documentCategoryLabel(category: DocumentCategory): string {
  return DOCUMENT_CATEGORY_LABELS[category];
}

/** Chooses a category in the details dialog's category select. */
export async function chooseDocumentCategory(details: Locator, category: DocumentCategory): Promise<void> {
  await documentCategorySelect(details).click();
  await details.page().getByRole('option', { name: DOCUMENT_CATEGORY_LABELS[category], exact: true }).click();
}

export function documentUploadTotalProgress(page: Page): Locator {
  return page.getByRole('progressbar', { name: UPLOAD.totalProgress });
}

function uploadCompletedCopy(done: number, total: number): string {
  return `${done} von ${total} abgeschlossen`;
}

/** The upload dialog's completion counter, e.g. „1 von 1 abgeschlossen“. */
export function documentUploadCompleted(page: Page, done: number, total: number): Locator {
  return visibleText(page, uploadCompletedCopy(done, total));
}

/** A visible success message of a document action. */
export function documentMessage(page: Page, message: keyof typeof DOCUMENT_MESSAGES): Locator {
  return visibleText(page, DOCUMENT_MESSAGES[message]);
}

// Uploads into the "Dokumente & Bilder" section of the page currently open.
// Shared by the job-page and request-page upload steps.
export async function uploadIntoDocumentsSection(
  page: Page,
  filePath: string,
  expectedFileName: string,
  options?: { enclosingDialog?: Locator },
): Promise<void> {
  const documentsContainer = options?.enclosingDialog ?? page.getByRole('main');
  const documentsHeading = visibleText(documentsContainer, SHARED_COPY.region.documents);
  await expect(documentsHeading).toBeVisible({
    timeout: 30_000,
  });

  const section = documentsRegion(documentsContainer);
  await expect(section).toHaveCount(1);
  await expect(section).toBeVisible();
  await documentsRegionUploadInput(section).setInputFiles(filePath);
  const uploadDialog = documentDialog(page, 'upload');

  // Direct-to-R2 upload dialog: the dialog closes itself 650 ms after a fully
  // successful upload, so the completion counter is a transient flash on a
  // fast backend under load (missed once in the Stage B campaign, incident
  // 2026-08-28T184856310Z-a28019). Completion is either the counter or the
  // self-close; a failed upload keeps the dialog open, and the error check
  // plus the persisted file-name assertion below stay strict.
  let uploadDialogSeen = false;
  await expect
    .poll(
      async () => {
        if (await uploadDialog.getByText(uploadCompletedCopy(1, 1)).isVisible()) {
          return 'complete';
        }
        const dialogOpen = (await uploadDialog.count()) > 0;
        if (dialogOpen) {
          uploadDialogSeen = true;
          return 'uploading';
        }
        return uploadDialogSeen ? 'closed' : 'starting';
      },
      { timeout: 60_000 },
    )
    .toMatch(/^(complete|closed)$/);
  await expect(page.getByText(SHARED_COPY.upload.failed)).toHaveCount(0);

  const closeButton = uploadDialog.getByRole('button', { name: SHARED_COPY.action.close });
  if (await closeButton.isVisible().catch(() => false)) {
    await closeButton.click().catch(() => undefined);
  }
  // Dialog must be gone before asserting, so the file name match can only come
  // from the documents section itself, not from the dialog's row list.
  await expect(uploadDialog).toHaveCount(0, { timeout: 10_000 });

  const persistedFile = options?.enclosingDialog
    ? options.enclosingDialog.getByText(expectedFileName).filter({ visible: true }).first()
    : visibleText(page, expectedFileName);
  await expect(persistedFile).toBeVisible({ timeout: 15_000 });
}

export async function uploadDocumentOnJobPage(
  page: Page,
  jobNumber: string,
  filePath: string,
  expectedFileName: string,
): Promise<void> {
  await page.goto(`/auftraege/${jobNumber}`);
  await uploadIntoDocumentsSection(page, filePath, expectedFileName);
}
