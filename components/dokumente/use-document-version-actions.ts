'use client';

import { useRef } from 'react';

import {
  getDocumentDetails,
  getDocumentSignedUrl,
  getDocumentVersionSignedUrl,
} from '@/lib/documents/actions';
import type { OrganizationDocument } from '@/lib/documents/types';
import { uploadDocumentVersionDirect } from '@/lib/documents/upload-client';
import type { DocumentDetailsDialogState } from './use-document-details-dialog';
import type { DocumentLibraryMutations } from './use-document-library-mutations';

/**
 * The file actions of the „Dateidetails" dialog: download, upload of a new
 * version and download of an older one. The button spins under the row's busy
 * id and failures render inside the dialog.
 */
export function useDocumentVersionActions({
  details,
  mutations,
}: {
  details: DocumentDetailsDialogState;
  mutations: DocumentLibraryMutations;
}) {
  const { busy, showFeedback, refreshDocuments } = mutations;
  const {
    detailsDialog,
    setDetailsDialog,
    detailsDialogIdRef,
    setDetailsData,
    setIsDetailsLoading,
    setDetailsError,
  } = details;
  const versionInputRef = useRef<HTMLInputElement>(null);

  function handleDownload(document: OrganizationDocument) {
    const downloadFailure = 'Die Datei konnte nicht geöffnet werden.';
    setDetailsError(null);
    void busy
      .run(document.id, async () => {
        const result = await getDocumentSignedUrl(document.id);
        if (!result.success) {
          setDetailsError(downloadFailure);
          return;
        }
        window.open(result.signedUrl, '_blank', 'noopener,noreferrer');
      })
      .catch(() => setDetailsError(downloadFailure));
  }

  function handleVersionUpload(files: FileList | null) {
    if (!detailsDialog || !files?.[0]) return;

    const file = files[0];
    const activeDocument = detailsDialog;
    const documentId = activeDocument.id;
    const uploadFailure = 'Die neue Version konnte nicht hochgeladen werden.';
    setDetailsError(null);

    void busy
      .run(documentId, async () => {
        const result = await uploadDocumentVersionDirect({
          documentId,
          file,
        });

        if (!result.success) {
          if (detailsDialogIdRef.current === documentId) {
            setDetailsError(uploadFailure);
          }
          return;
        }

        showFeedback('success', 'Neue Version wurde hochgeladen.');
        if (detailsDialogIdRef.current === documentId) {
          const refreshedDocument = {
            ...activeDocument,
            currentVersionNumber: result.version.versionNumber,
            storagePath: result.version.storagePath,
            originalFileName: result.version.originalFileName,
            mimeType: result.version.mimeType,
            sizeBytes: result.version.sizeBytes,
            uploadedBy: result.version.uploadedBy,
            updatedAt: result.version.createdAt,
            uploader: result.version.uploader,
          };
          setDetailsDialog(refreshedDocument);
          setDetailsData(null);
          setIsDetailsLoading(true);
          // The upload is saved: a failed reload reports the details, never the upload.
          const detailsResult = await getDocumentDetails(documentId).catch(() => null);
          if (detailsDialogIdRef.current === documentId) {
            // A failed reload leaves `detailsData` empty; the dialog shows it with a retry.
            if (detailsResult?.success) {
              setDetailsData({
                ...detailsResult,
                document: refreshedDocument,
              });
            }
            setIsDetailsLoading(false);
          }
        }
        refreshDocuments();
      })
      .catch(() => {
        if (detailsDialogIdRef.current === documentId) {
          setDetailsError(uploadFailure);
          setIsDetailsLoading(false);
        }
      })
      .finally(() => {
        if (versionInputRef.current) versionInputRef.current.value = '';
      });
  }

  function handleDownloadVersion(versionId: string) {
    const downloadFailure = 'Die Version konnte nicht geöffnet werden.';
    setDetailsError(null);
    void busy
      .run(versionId, async () => {
        const result = await getDocumentVersionSignedUrl(versionId, {
          download: true,
        });
        if (!result.success) {
          setDetailsError(downloadFailure);
          return;
        }
        window.open(result.signedUrl, '_blank', 'noopener,noreferrer');
      })
      .catch(() => setDetailsError(downloadFailure));
  }

  return {
    versionInputRef,
    handleDownload,
    handleVersionUpload,
    handleDownloadVersion,
  };
}
