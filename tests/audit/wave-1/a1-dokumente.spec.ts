import { resolve } from 'node:path';

import { expect, test } from '../support/fixtures';
import { createCustomer } from '../../golden/support/steps/customers';
import {
  FOLDER_UPLOAD_FIXTURE_NAME,
  chooseDocumentCategory,
  chooseDocumentCategoryFilter,
  chooseDocumentFileAction,
  chooseDocumentLinkFilter,
  confirmDocumentDeletion,
  createDocumentFolder,
  documentAuditEvent,
  documentCategoryLabel,
  documentCategorySelect,
  documentCurrentVersion,
  documentDialog,
  documentLibraryCreateMenu,
  documentLibraryFilterToggle,
  documentLibraryFoldersViewLink,
  documentLibraryNewFolderItem,
  documentLibrarySearch,
  documentLibraryTrashButton,
  documentLibraryUploadFilesItem,
  documentMessage,
  documentNewVersionButton,
  documentNewVersionInput,
  documentUploadCompleted,
  documentUploadTotalProgress,
  documentViewer,
  documentViewerDownloadButton,
  documentViewerNewTabLink,
  documentsRegion,
  documentNameInDom,
  documentOpenButton,
  documentTableRows,
  documentViewerImage,
  documentViewerPdfFrame,
  documentsRegionUploadInput,
  closeDocumentUploadProgressDialog,
  documentFolderUploadInput,
  documentUploadInput,
  expectDocumentVisibleAfterSave,
  pickDocumentLinkTarget,
  submitDocumentDestination,
  visibleDocumentName,
} from '../../golden/support/steps/documents';
import { dismissDialog, pressKey } from '../../golden/support/steps/interaction';
import { expectRedirectedAway } from '../../golden/support/steps/organization';
import { expectGone, SHARED_COPY } from '../../golden/support/steps/shared';
import { createJob, createProject } from '../../golden/support/steps/work';
import { expectSignedWindowOpen, SIGNED_URL_PATTERN } from '../support/a1-steps';

function onePixelPng(): Buffer {
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
  );
}

