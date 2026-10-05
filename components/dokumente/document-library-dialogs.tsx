'use client';

import type { ReactNode } from 'react';

import { DocumentConfirmDialog } from './document-confirm-dialog';
import { DocumentDetailsDialog } from './document-details-dialog';
import { DocumentLinkDialog } from './document-link-dialog';
import { DocumentCreateFolderDialog, DocumentRenameDialog } from './document-name-dialogs';
import { DocumentUploadDialog } from './document-upload-dialog';
import { DocumentViewerDialog } from './document-viewer-dialog';
import type { DocumentLibrary } from './use-document-library';

type DocumentLibraryDialogsProps = {
  library: DocumentLibrary;
  uploadTargetFolderId: string | null;
  /** The move/copy dialog, rendered by the page between the folder and the details dialog. */
  moveCopyDialog: ReactNode;
};

/** Every dialog of the library; each one's state lives in a hook of `library`. */
export function DocumentLibraryDialogs({
  library,
  uploadTargetFolderId,
  moveCopyDialog,
}: DocumentLibraryDialogsProps) {
  const { mutations, upload, viewer, linkDialog, deleteActions, details, versionActions } = library;

  return (
    <>
      <DocumentUploadDialog
        open={upload.uploadDialogOpen}
        onOpenChange={upload.setUploadDialogOpen}
        items={upload.uploadItems}
        target={{ kind: 'library', folderId: uploadTargetFolderId }}
        allowFolderCreation={library.canUseUploadActions}
        onComplete={(failedCount) => {
          if (failedCount > 0) {
            mutations.showFeedback('error', `${failedCount} Datei(en) konnten nicht hochgeladen werden.`);
          }
          upload.resetFileInputs();
          mutations.refreshDocuments();
        }}
      />

      <DocumentViewerDialog
        document={viewer.viewerDocument}
        open={!!viewer.viewerDocument}
        onOpenChange={(open) => !open && viewer.closeDocumentViewer()}
      />

      <DocumentLinkDialog
        key={linkDialog?.id ?? 'closed-document-link-dialog'}
        document={linkDialog}
        open={!!linkDialog}
        onOpenChange={(open) => !open && library.closeLinkDialog()}
        onComplete={(variant, message) => {
          mutations.showFeedback(variant, message);
          mutations.refreshDocuments();
        }}
      />

      <DocumentRenameDialog rename={library.rename} />

      <DocumentConfirmDialog
        confirmDialog={deleteActions.confirmDialog}
        onClose={() => deleteActions.setConfirmDialog(null)}
      />

      <DocumentCreateFolderDialog folderCreation={library.folderCreation} />

      {moveCopyDialog}

      <DocumentDetailsDialog
        document={details.detailsDialog}
        error={details.detailsError}
        details={details.detailsData}
        isLoading={details.isDetailsLoading}
        isBusy={details.isDetailsBusy}
        isTrashView={library.isTrashView}
        isItemBusy={mutations.busy.isBusy}
        versionInputRef={versionActions.versionInputRef}
        onClose={details.closeDetailsDialog}
        onUpdateCategory={details.handleUpdateCategory}
        onDownload={versionActions.handleDownload}
        onVersionUpload={versionActions.handleVersionUpload}
        onDownloadVersion={versionActions.handleDownloadVersion}
        onRetryDetails={() => {
          if (details.detailsDialog) details.openDetailsDialog(details.detailsDialog);
        }}
      />
    </>
  );
}