test.describe('A1 Dokumente @AUDIT-W1-A1', () => {
  test('A1-33: Stapel, Ordner, Drag & Drop und großer Upload mit echtem Fortschritt [BASE-DOCUMENT-F02/P1-00A-F01]', async ({
    adminPage,
    world,
  }) => {
    await adminPage.goto('/dokumente');
    await documentLibraryCreateMenu(adminPage).click();
    const fileChooserPromise = adminPage.waitForEvent('filechooser');
    await documentLibraryUploadFilesItem(adminPage).click();
    const fileChooser = await fileChooserPromise;
    const fileInput = documentUploadInput(adminPage);
    await fileChooser.setFiles([
      {
        name: `a1-batch-a-${world.runId}.txt`,
        mimeType: 'text/plain',
        buffer: Buffer.from('A1 batch file A'),
      },
      {
        name: `a1-batch-b-${world.runId}.txt`,
        mimeType: 'text/plain',
        buffer: Buffer.from('A1 batch file B'),
      },
    ]);
    await expect(adminPage.getByRole('dialog')).toBeVisible();
    await expect(adminPage.getByRole('dialog')).toHaveCount(0, {
      timeout: 60_000,
    });
    await adminPage.reload();
    await expect(visibleDocumentName(adminPage, `a1-batch-a-${world.runId}.txt`)).toBeVisible({
      timeout: 20_000,
    });
    await expect(visibleDocumentName(adminPage, `a1-batch-b-${world.runId}.txt`)).toBeVisible();

    await documentFolderUploadInput(adminPage).setInputFiles(
      resolve(process.cwd(), 'tests/audit/fixtures', FOLDER_UPLOAD_FIXTURE_NAME),
    );
    await expect(adminPage.getByRole('dialog')).toBeVisible();
    await expect(adminPage.getByRole('dialog')).toHaveCount(0, {
      timeout: 60_000,
    });
    await adminPage.reload();
    await expect(visibleDocumentName(adminPage, FOLDER_UPLOAD_FIXTURE_NAME)).toBeVisible({
      timeout: 20_000,
    });

    // The library root owns the drop handlers; the search field sits inside
    // it, so a bubbling drop dispatched there reaches the same target a real
    // file drop over the list does.
    await documentLibrarySearch(adminPage).evaluate((target, fileName) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File(['A1 external drop'], fileName, { type: 'text/plain' }));
      target.dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer: transfer }));
      target.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: transfer }));
    }, `a1-drop-${world.runId}.txt`);
    await expect(adminPage.getByRole('dialog')).toBeVisible();
    await expect(adminPage.getByRole('dialog')).toHaveCount(0, {
      timeout: 60_000,
    });
    await adminPage.reload();
    await expect(visibleDocumentName(adminPage, `a1-drop-${world.runId}.txt`)).toBeVisible({
      timeout: 20_000,
    });

    await adminPage.evaluate(() => {
      document.documentElement.dataset.nativeUploadProgress = '';
      document.documentElement.dataset.uploadProgressValues = '';
      document.documentElement.dataset.uploadProgressBarSeen = 'false';
      const recordProgressBar = () => {
        const progressBar = document.querySelector('[role="progressbar"]');
        if (!progressBar) return;
        document.documentElement.dataset.uploadProgressBarSeen = 'true';
        const value = progressBar.getAttribute('aria-valuenow');
        if (!value) return;
        const existing = document.documentElement.dataset.uploadProgressValues ?? '';
        document.documentElement.dataset.uploadProgressValues = `${existing},${value}`;
      };
      const progressObserver = new MutationObserver(recordProgressBar);
      progressObserver.observe(document.body, {
        attributes: true,
        attributeFilter: ['aria-valuenow'],
        childList: true,
        subtree: true,
      });
      const originalSend = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.send = function sendWithProgressEvidence(body) {
        this.upload.addEventListener('progress', (event) => {
          if (!event.lengthComputable) return;
          const existing = document.documentElement.dataset.nativeUploadProgress ?? '';
          document.documentElement.dataset.nativeUploadProgress = `${existing},${event.loaded}/${event.total}`;
        });
        return originalSend.call(this, body);
      };
    });
    const networkSession = await adminPage.context().newCDPSession(adminPage);
    await networkSession.send('Network.enable');
    await networkSession.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 20,
      downloadThroughput: 10 * 1024 * 1024,
      uploadThroughput: 512 * 1024,
      connectionType: 'cellular3g',
    });
    try {
      await fileInput.setInputFiles({
        name: `a1-large-${world.runId}.bin`,
        mimeType: 'application/octet-stream',
        buffer: Buffer.alloc(6 * 1024 * 1024, 65),
      });
      await expect(documentUploadTotalProgress(adminPage)).toBeVisible();
      await expect(adminPage.getByRole('dialog')).toHaveCount(0, {
        timeout: 90_000,
      });
    } finally {
      await networkSession.send('Network.emulateNetworkConditions', {
        offline: false,
        latency: 0,
        downloadThroughput: -1,
        uploadThroughput: -1,
      });
      await networkSession.detach();
    }
    const progressEvidence = await adminPage.evaluate(() => ({
      barSeen: document.documentElement.dataset.uploadProgressBarSeen,
      values: (document.documentElement.dataset.uploadProgressValues ?? '')
        .split(',')
        .filter(Boolean)
        .map(Number),
      nativeSamples: (document.documentElement.dataset.nativeUploadProgress ?? '')
        .split(',')
        .filter(Boolean)
        .map((sample) => sample.split('/').map(Number)),
    }));
    expect(progressEvidence.barSeen).toBe('true');
    expect(progressEvidence.values).toContain(100);
    expect(progressEvidence.nativeSamples.some(([, total]) => total === 6 * 1024 * 1024)).toBe(true);
    expect(progressEvidence.nativeSamples.at(-1)).toEqual([6 * 1024 * 1024, 6 * 1024 * 1024]);
    await adminPage.reload();
    await expect(visibleDocumentName(adminPage, `a1-large-${world.runId}.bin`)).toBeVisible({
      timeout: 20_000,
    });
  });

  test('A1-34/A1-35: Ordner, Verschieben/Kopieren und Arbeitsverknüpfung', async ({ adminPage, world }) => {
    const linkCustomerName = `A1 Dokumentkunde ${world.runId}`;
    const linkProjectNumber = `A1-DOC-P-${world.runId}`;
    const linkJobNumber = `A1-DOC-J-${world.runId}`;
    await createCustomer(adminPage, linkCustomerName);
    await createProject(adminPage, {
      projectNumber: linkProjectNumber,
      title: `A1 Dokumentprojekt ${world.runId}`,
      clientName: linkCustomerName,
    });
    await createJob(adminPage, {
      jobNumber: linkJobNumber,
      title: `A1 Dokumentauftrag ${world.runId}`,
    });
    const folderName = `A1 Ordner ${world.runId}`;
    const fileName = `a1-dokument-${world.runId}.txt`;
    await adminPage.goto('/dokumente');
    await documentLibraryCreateMenu(adminPage).click();
    await documentLibraryNewFolderItem(adminPage).click();
    await createDocumentFolder(adminPage, folderName);

    await documentUploadInput(adminPage).setInputFiles({
      name: fileName,
      mimeType: 'text/plain',
      buffer: Buffer.from('WerkFlow A1 Dokument'),
    });
    await expect(documentUploadCompleted(adminPage, 1, 1)).toBeVisible({
      timeout: 60_000,
    });
    await closeDocumentUploadProgressDialog(adminPage);
    await expect(visibleDocumentName(adminPage, fileName)).toBeVisible({
      timeout: 20_000,
    });

    await chooseDocumentFileAction(adminPage, fileName, 'manageLinks');
    const linkDialog = documentDialog(adminPage, 'manageLinks');
    await pickDocumentLinkTarget(linkDialog, 'job', linkJobNumber, linkJobNumber);
    await pickDocumentLinkTarget(linkDialog, 'project', linkProjectNumber, linkProjectNumber);
    await pickDocumentLinkTarget(linkDialog, 'client', linkCustomerName, linkCustomerName);
    await pickDocumentLinkTarget(linkDialog, 'employee', 'Emil', 'Emil');
    await linkDialog.getByRole('button', { name: SHARED_COPY.action.save }).click();
    await expect(linkDialog).toHaveCount(0, { timeout: 20_000 });

    // The save closes with a router refresh; under a loaded shared-world run it
    // can supersede this tab click. Navigate to the link target directly so the
    // filter assertions start from the persisted post-save view.
    await adminPage.goto('/dokumente?view=all');
    await expect(adminPage).toHaveURL(/view=all/);
    const documentSearch = documentLibrarySearch(adminPage);
    await documentSearch.fill(fileName);
    await pressKey(adminPage, 'Enter', { into: documentSearch });
    const documentRows = documentTableRows(adminPage, fileName);
    await expect(documentRows).toHaveCount(1);
    for (const linkFilter of ['jobs', 'projects', 'clients', 'employees'] as const) {
      await documentLibraryFilterToggle(adminPage).click();
      await chooseDocumentLinkFilter(adminPage, linkFilter);
      await expect(documentRows).toHaveCount(1);
      await documentLibraryFilterToggle(adminPage).click();
    }
    await documentLibraryFilterToggle(adminPage).click();
    await chooseDocumentCategoryFilter(adminPage, 'other');
    await expect(documentRows).toHaveCount(1);
    await chooseDocumentLinkFilter(adminPage, 'all');
    await documentSearch.fill('kein-a1-dokument');
    await pressKey(adminPage, 'Enter', { into: documentSearch });
    await expectGone(documentRows);
    await documentSearch.fill('');
    await pressKey(adminPage, 'Enter', { into: documentSearch });
    // A cleared search stays cleared: no late route commit may restore the
    // negative query, in the field or in the view tab's href.
    await expect(documentSearch).toHaveValue('');
    await expect(documentRows).toHaveCount(1);
    await documentLibraryFoldersViewLink(adminPage).click();
    await expect(adminPage).toHaveURL(/\/dokumente\?view=folders$/);
    await expect(visibleDocumentName(adminPage, folderName)).toBeVisible();

    await chooseDocumentFileAction(adminPage, fileName, 'copy');
    await submitDocumentDestination(adminPage, 'copy', folderName);

    await chooseDocumentFileAction(adminPage, fileName, 'move');
    await submitDocumentDestination(adminPage, 'move', folderName);
  });

  test('A1-36/A1-37: Papierkorb, Wiederherstellung, endgültiges Löschen, Version und Verlauf', async ({
    adminPage,
    world,
  }) => {
    const fileName = `a1-version-${world.runId}.pdf`;
    await adminPage.goto('/dokumente');
    await documentLibraryCreateMenu(adminPage).click();
    const fileChooserPromise = adminPage.waitForEvent('filechooser');
    await documentLibraryUploadFilesItem(adminPage).click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles({
      name: fileName,
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4\nWerkFlow A1 Version 1'),
    });
    await expect(documentUploadCompleted(adminPage, 1, 1)).toBeVisible({
      timeout: 60_000,
    });
    await closeDocumentUploadProgressDialog(adminPage);
    await chooseDocumentFileAction(adminPage, fileName, 'details');
    const details = documentDialog(adminPage, 'details');
    await expect(documentAuditEvent(details, 'uploaded')).toBeVisible({
      timeout: 20_000,
    });
    // The category control moved off the native <select> (M5 canon): shadcn
    // Select trigger plus role=option entries.
    await chooseDocumentCategory(details, 'contract');
    await expect(documentCategorySelect(details)).toContainText(documentCategoryLabel('contract'));
    // The select flips at once, but the dialog refuses dismissal while the
    // category save runs; the control is enabled again when the save ended.
    await expect(documentCategorySelect(details)).toBeEnabled();
    await dismissDialog(details);
    await expect(details).toHaveCount(0);
    await chooseDocumentFileAction(adminPage, fileName, 'details');
    await expect(documentAuditEvent(details, 'category_changed')).toBeVisible({
      timeout: 20_000,
    });
    await expect(documentNewVersionButton(details)).toBeVisible();
    await documentNewVersionInput(details).setInputFiles({
      name: fileName,
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4\nWerkFlow A1 Version 2'),
    });
    await expect(documentMessage(adminPage, 'versionUploaded')).toBeVisible({
      timeout: 60_000,
    });
    await expect(documentCurrentVersion(details, 2)).toBeVisible();
    await expect(documentAuditEvent(details, 'version_uploaded')).toBeVisible();
    // The upload holds the dialog until its details reload ended.
    await expect(documentNewVersionButton(details)).toBeEnabled();
    await dismissDialog(details);
    await expect(details).toHaveCount(0);

    await chooseDocumentFileAction(adminPage, fileName, 'delete');
    await confirmDocumentDeletion(adminPage, 'delete');
    const trashButton = documentLibraryTrashButton(adminPage);
    await expect(trashButton).toBeDisabled();
    await expect(trashButton).toBeEnabled({ timeout: 30_000 });
    await trashButton.click();
    await expect(visibleDocumentName(adminPage, fileName)).toBeVisible({
      timeout: 20_000,
    });
    await chooseDocumentFileAction(adminPage, fileName, 'restore');
    await expect(documentMessage(adminPage, 'restored')).toBeVisible();

    await trashButton.click();
    await adminPage.goto('/dokumente');
    await chooseDocumentFileAction(adminPage, fileName, 'delete');
    await confirmDocumentDeletion(adminPage, 'delete');
    await expect(trashButton).toBeDisabled();
    await expect(trashButton).toBeEnabled({ timeout: 30_000 });
    await trashButton.click();
    await chooseDocumentFileAction(adminPage, fileName, 'deletePermanently');
    await confirmDocumentDeletion(adminPage, 'deletePermanently');
    await expect(documentNameInDom(adminPage, fileName)).toHaveCount(0);
    await expect(documentMessage(adminPage, 'permanentlyDeleted')).toBeVisible();

    await adminPage.goto('/dokumente');
    await documentLibraryCreateMenu(adminPage).click();
    const viewerFileChooserPromise = adminPage.waitForEvent('filechooser');
    await documentLibraryUploadFilesItem(adminPage).click();
    const viewerFileChooser = await viewerFileChooserPromise;
    const imageViewerFile = `a1-viewer-${world.runId}.png`;
    const pdfViewerFile = `a1-viewer-${world.runId}.pdf`;
    await viewerFileChooser.setFiles([
      {
        name: imageViewerFile,
        mimeType: 'image/png',
        buffer: onePixelPng(),
      },
      {
        name: pdfViewerFile,
        mimeType: 'application/pdf',
        buffer: Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF'),
      },
    ]);
    await expect(documentUploadCompleted(adminPage, 2, 2)).toBeVisible({
      timeout: 60_000,
    });
    await closeDocumentUploadProgressDialog(adminPage);
    await visibleDocumentName(adminPage, imageViewerFile).click();
    const imageViewer = documentViewer(adminPage, imageViewerFile);
    await expect(documentViewerImage(imageViewer, imageViewerFile)).toBeVisible({ timeout: 20_000 });
    await expect(documentViewerNewTabLink(imageViewer)).toHaveAttribute('href', SIGNED_URL_PATTERN);
    await expectSignedWindowOpen(adminPage, () => documentViewerDownloadButton(imageViewer).click());
    await dismissDialog(imageViewer);

    await visibleDocumentName(adminPage, pdfViewerFile).click();
    const pdfViewer = documentViewer(adminPage, pdfViewerFile);
    await expect(documentViewerPdfFrame(pdfViewer, pdfViewerFile)).toHaveAttribute(
      'src',
      /^https?:\/\/.+X-Amz-(Algorithm|Signature)=.+#toolbar=0/,
    );
  });

  test('A1-38: Handwerker lädt am zugewiesenen Auftrag hoch, öffnet und lädt signiert herunter [BASE-DOCUMENT-F04/P1-00A-F02]', async ({
    adminPage,
    bueroPage,
    employeePage,
    world,
  }) => {
    const assignedJobNumber = `A1-DOC-E-${world.runId}`;
    const unassignedJobNumber = `A1-DOC-X-${world.runId}`;
    const fileName = `a1-employee-${world.runId}.png`;
    await createJob(adminPage, {
      jobNumber: assignedJobNumber,
      title: `A1 Mitarbeiterdokument ${world.runId}`,
      assignEmployeeName: 'Emil',
    });
    await createJob(adminPage, {
      jobNumber: unassignedJobNumber,
      title: `A1 Nicht zugewiesen ${world.runId}`,
    });

    await expectRedirectedAway(employeePage, '/dokumente');
    await employeePage.goto(`/auftraege/${assignedJobNumber}`);
    await documentsRegionUploadInput(documentsRegion(employeePage)).setInputFiles({
      name: fileName,
      mimeType: 'image/png',
      buffer: onePixelPng(),
    });
    // A tiny upload can finish before a visibility poll ever sees the
    // progress dialog (transient-flash class, testing.md); the close-wait plus
    // the persisted file row below are the honest proof.
    await expect(employeePage.getByRole('dialog')).toHaveCount(0, {
      timeout: 60_000,
    });
    await employeePage.reload();
    await documentOpenButton(employeePage, fileName).click();
    const viewer = documentViewer(employeePage, fileName);
    await expect(documentViewerImage(viewer, fileName)).toBeVisible({
      timeout: 20_000,
    });
    await expectSignedWindowOpen(employeePage, () => documentViewerDownloadButton(viewer).click());
    await dismissDialog(viewer);
    await expectRedirectedAway(employeePage, `/auftraege/${unassignedJobNumber}`);

    const liveFileName = `a1-doc-live-${world.runId}.txt`;
    await adminPage.goto('/dokumente?view=all');
    await bueroPage.goto('/dokumente');
    const uploadDialog = documentDialog(bueroPage, 'upload');
    // Right after navigation the file input can receive the files before
    // hydration attaches its change handler, so nothing opens (pre-hydration
    // class; surfaced by the fast local stack 2026-08-28). Wait for hydration
    // like the login helper does; no dialog means no upload started, so
    // re-selecting the files is safe.
    await bueroPage.waitForLoadState('networkidle');
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await documentUploadInput(bueroPage).setInputFiles(
        {
          name: liveFileName,
          mimeType: 'text/plain',
          buffer: Buffer.from('A1 document Realtime'),
        },
        { timeout: 15_000 },
      );
      const opened = await uploadDialog
        .waitFor({ state: 'visible', timeout: 10_000 })
        .then(() => true)
        .catch(() => false);
      if (opened) break;
      if (attempt === 3) {
        throw new Error('Upload dialog did not open after three file selections.');
      }
    }
    await expect(uploadDialog).toHaveCount(0, { timeout: 60_000 });
    await expect(visibleDocumentName(bueroPage, liveFileName)).toBeVisible({
      timeout: 15_000,
    });
    // The admin channel can still be subscribing when the INSERT fires right
    // after navigation (missed-delivery class); the sanctioned one-reload
    // fallback keeps the persisted-row assertion strict while GG-00's
    // dedicated Realtime test remains the freshness guard.
    await expectDocumentVisibleAfterSave(adminPage, liveFileName);
  });
});
